import type { RunningAction, WriteAction } from '../action-slot';
import { AUTHOR_MESSAGES, AUTHOR_TEMPLATES } from '../author-messages';
import { stepFingerprint } from './setup-state';
import type { SetupSnapshot, SetupStep, StepFailure } from './setup-state';

/**
 * What the setup screen shows, decided apart from drawing it
 * (replace-rest-with-local-git-ssh tasks 1.9 and 1.10).
 *
 * The panel and the settings tab both draw from this, so which controls a
 * step offers, what each is called and when it is busy are decided once. It is
 * also what makes those rules testable: this project's `obsidian` stub does not
 * model Obsidian's interface and must not grow to, so a rule that lives in a
 * `Setting` or a `ButtonComponent` is a rule no test can see.
 */
export type SetupControlId =
	| 'getGit'
	| 'checkAgain'
	| 'openSettings'
	| 'createKey'
	| 'copyKey'
	| 'openGitLab'
	| 'test'
	| 'connect';

export interface SetupControl {
	id: SetupControlId;
	label: string;
	/** Disabled for the few seconds an action runs, with the pressed control saying why. */
	disabled: boolean;
}

export interface SetupStepView {
	step: SetupStep;
	heading: string;
	text: string;
	controls: SetupControl[];
}

export interface SetupStepRow {
	step: SetupStep;
	label: string;
	state: 'done' | 'current' | 'todo';
}

export interface SetupView {
	title: string;
	progress: string;
	step: SetupStepView;
	/** What the last action said, when it was about this step. */
	notice: string | null;
	/** All five steps, for the settings tab's list. */
	steps: SetupStepRow[];
}

const LABELS: Record<SetupControlId, string> = {
	getGit: AUTHOR_MESSAGES.getGit,
	checkAgain: AUTHOR_MESSAGES.checkAgain,
	openSettings: AUTHOR_MESSAGES.openSettings,
	createKey: AUTHOR_MESSAGES.createKey,
	copyKey: AUTHOR_MESSAGES.copyKey,
	openGitLab: AUTHOR_MESSAGES.openGitLab,
	test: AUTHOR_MESSAGES.test,
	connect: AUTHOR_MESSAGES.connectVault,
};

/** The controls that start one of the slot's actions, and which. The rest start nothing that waits. */
const SLOT_ACTION: Partial<Record<SetupControlId, WriteAction>> = {
	createKey: 'createKey',
	test: 'test',
	connect: 'connect',
};

const BUSY_LABELS: Partial<Record<SetupControlId, string>> = {
	createKey: AUTHOR_MESSAGES.busyCreating,
	test: AUTHOR_MESSAGES.busyTesting,
	connect: AUTHOR_MESSAGES.busyConnecting,
};

const STEP_LABELS: ReadonlyArray<string> = [
	AUTHOR_MESSAGES.stepLabel1,
	AUTHOR_MESSAGES.stepLabel2,
	AUTHOR_MESSAGES.stepLabel3,
	AUTHOR_MESSAGES.stepLabel4,
	AUTHOR_MESSAGES.stepLabel5,
];

/**
 * One control, given what is running. While any of the slot's actions runs
 * every control that starts one is unpressable, and only the one that was
 * pressed says what it is doing (plugin-shell, "The panel's write actions show
 * when they are working and run one at a time"). Controls that start nothing
 * stay as they are: copying a key while a test runs hurts nothing.
 */
function control(id: SetupControlId, running: RunningAction | null): SetupControl {
	const action = SLOT_ACTION[id];
	if (action === undefined) {
		return { id, label: LABELS[id], disabled: false };
	}
	const pressed = running !== null && running.action === action;
	const busy = BUSY_LABELS[id];
	return {
		id,
		label: pressed && busy !== undefined ? busy : LABELS[id],
		disabled: running !== null,
	};
}

function keyState(snapshot: SetupSnapshot): 'none' | 'untested' | 'needs-username' {
	const { key, address, testedFor, username } = snapshot.facts;
	if (key === null || !key.exists) {
		return 'none';
	}
	const tested =
		address !== null &&
		testedFor !== null &&
		testedFor.keyPath === key.path &&
		testedFor.address === address.sshUrl;
	if (tested && (username === null || username === '')) {
		return 'needs-username';
	}
	return 'untested';
}

/**
 * The key section's controls, shown the same way on the first screen and in
 * the settings tab. They stay offered after a successful test, so a key can be
 * tested again — after the author adds it to GitLab on a second try, or after a
 * network failure — and a key with a password gets a new key beside the test.
 */
export function buildKeyControls(snapshot: SetupSnapshot, running: RunningAction | null): SetupControl[] {
	const kind = activeFailure(snapshot, 3)?.kind;
	if (keyState(snapshot) === 'none' || kind === 'key-exists') {
		return [control('createKey', running)];
	}
	// A key that cannot be used, for either reason, is replaced rather than
	// copied to GitLab: a new one is the way out, and the test stays offered
	// beside it for the author who fixed the old one instead.
	if (kind === 'key-protected' || kind === 'key-unreadable') {
		return [control('createKey', running), control('test', running)];
	}
	return [control('copyKey', running), control('openGitLab', running), control('test', running)];
}

function stepView(step: SetupStep, snapshot: SetupSnapshot, running: RunningAction | null): SetupStepView {
	switch (step) {
		case 1:
			return {
				step,
				heading: AUTHOR_MESSAGES.step1Heading,
				text: AUTHOR_MESSAGES.step1Text,
				controls: [control('getGit', running), control('checkAgain', running)],
			};
		case 2:
			return {
				step,
				heading: AUTHOR_MESSAGES.step2Heading,
				text: AUTHOR_MESSAGES.step2Text,
				controls: [control('openSettings', running)],
			};
		case 3: {
			const state = keyState(snapshot);
			if (state === 'needs-username') {
				return {
					step,
					heading: AUTHOR_MESSAGES.step3Heading,
					text: AUTHOR_MESSAGES.usernamePrompt,
					controls: [control('openSettings', running)],
				};
			}
			return {
				step,
				heading: AUTHOR_MESSAGES.step3Heading,
				text: state === 'none' ? AUTHOR_MESSAGES.keyIntro : AUTHOR_MESSAGES.step3TextUntested,
				controls: buildKeyControls(snapshot, running),
			};
		}
		case 4:
			return {
				step,
				heading: AUTHOR_MESSAGES.step4Heading,
				text: AUTHOR_MESSAGES.step4Text,
				controls: [control('connect', running)],
			};
		case 5:
			return {
				step,
				heading: AUTHOR_MESSAGES.step5Heading,
				text: AUTHOR_MESSAGES.step5Text,
				controls: [control('openSettings', running)],
			};
	}
}

/**
 * What was last said about one step: the last action's notice when it was about
 * this step, else the step's own recorded failure if it still applies. A notice
 * about another step would read as advice about this one, so it is not shown
 * here.
 */
export function noticeFor(snapshot: SetupSnapshot, step: SetupStep): string | null {
	if (snapshot.notice !== null && snapshot.notice.step === step) {
		return snapshot.notice.text;
	}
	const failure = activeFailure(snapshot, step);
	return failure === undefined ? null : failure.message;
}

/**
 * A step's recorded failure while it still applies. The fingerprint is checked
 * wherever a failure is read, not only where it is worded: a `key-protected`
 * that outlived a change of key would otherwise hide the controls for the new
 * one.
 */
function activeFailure(snapshot: SetupSnapshot, step: SetupStep): StepFailure | undefined {
	const failure = snapshot.failures[step];
	return failure !== undefined && failure.fingerprint === stepFingerprint(step, snapshot.facts) ? failure : undefined;
}

/** True until the first read of the facts: the screen then says so instead of showing the empty set as if it were the author's. */
export function awaitingFirstCheck(snapshot: SetupSnapshot): boolean {
	return !snapshot.checked;
}

/** All five steps with their state, for the settings tab's list — also when setup is complete. */
export function buildStepRows(snapshot: SetupSnapshot): SetupStepRow[] {
	const current = snapshot.progress.firstIncomplete;
	return snapshot.progress.complete.map((done, index) => {
		const step = (index + 1) as SetupStep;
		return {
			step,
			label: STEP_LABELS[index],
			state: done ? 'done' : step === current ? 'current' : 'todo',
		};
	});
}

/** Null when setup is complete: nothing to show, and the ready screen takes over. */
export function buildSetupView(
	snapshot: SetupSnapshot,
	running: RunningAction | null
): SetupView | null {
	const current = snapshot.progress.firstIncomplete;
	if (current === null) {
		return null;
	}

	return {
		title: AUTHOR_MESSAGES.setupTitle,
		progress: AUTHOR_TEMPLATES.stepOf(current),
		step: stepView(current, snapshot, running),
		notice: noticeFor(snapshot, current),
		steps: buildStepRows(snapshot),
	};
}
