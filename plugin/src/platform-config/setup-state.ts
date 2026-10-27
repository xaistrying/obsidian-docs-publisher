import type { GitFailureKind } from '../git-publishing/failures';
import type { ProjectAddress } from '../git-publishing/project-address';

/**
 * Whether an author can work yet, as five steps in the order they are done
 * (replace-rest-with-local-git-ssh design.md D10). It replaces the token-based
 * `ConnectionState`, which could only say "connected as someone" and could not
 * say what was missing.
 *
 * Decided from local facts only. Nothing here runs a process or touches the
 * network: gathering the facts is the controller's job, on an explicit trigger,
 * and this module only reads them. That separation is what lets the panel
 * redraw on every note switch without starting a process per keystroke.
 */
export type SetupStep = 1 | 2 | 3 | 4 | 5;

export interface SetupFacts {
	/** `git --version` ran. */
	gitInstalled: boolean;
	/** The saved project address, parsed and valid; null when none or damaged. */
	address: ProjectAddress | null;
	/** The key in use and whether its file is there. Null when none was found or chosen. */
	key: { path: string; exists: boolean } | null;
	/** The key and address the last successful test covered. */
	testedFor: { keyPath: string; address: string } | null;
	/** From the server's greeting, or typed. */
	username: string | null;
	/** The vault's origin is the address and a fetch has completed. Supplied by connecting (group 2). */
	vaultConnected: boolean;
	/**
	 * The effective name and email, from any scope, and where they come from:
	 * the vault's own settings, the computer's, or the system's. Absent when git
	 * could not say, or when the two come from different places.
	 */
	identity: { name: string; email: string; scope?: 'vault' | 'computer' | 'system' | 'other' } | null;
}

export function emptyFacts(): SetupFacts {
	return {
		gitInstalled: false,
		address: null,
		key: null,
		testedFor: null,
		username: null,
		vaultConnected: false,
		identity: null,
	};
}

/**
 * A step that failed after its facts said it was done: the key was accepted
 * when it was tested and refused today. `fingerprint` names the facts the
 * failure was about, so it stops applying by itself the moment those change —
 * a corrected address is not held back by the old address's failure, and no
 * code has to remember to clear it.
 */
export interface StepFailure {
	message: string;
	fingerprint: string;
	/** What kind of failure it was, so a surface can offer the right way out without comparing message text. */
	kind?: GitFailureKind;
}

export type StepFailures = Partial<Record<SetupStep, StepFailure>>;

export interface SetupProgress {
	/** One flag per step; index 0 is step 1. */
	complete: ReadonlyArray<boolean>;
	/** The first step not done, which is the one the panel shows. Null when ready. */
	firstIncomplete: SetupStep | null;
	ready: boolean;
}

export const SETUP_STEPS: ReadonlyArray<SetupStep> = [1, 2, 3, 4, 5];

/** What a step's failure is about. Two steps never share one, so one failure cannot hide another. */
export function stepFingerprint(step: SetupStep, facts: SetupFacts): string {
	switch (step) {
		case 1:
			return 'git';
		case 2:
			return facts.address === null ? '' : facts.address.sshUrl;
		case 3:
			return `${facts.key === null ? '' : facts.key.path}|${facts.address === null ? '' : facts.address.sshUrl}`;
		case 4:
			return facts.address === null ? '' : facts.address.sshUrl;
		case 5:
			return 'identity';
	}
}

function stepDone(step: SetupStep, facts: SetupFacts): boolean {
	switch (step) {
		case 1:
			return facts.gitInstalled;
		case 2:
			return facts.address !== null;
		case 3: {
			if (facts.address === null || facts.key === null || !facts.key.exists || facts.testedFor === null) {
				return false;
			}
			// The test covers the key and the address it was run with, and nothing
			// else: a different key, or the same key against another project, has
			// proved nothing. A username is part of the step because without one a
			// new document cannot name its owner.
			return (
				facts.testedFor.keyPath === facts.key.path &&
				facts.testedFor.address === facts.address.sshUrl &&
				facts.username !== null &&
				facts.username !== ''
			);
		}
		case 4:
			return facts.vaultConnected;
		case 5:
			return facts.identity !== null && facts.identity.name !== '' && facts.identity.email !== '';
	}
}

export function computeProgress(facts: SetupFacts, failures: StepFailures): SetupProgress {
	const complete = SETUP_STEPS.map((step) => {
		const failure = failures[step];
		if (failure !== undefined && failure.fingerprint === stepFingerprint(step, facts)) {
			return false;
		}
		return stepDone(step, facts);
	});
	const index = complete.indexOf(false);
	return {
		complete,
		firstIncomplete: index === -1 ? null : SETUP_STEPS[index],
		ready: index === -1,
	};
}

/**
 * The step an author goes back to when an action fails, or null when the
 * failure is about the moment (no network, a timeout, a branch that moved) and
 * nothing the author has set up is wrong.
 */
export function stepForFailure(kind: GitFailureKind): SetupStep | null {
	switch (kind) {
		case 'git-missing':
			return 1;
		case 'address-invalid':
		case 'project-not-found':
		case 'address-rewritten':
			return 2;
		case 'ssh-missing':
		case 'key-rejected':
		case 'key-protected':
		case 'key-unreadable':
		case 'key-exists':
		case 'host-changed':
			return 3;
		case 'identity-missing':
			return 5;
		case 'server-unreachable':
		case 'empty-repository':
		case 'not-allowed':
		case 'changed-meanwhile':
		case 'timed-out':
		case 'unexpected':
			return null;
	}
}

/**
 * What last happened on a setup step, said on that step. Apart from the
 * failures above because it does not invalidate anything: "could not reach
 * GitLab" says the network is down, not that the key is wrong.
 */
export interface SetupNotice {
	step: SetupStep;
	text: string;
}

export interface SetupSnapshot {
	facts: SetupFacts;
	/**
	 * Whether the facts have been read at all this session. Until they have,
	 * `facts` is the empty set, which says "no git, no address, no key": true of
	 * nothing, and wrong to show an author whose setup is complete.
	 */
	checked: boolean;
	failures: StepFailures;
	progress: SetupProgress;
	notice: SetupNotice | null;
}

/** Structural equality for the small plain objects held here. */
function same(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

type Listener = (snapshot: SetupSnapshot) => void;

/**
 * Holds setup for the running session and tells whoever is showing it. The
 * panel and the settings tab both read this and neither knows the other
 * exists, so a step finished in one is shown by the other without either
 * reaching across — the pattern `ConnectionStateHolder` set for the token.
 * Never persisted: the saved settings are the persistence, and the facts are
 * read from them.
 */
export class SetupStateHolder {
	private snapshot: SetupSnapshot;
	private readonly listeners = new Set<Listener>();

	constructor() {
		const facts = emptyFacts();
		this.snapshot = { facts, checked: false, failures: {}, progress: computeProgress(facts, {}), notice: null };
	}

	get current(): SetupSnapshot {
		return this.snapshot;
	}

	/**
	 * Says nothing when nothing changed. Every listener redraws, and a redraw
	 * that rebuilds a button between the press and the release loses the click
	 * (the panel's history records it), so a refresh that finds the same facts
	 * must not look like news.
	 */
	setFacts(facts: SetupFacts): void {
		if (this.snapshot.checked && same(this.snapshot.facts, facts)) {
			return;
		}
		this.publish({ ...this.snapshot, facts, checked: true });
	}

	/** Marks a step incomplete because of something that happened to it, against the facts as they stand now. */
	failStep(step: SetupStep, message: string, kind?: GitFailureKind): void {
		const failure: StepFailure = { message, fingerprint: stepFingerprint(step, this.snapshot.facts), kind };
		if (same(this.snapshot.failures[step], failure)) {
			return;
		}
		this.publish({ ...this.snapshot, failures: { ...this.snapshot.failures, [step]: failure } });
	}

	clearFailure(step: SetupStep): void {
		if (this.snapshot.failures[step] === undefined) {
			return;
		}
		const failures: StepFailures = { ...this.snapshot.failures };
		delete failures[step];
		this.publish({ ...this.snapshot, failures });
	}

	setNotice(notice: SetupNotice | null): void {
		if (same(this.snapshot.notice, notice)) {
			return;
		}
		this.publish({ ...this.snapshot, notice });
	}

	/** Subscribes, and returns the function that unsubscribes again. */
	onChange(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	private publish(next: Omit<SetupSnapshot, 'progress'>): void {
		this.snapshot = { ...next, progress: computeProgress(next.facts, next.failures) };
		// Copy first: a listener may unsubscribe itself while being notified.
		for (const listener of [...this.listeners]) {
			listener(this.snapshot);
		}
	}
}
