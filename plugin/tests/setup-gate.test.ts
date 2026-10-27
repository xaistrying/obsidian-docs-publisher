import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTHOR_MESSAGES } from '../src/author-messages';
import { parseProjectAddress } from '../src/git-publishing/project-address';
import type { ProjectAddress } from '../src/git-publishing/project-address';
import { requireSetup, setupGate } from '../src/platform-config/setup-gate';
import { SetupStateHolder, computeProgress } from '../src/platform-config/setup-state';
import type { SetupFacts } from '../src/platform-config/setup-state';

const shown: string[] = [];
vi.mock('obsidian', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	Notice: class {
		constructor(message: string) {
			shown.push(message);
		}
	},
}));

const ADDRESS = parseProjectAddress('git@gitlab.example.com:docs/kb.git') as ProjectAddress;
const KEY = '/home/ana/.ssh/docs-publisher_ed25519';

function allGood(): SetupFacts {
	return {
		gitInstalled: true,
		address: ADDRESS,
		key: { path: KEY, exists: true },
		testedFor: { keyPath: KEY, address: ADDRESS.sshUrl },
		username: 'ana',
		vaultConnected: true,
		identity: { name: 'Ana', email: 'a@x' },
	};
}

const NOT_READY = AUTHOR_MESSAGES.notReady;

describe('whether an action may start', () => {
	it('lets an action that needs everything start when everything is done', () => {
		expect(setupGate(computeProgress(allGood(), {}), 'all')).toEqual({ ok: true });
	});

	const spoilers: Array<[string, Partial<SetupFacts>]> = [
		['git cannot be run', { gitInstalled: false }],
		['there is no project address', { address: null }],
		['the key was never tested', { testedFor: null }],
		['the vault is not connected', { vaultConnected: false }],
		['there is no name and email', { identity: null }],
	];
	for (const [label, change] of spoilers) {
		it(`refuses an action that needs everything when ${label}, and says what to do`, () => {
			const gate = setupGate(computeProgress({ ...allGood(), ...change }, {}), 'all');

			expect(gate).toEqual({ ok: false, message: NOT_READY });
		});
	}

	describe('connecting the vault, which comes before the vault is connected', () => {
		it('needs only git, the address and the key', () => {
			const progress = computeProgress({ ...allGood(), vaultConnected: false, identity: null }, {});

			expect(setupGate(progress, 'connecting')).toEqual({ ok: true });
		});

		for (const [label, change] of spoilers.slice(0, 3)) {
			it(`is refused when ${label}`, () => {
				expect(setupGate(computeProgress({ ...allGood(), ...change }, {}), 'connecting')).toEqual({
					ok: false,
					message: NOT_READY,
				});
			});
		}
	});

	it('asks the author to wait, and not to finish setup, before setup has been read at all', () => {
		const holder = new SetupStateHolder();

		expect(setupGate(holder.current.progress, 'all', holder.current.checked)).toEqual({
			ok: false,
			message: AUTHOR_MESSAGES.stillChecking,
		});
	});

	it('refuses while a step the author finished has since failed', () => {
		const holder = new SetupStateHolder();
		holder.setFacts(allGood());
		holder.failStep(3, 'refused');

		expect(setupGate(holder.current.progress, 'all').ok).toBe(false);
	});
});

describe('stopping an action that was started from the command palette', () => {
	beforeEach(() => {
		shown.length = 0;
	});

	it('does nothing, and says what to do, for each of the first three steps left undone', () => {
		for (const change of [{ gitInstalled: false }, { address: null }, { testedFor: null }] as Array<Partial<SetupFacts>>) {
			const holder = new SetupStateHolder();
			holder.setFacts({ ...allGood(), ...change });

			expect(requireSetup(holder, 'all')).toBe(false);
		}

		expect(shown).toEqual([NOT_READY, NOT_READY, NOT_READY]);
	});

	it('says setup is still being checked, not that it is unfinished, when the command comes before the first read', () => {
		const holder = new SetupStateHolder();

		expect(requireSetup(holder, 'all')).toBe(false);
		expect(shown).toEqual([AUTHOR_MESSAGES.stillChecking]);
	});

	it('says nothing when setup is complete', () => {
		const holder = new SetupStateHolder();
		holder.setFacts(allGood());

		expect(requireSetup(holder, 'all')).toBe(true);
		expect(shown).toEqual([]);
	});
});
