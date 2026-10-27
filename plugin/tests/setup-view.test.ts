import { describe, expect, it } from 'vitest';
import { AUTHOR_MESSAGES, AUTHOR_TEMPLATES } from '../src/author-messages';
import { parseProjectAddress } from '../src/git-publishing/project-address';
import type { ProjectAddress } from '../src/git-publishing/project-address';
import { awaitingFirstCheck, buildKeyControls, buildSetupView } from '../src/platform-config/setup-view';
import { SetupStateHolder } from '../src/platform-config/setup-state';
import type { SetupFacts, SetupSnapshot } from '../src/platform-config/setup-state';

const ADDRESS = parseProjectAddress('git@gitlab.example.com:docs/kb.git') as ProjectAddress;
const KEY = '/home/ana/.ssh/docs-publisher_ed25519';

function snapshot(overrides: Partial<SetupFacts> = {}, edit?: (holder: SetupStateHolder) => void): SetupSnapshot {
	const holder = new SetupStateHolder();
	holder.setFacts({
		gitInstalled: true,
		address: ADDRESS,
		key: { path: KEY, exists: true },
		testedFor: { keyPath: KEY, address: ADDRESS.sshUrl },
		username: 'ana',
		vaultConnected: true,
		identity: { name: 'Ana', email: 'a@x' },
		...overrides,
	});
	edit?.(holder);
	return holder.current;
}

const labels = (controls: Array<{ label: string }>): string[] => controls.map((c) => c.label);

describe('before setup has been read', () => {
	it('is known, so the screen can say it is checking instead of showing the empty facts as the author\'s', () => {
		const holder = new SetupStateHolder();

		expect(awaitingFirstCheck(holder.current)).toBe(true);
		// What would be shown if nothing asked: git missing, on a machine that has it.
		expect(buildSetupView(holder.current, null)?.step.step).toBe(1);
	});

	it('is over once the facts are in', () => {
		expect(awaitingFirstCheck(snapshot())).toBe(false);
	});
});

describe('what the first screen shows', () => {
	it('shows nothing once setup is complete, so the ready screen can take over', () => {
		expect(buildSetupView(snapshot(), null)).toBeNull();
	});

	it('names the step and how far along the author is', () => {
		const view = buildSetupView(snapshot({ address: null }), null);

		expect(view?.title).toBe(AUTHOR_MESSAGES.setupTitle);
		expect(view?.progress).toBe(AUTHOR_TEMPLATES.stepOf(2));
	});

	it('shows only the first step that is not done', () => {
		const view = buildSetupView(snapshot({ address: null, vaultConnected: false }), null);

		expect(view?.step?.step).toBe(2);
	});

	describe('step 1: git', () => {
		const view = buildSetupView(snapshot({ gitInstalled: false }), null);

		it('says git is missing and how to get it, and offers to check again', () => {
			expect(view?.step?.heading).toBe(AUTHOR_MESSAGES.step1Heading);
			expect(view?.step?.text).toBe(AUTHOR_MESSAGES.step1Text);
			expect(labels(view?.step?.controls ?? [])).toEqual([AUTHOR_MESSAGES.getGit, AUTHOR_MESSAGES.checkAgain]);
		});
	});

	describe('step 2: the project address', () => {
		it('sends the author to the settings, where there is room to paste', () => {
			const view = buildSetupView(snapshot({ address: null }), null);

			expect(view?.step?.heading).toBe(AUTHOR_MESSAGES.step2Heading);
			expect(view?.step?.text).toBe(AUTHOR_MESSAGES.step2Text);
			expect(labels(view?.step?.controls ?? [])).toEqual([AUTHOR_MESSAGES.openSettings]);
		});
	});

	describe('step 3: the key', () => {
		it('offers to create one when there is none', () => {
			const view = buildSetupView(snapshot({ key: null, testedFor: null }), null);

			expect(view?.step?.heading).toBe(AUTHOR_MESSAGES.step3Heading);
			expect(view?.step?.text).toBe(AUTHOR_MESSAGES.keyIntro);
			expect(labels(view?.step?.controls ?? [])).toEqual([AUTHOR_MESSAGES.createKey]);
		});

		it('offers to create one when the saved key has gone', () => {
			const view = buildSetupView(snapshot({ key: { path: KEY, exists: false }, testedFor: null }), null);

			expect(labels(view?.step?.controls ?? [])).toEqual([AUTHOR_MESSAGES.createKey]);
		});

		it('offers to copy, open GitLab and test once there is a key not yet tested', () => {
			const view = buildSetupView(snapshot({ testedFor: null }), null);

			expect(view?.step?.text).toBe(AUTHOR_MESSAGES.step3TextUntested);
			expect(labels(view?.step?.controls ?? [])).toEqual([
				AUTHOR_MESSAGES.copyKey,
				AUTHOR_MESSAGES.openGitLab,
				AUTHOR_MESSAGES.test,
			]);
		});

		it('asks for a username when the key works but no one could say whose it is', () => {
			const view = buildSetupView(snapshot({ username: null }), null);

			expect(view?.step?.text).toBe(AUTHOR_MESSAGES.usernamePrompt);
			expect(labels(view?.step?.controls ?? [])).toEqual([AUTHOR_MESSAGES.openSettings]);
		});

		it('offers a new key and another test when the key has a password', () => {
			const view = buildSetupView(
				snapshot({ testedFor: null }, (h) => {
					h.failStep(3, AUTHOR_MESSAGES.keyProtected, 'key-protected');
					h.setNotice({ step: 3, text: AUTHOR_MESSAGES.keyProtected });
				}),
				null
			);

			expect(view?.notice).toBe(AUTHOR_MESSAGES.keyProtected);
			expect(labels(view?.step?.controls ?? [])).toEqual([AUTHOR_MESSAGES.createKey, AUTHOR_MESSAGES.test]);
		});

		it('offers a new key and another test for a key that cannot be read', () => {
			const view = buildSetupView(
				snapshot({ testedFor: null }, (h) => {
					h.failStep(3, AUTHOR_MESSAGES.keyUnreadable, 'key-unreadable');
				}),
				null
			);

			expect(view?.notice).toBe(AUTHOR_MESSAGES.keyUnreadable);
			expect(labels(view?.step?.controls ?? [])).toEqual([AUTHOR_MESSAGES.createKey, AUTHOR_MESSAGES.test]);
		});

		it('offers only to create a key when a file in the way stops one being made', () => {
			const view = buildSetupView(
				snapshot({ testedFor: null }, (h) => {
					h.failStep(3, AUTHOR_MESSAGES.keyExists, 'key-exists');
				}),
				null
			);

			expect(view?.notice).toBe(AUTHOR_MESSAGES.keyExists);
			expect(labels(view?.step?.controls ?? [])).toEqual([AUTHOR_MESSAGES.createKey]);
		});

		// The complaint was about the key that was there then. Reading its kind
		// without asking whether it still applies would hide Copy key and Open
		// GitLab from a key that has nothing wrong with it.
		it('does not let a complaint about a previous key change which controls the new key gets', () => {
			const holder = new SetupStateHolder();
			const facts = {
				gitInstalled: true,
				address: ADDRESS,
				key: { path: KEY, exists: true },
				testedFor: null,
				username: null,
				vaultConnected: false,
				identity: null,
			};
			holder.setFacts(facts);
			holder.failStep(3, AUTHOR_MESSAGES.keyProtected, 'key-protected');
			holder.setFacts({ ...facts, key: { path: '/home/ana/.ssh/id_ed25519', exists: true } });

			expect(labels(buildKeyControls(holder.current, null))).toEqual([
				AUTHOR_MESSAGES.copyKey,
				AUTHOR_MESSAGES.openGitLab,
				AUTHOR_MESSAGES.test,
			]);
		});

		it('shows the same controls after GitLab refuses a key as before the first test', () => {
			const view = buildSetupView(
				snapshot({}, (h) => {
					h.failStep(3, AUTHOR_MESSAGES.keyRejected);
				}),
				null
			);

			expect(view?.notice).toBe(AUTHOR_MESSAGES.keyRejected);
			expect(labels(view?.step?.controls ?? [])).toEqual([
				AUTHOR_MESSAGES.copyKey,
				AUTHOR_MESSAGES.openGitLab,
				AUTHOR_MESSAGES.test,
			]);
		});
	});

	describe('step 4: connecting the vault', () => {
		const incomplete = snapshot({ vaultConnected: false });

		it('says what connecting does, and offers to connect', () => {
			const view = buildSetupView(incomplete, null);

			expect(view?.step?.heading).toBe(AUTHOR_MESSAGES.step4Heading);
			expect(view?.step?.text).toBe(AUTHOR_MESSAGES.step4Text);
			expect(labels(view?.step?.controls ?? [])).toEqual([AUTHOR_MESSAGES.connectVault]);
		});

		it('shows Connecting… on the control while it runs, and leaves it unpressable', () => {
			const view = buildSetupView(incomplete, { action: 'connect', target: '' });

			expect(view?.step?.controls).toEqual([{ id: 'connect', label: AUTHOR_MESSAGES.busyConnecting, disabled: true }]);
		});

		it('keeps a refusal on the step after the message that said it is replaced', () => {
			const refused = snapshot({ vaultConnected: false }, (h) => {
				h.failStep(4, AUTHOR_MESSAGES.foreignOrigin);
				h.setNotice(null);
			});

			expect(buildSetupView(refused, null)?.notice).toBe(AUTHOR_MESSAGES.foreignOrigin);
		});
	});

	describe('step 5: name and email', () => {
		it('sends the author to the settings', () => {
			const view = buildSetupView(snapshot({ identity: null }), null);

			expect(view?.step?.heading).toBe(AUTHOR_MESSAGES.step5Heading);
			expect(view?.step?.text).toBe(AUTHOR_MESSAGES.step5Text);
			expect(labels(view?.step?.controls ?? [])).toEqual([AUTHOR_MESSAGES.openSettings]);
		});
	});

	describe('what happened on the last action', () => {
		it('is shown on the step it was about', () => {
			const view = buildSetupView(
				snapshot({ testedFor: null }, (h) => h.setNotice({ step: 3, text: AUTHOR_MESSAGES.serverUnreachable })),
				null
			);

			expect(view?.notice).toBe(AUTHOR_MESSAGES.serverUnreachable);
		});

		it('is not shown on a different step, where it would be about something else', () => {
			const view = buildSetupView(
				snapshot({ address: null }, (h) => h.setNotice({ step: 3, text: AUTHOR_MESSAGES.serverUnreachable })),
				null
			);

			expect(view?.notice).toBeNull();
		});

		it('falls back to the step\'s own recorded failure when no notice is set', () => {
			const view = buildSetupView(snapshot({ gitInstalled: true }, (h) => h.failStep(1, AUTHOR_MESSAGES.gitMissing)), null);

			expect(view?.step?.step).toBe(1);
			expect(view?.notice).toBe(AUTHOR_MESSAGES.gitMissing);
		});
	});

	describe('while an action runs', () => {
		const untested = snapshot({ testedFor: null });

		it('labels the control that was pressed as busy and stops it being pressed again', () => {
			const view = buildSetupView(untested, { action: 'test', target: '' });
			const test = view?.step?.controls.find((c) => c.id === 'test');

			expect(test?.label).toBe(AUTHOR_MESSAGES.busyTesting);
			expect(test?.disabled).toBe(true);
		});

		it('leaves the other action controls in place with their own labels, unpressable', () => {
			const noKey = snapshot({ key: null, testedFor: null });
			const view = buildSetupView(noKey, { action: 'test', target: '' });
			const create = view?.step?.controls.find((c) => c.id === 'createKey');

			expect(create?.label).toBe(AUTHOR_MESSAGES.createKey);
			expect(create?.disabled).toBe(true);
		});

		it('leaves the controls that start nothing alone', () => {
			const view = buildSetupView(untested, { action: 'test', target: '' });

			expect(view?.step?.controls.find((c) => c.id === 'copyKey')?.disabled).toBe(false);
			expect(view?.step?.controls.find((c) => c.id === 'openGitLab')?.disabled).toBe(false);
		});

		it('labels a key being created as busy', () => {
			const noKey = snapshot({ key: null, testedFor: null });
			const view = buildSetupView(noKey, { action: 'createKey', target: '' });

			expect(view?.step?.controls[0].label).toBe(AUTHOR_MESSAGES.busyCreating);
		});

		it('is not misled by an action that belongs to another surface', () => {
			const view = buildSetupView(untested, { action: 'submit', target: 'a.md' });
			const test = view?.step?.controls.find((c) => c.id === 'test');

			expect(test?.label).toBe(AUTHOR_MESSAGES.test);
			expect(test?.disabled).toBe(true);
		});
	});

	describe('the list of all five steps, for the settings tab', () => {
		it('marks done, current and to-do, with the current one being the first not done', () => {
			const view = buildSetupView(snapshot({ address: null, vaultConnected: false }), null);

			expect(view?.steps.map((s) => s.state)).toEqual(['done', 'current', 'todo', 'todo', 'done']);
			expect(view?.steps.map((s) => s.label)).toEqual([
				AUTHOR_MESSAGES.stepLabel1,
				AUTHOR_MESSAGES.stepLabel2,
				AUTHOR_MESSAGES.stepLabel3,
				AUTHOR_MESSAGES.stepLabel4,
				AUTHOR_MESSAGES.stepLabel5,
			]);
		});
	});
});

describe('the key section\'s controls, wherever they are shown', () => {
	it('are the same as the first screen\'s for a key not yet tested', () => {
		const controls = buildKeyControls(snapshot({ testedFor: null }), null);

		expect(labels(controls)).toEqual([AUTHOR_MESSAGES.copyKey, AUTHOR_MESSAGES.openGitLab, AUTHOR_MESSAGES.test]);
	});

	it('still offer the key controls after the key has been tested, so it can be tested again', () => {
		const controls = buildKeyControls(snapshot(), null);

		expect(labels(controls)).toEqual([AUTHOR_MESSAGES.copyKey, AUTHOR_MESSAGES.openGitLab, AUTHOR_MESSAGES.test]);
	});

	it('offer only to create a key when there is none', () => {
		expect(labels(buildKeyControls(snapshot({ key: null }), null))).toEqual([AUTHOR_MESSAGES.createKey]);
	});
});
