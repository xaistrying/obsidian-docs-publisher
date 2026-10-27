import { describe, expect, it, vi } from 'vitest';
import { parseProjectAddress } from '../src/git-publishing/project-address';
import type { ProjectAddress } from '../src/git-publishing/project-address';
import {
	SetupStateHolder,
	computeProgress,
	emptyFacts,
	stepForFailure,
} from '../src/platform-config/setup-state';
import type { SetupFacts } from '../src/platform-config/setup-state';

const ADDRESS = parseProjectAddress('git@gitlab.example.com:docs/kb.git') as ProjectAddress;
const OTHER = parseProjectAddress('git@gitlab.example.com:docs/other.git') as ProjectAddress;
const KEY = '/home/ana/.ssh/docs-publisher_ed25519';

/** Everything in order, so each test spoils exactly one thing. */
function allGood(): SetupFacts {
	return {
		gitInstalled: true,
		address: ADDRESS,
		key: { path: KEY, exists: true },
		testedFor: { keyPath: KEY, address: ADDRESS.sshUrl },
		username: 'ana.nguyen',
		vaultConnected: true,
		identity: { name: 'Ana', email: 'ana@example.com' },
	};
}

describe('working out which setup steps are done', () => {
	it('is ready when every fact is in order', () => {
		const progress = computeProgress(allGood(), {});

		expect(progress.complete).toEqual([true, true, true, true, true]);
		expect(progress.firstIncomplete).toBeNull();
		expect(progress.ready).toBe(true);
	});

	it('starts a fresh machine at the project address, with git found', () => {
		const progress = computeProgress({ ...emptyFacts(), gitInstalled: true }, {});

		expect(progress.complete).toEqual([true, false, false, false, false]);
		expect(progress.firstIncomplete).toBe(2);
	});

	it('does not show the identity step to an author who already has one machine-wide', () => {
		const facts: SetupFacts = { ...emptyFacts(), gitInstalled: true, identity: { name: 'Ana', email: 'a@x' } };

		const progress = computeProgress(facts, {});

		// Step 5 is done while 2 to 4 are not: the steps are decided one by one,
		// and the panel shows the first that is not.
		expect(progress.complete).toEqual([true, false, false, false, true]);
		expect(progress.firstIncomplete).toBe(2);
	});

	it('starts at step 1 when git cannot be run', () => {
		expect(computeProgress({ ...allGood(), gitInstalled: false }, {}).firstIncomplete).toBe(1);
	});

	describe('the key step', () => {
		it('needs a key that exists', () => {
			const progress = computeProgress({ ...allGood(), key: { path: KEY, exists: false } }, {});

			expect(progress.complete[2]).toBe(false);
		});

		it('needs a key at all', () => {
			expect(computeProgress({ ...allGood(), key: null }, {}).complete[2]).toBe(false);
		});

		it('needs a test that covered this very key', () => {
			const facts = { ...allGood(), testedFor: { keyPath: '/home/ana/.ssh/id_rsa', address: ADDRESS.sshUrl } };

			expect(computeProgress(facts, {}).complete[2]).toBe(false);
		});

		it('needs a test that covered this very address', () => {
			const facts = { ...allGood(), testedFor: { keyPath: KEY, address: OTHER.sshUrl } };

			expect(computeProgress(facts, {}).complete[2]).toBe(false);
		});

		it('needs a test at all', () => {
			expect(computeProgress({ ...allGood(), testedFor: null }, {}).complete[2]).toBe(false);
		});

		it('needs a username, even after a test that worked', () => {
			expect(computeProgress({ ...allGood(), username: null }, {}).complete[2]).toBe(false);
			expect(computeProgress({ ...allGood(), username: '' }, {}).complete[2]).toBe(false);
		});

		it('is not complete with no address to have tested against', () => {
			expect(computeProgress({ ...allGood(), address: null }, {}).complete[2]).toBe(false);
		});
	});

	describe('the identity step', () => {
		it('needs both a name and an email', () => {
			expect(computeProgress({ ...allGood(), identity: { name: 'Ana', email: '' } }, {}).complete[4]).toBe(false);
			expect(computeProgress({ ...allGood(), identity: { name: '', email: 'a@x' } }, {}).complete[4]).toBe(false);
			expect(computeProgress({ ...allGood(), identity: null }, {}).complete[4]).toBe(false);
		});
	});

	describe('a failure met later', () => {
		it('marks its step incomplete even though the saved facts still say it is done', () => {
			const progress = computeProgress(allGood(), {
				3: { message: 'refused', fingerprint: `${KEY}|${ADDRESS.sshUrl}` },
			});

			expect(progress.complete[2]).toBe(false);
			expect(progress.firstIncomplete).toBe(3);
			expect(progress.ready).toBe(false);
		});

		it('stops applying once what it was about changes, so a corrected address is not held back by the old one\'s failure', () => {
			const failures = { 2: { message: 'not found', fingerprint: ADDRESS.sshUrl } };

			expect(computeProgress(allGood(), failures).complete[1]).toBe(false);
			expect(computeProgress({ ...allGood(), address: OTHER, testedFor: { keyPath: KEY, address: OTHER.sshUrl } }, failures).complete[1]).toBe(true);
		});

		it('stops applying when the key changes', () => {
			const failures = { 3: { message: 'refused', fingerprint: `${KEY}|${ADDRESS.sshUrl}` } };
			const other = '/home/ana/.ssh/id_ed25519';

			const progress = computeProgress(
				{ ...allGood(), key: { path: other, exists: true }, testedFor: { keyPath: other, address: ADDRESS.sshUrl } },
				failures
			);

			expect(progress.complete[2]).toBe(true);
		});
	});
});

describe('which step a failure sends the author back to', () => {
	const cases: Array<[Parameters<typeof stepForFailure>[0], ReturnType<typeof stepForFailure>]> = [
		['git-missing', 1],
		['address-invalid', 2],
		['project-not-found', 2],
		['ssh-missing', 3],
		['key-rejected', 3],
		['key-protected', 3],
		['key-unreadable', 3],
		['key-exists', 3],
		['address-rewritten', 2],
		['host-changed', 3],
		['identity-missing', 5],
		['server-unreachable', null],
		['empty-repository', null],
		['not-allowed', null],
		['changed-meanwhile', null],
		['timed-out', null],
		['unexpected', null],
	];
	for (const [kind, step] of cases) {
		it(`sends ${kind} to ${step === null ? 'no step' : `step ${step}`}`, () => {
			expect(stepForFailure(kind)).toBe(step);
		});
	}
});

describe('the one place every surface reads setup from', () => {
	it('starts with nothing done', () => {
		const holder = new SetupStateHolder();

		expect(holder.current.progress.ready).toBe(false);
		expect(holder.current.progress.firstIncomplete).toBe(1);
		expect(holder.current.notice).toBeNull();
	});

	it('tells every listener when the facts change, and not after one has unsubscribed', () => {
		const holder = new SetupStateHolder();
		const first = vi.fn();
		const second = vi.fn();
		holder.onChange(first);
		const stop = holder.onChange(second);

		holder.setFacts(allGood());
		stop();
		holder.setFacts({ ...allGood(), gitInstalled: false });

		expect(first).toHaveBeenCalledTimes(2);
		expect(second).toHaveBeenCalledTimes(1);
	});

	it('lets a listener unsubscribe itself while it is being told', () => {
		const holder = new SetupStateHolder();
		const calls: string[] = [];
		const stop = holder.onChange(() => {
			calls.push('a');
			stop();
		});
		holder.onChange(() => calls.push('b'));

		holder.setFacts(allGood());

		expect(calls).toEqual(['a', 'b']);
	});

	it('recomputes progress from the facts it is given', () => {
		const holder = new SetupStateHolder();

		holder.setFacts(allGood());

		expect(holder.current.progress.ready).toBe(true);
	});

	it('records a failure against the facts as they stand, and marks the step incomplete', () => {
		const holder = new SetupStateHolder();
		holder.setFacts(allGood());

		holder.failStep(3, 'refused');

		expect(holder.current.progress.firstIncomplete).toBe(3);
		expect(holder.current.failures[3]?.message).toBe('refused');
	});

	it('forgets a failure when told the step was put right', () => {
		const holder = new SetupStateHolder();
		holder.setFacts(allGood());
		holder.failStep(3, 'refused');

		holder.clearFailure(3);

		expect(holder.current.progress.ready).toBe(true);
	});

	it('forgets a failure of its own accord when the facts it was about change', () => {
		const holder = new SetupStateHolder();
		holder.setFacts(allGood());
		holder.failStep(2, 'not found');

		holder.setFacts({ ...allGood(), address: OTHER, testedFor: { keyPath: KEY, address: OTHER.sshUrl } });

		expect(holder.current.progress.complete[1]).toBe(true);
	});

	it('keeps a notice apart from completeness, for what happened without invalidating anything', () => {
		const holder = new SetupStateHolder();
		holder.setFacts(allGood());

		holder.setNotice({ step: 3, text: 'Could not reach GitLab' });

		expect(holder.current.notice).toEqual({ step: 3, text: 'Could not reach GitLab' });
		expect(holder.current.progress.ready).toBe(true);

		holder.setNotice(null);
		expect(holder.current.notice).toBeNull();
	});

	it('has not read anything until it is given the facts, and has afterwards', () => {
		const holder = new SetupStateHolder();
		expect(holder.current.checked).toBe(false);

		holder.setFacts(allGood());

		expect(holder.current.checked).toBe(true);
	});

	// A listener redraws, and a redraw that rebuilds a button between the press
	// and the release loses the click, so announcing no change is a defect.
	it('says nothing when it is given what it already holds', () => {
		const holder = new SetupStateHolder();
		holder.setFacts(allGood());
		holder.failStep(3, 'refused', 'key-rejected');
		holder.setNotice({ step: 3, text: 'same' });
		const heard = vi.fn();
		holder.onChange(heard);

		holder.setFacts(allGood());
		holder.failStep(3, 'refused', 'key-rejected');
		holder.setNotice({ step: 3, text: 'same' });
		holder.setNotice({ step: 3, text: 'same' });
		holder.clearFailure(2);

		expect(heard).not.toHaveBeenCalled();
	});

	it('says so when any of them does change', () => {
		const holder = new SetupStateHolder();
		holder.setFacts(allGood());
		const heard = vi.fn();
		holder.onChange(heard);

		holder.setFacts({ ...allGood(), username: 'someone.else' });
		holder.setNotice({ step: 3, text: 'new' });
		holder.failStep(3, 'refused');
		holder.failStep(3, 'refused for another reason');

		expect(heard).toHaveBeenCalledTimes(4);
	});

	it('keeps a notice across a refresh of the facts: only the next action replaces it', () => {
		const holder = new SetupStateHolder();
		holder.setFacts(allGood());
		holder.setNotice({ step: 3, text: 'old news' });

		holder.setFacts(allGood());

		expect(holder.current.notice).toEqual({ step: 3, text: 'old news' });
	});
});
