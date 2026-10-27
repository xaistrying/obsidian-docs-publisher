import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitRequest, GitRunner } from '../src/git-publishing/git-runner';
import type { RepoContext } from '../src/git-publishing/repo';
import { DerivedStatesHolder, deriveFromFetchedCopy, refreshStates } from '../src/submission-tracking/derived-states';
import type { RefreshDeps } from '../src/submission-tracking/derived-states';
import { connectReceived } from './support/connect-received';
import { createLocalRemote } from './support/local-remote';
import type { LocalRemote } from './support/local-remote';

let remote: LocalRemote;
let vault: string;
let ctx: RepoContext;

beforeEach(async () => {
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
	remote = createLocalRemote();
	vault = mkdtempSync(join(tmpdir(), 'vault-'));
	ctx = { git: remote.runner(), cwd: vault };
	await connectReceived(ctx, remote.address);
});
afterEach(() => {
	remote.dispose();
	rmSync(vault, { recursive: true, force: true });
	vi.restoreAllMocks();
});

function deps(overrides: Partial<RefreshDeps> = {}): { deps: RefreshDeps; holder: DerivedStatesHolder; setupFailures: string[] } {
	const holder = new DerivedStatesHolder();
	const setupFailures: string[] = [];
	return {
		holder,
		setupFailures,
		deps: {
			holder,
			local: () => ctx,
			network: () => ({ ctx, address: remote.address }),
			docIds: () => ['Printer'],
			onSetupFailure: (failure) => {
				setupFailures.push(failure);
			},
			...overrides,
		},
	};
}

/** A runner that answers a fetch the way a server that does not know the key would, and everything else as normal. */
function refusingKey(): GitRunner {
	return {
		run: async (request: GitRequest) =>
			request.args[0] === 'fetch'
				? { exitCode: 128, stdout: Buffer.alloc(0), stderr: 'git@gitlab.example.com: Permission denied (publickey).', timedOut: false, truncated: false, spawnError: null }
				: ctx.git.run(request),
	};
}

describe('refreshing document states', () => {
	it('fetches once and derives every document from what arrived', async () => {
		remote.publish('doc/Printer', { 'Docs/Printer.md': 'text' });
		const t = deps();

		await refreshStates(t.deps);

		expect(t.holder.lastOutcome).toEqual({ kind: 'succeeded' });
		expect(t.holder.statusFor('Printer')?.state).toBe('pending');
	});

	it('picks up what changed on the project since the last refresh', async () => {
		const t = deps();
		await refreshStates(t.deps);
		expect(t.holder.statusFor('Printer')?.state).toBe('closed');

		remote.publish('main', { 'Docs/Printer.md': 'now published' });
		await refreshStates(t.deps);

		expect(t.holder.statusFor('Printer')?.state).toBe('published');
	});

	it('keeps the last known states, and says the refresh failed, when the fetch fails', async () => {
		remote.publish('doc/Printer', { 'Docs/Printer.md': 'text' });
		const t = deps();
		await refreshStates(t.deps);
		rmSync(remote.bare, { recursive: true, force: true });

		await refreshStates(t.deps);

		expect(t.holder.lastOutcome.kind).toBe('failed');
		expect(t.holder.statusFor('Printer')?.state).toBe('pending');
		expect(t.setupFailures).toEqual([]);
	});

	it('reports a key the server no longer accepts to setup, and still keeps the states', async () => {
		remote.publish('doc/Printer', { 'Docs/Printer.md': 'text' });
		const t = deps();
		await refreshStates(t.deps);
		const refused = deps({ holder: t.holder, network: () => ({ ctx: { ...ctx, git: refusingKey() }, address: remote.address }) });

		await refreshStates(refused.deps);

		expect(t.holder.lastOutcome).toEqual({ kind: 'failed', failure: 'key-rejected' });
		expect(refused.setupFailures).toEqual(['key-rejected']);
		expect(t.holder.statusFor('Printer')?.state).toBe('pending');
	});

	it('shows no state for any document when the very first refresh fails', async () => {
		const t = deps({ network: () => ({ ctx: { ...ctx, git: refusingKey() }, address: remote.address }) });
		remote.git(vault, 'update-ref', '-d', 'refs/remotes/origin/main');

		await refreshStates(t.deps);

		expect(t.holder.current).toBeNull();
		expect(t.holder.lastOutcome.kind).toBe('failed');
	});

	it('fails, and starts nothing, when no key has been chosen', async () => {
		const t = deps({ network: () => null });

		await refreshStates(t.deps);

		expect(t.holder.lastOutcome).toEqual({ kind: 'failed', failure: 'unexpected' });
	});

	it('is one refresh, not two, when it is asked for again while it runs', async () => {
		const fetches: string[] = [];
		const watching: GitRunner = {
			run: (request) => {
				fetches.push(request.args[0]);
				return ctx.git.run(request);
			},
		};
		const t = deps({ network: () => ({ ctx: { ...ctx, git: watching }, address: remote.address }) });

		await Promise.all([refreshStates(t.deps), refreshStates(t.deps)]);

		expect(fetches.filter((name) => name === 'fetch')).toHaveLength(1);
	});

	it('does not leave the holder refreshing after a failure, so the next press can run', async () => {
		const t = deps({ network: () => ({ ctx: { ...ctx, git: refusingKey() }, address: remote.address }) });

		await refreshStates(t.deps);

		expect(t.holder.lastOutcome.kind).toBe('failed');
	});
});

describe('states from the fetched copy that is already on disk', () => {
	it('are derived without the network, so the list is not empty while the fetch runs', async () => {
		remote.publish('doc/Printer', { 'Docs/Printer.md': 'text' });
		await refreshStates(deps().deps);
		const fresh = deps({ network: () => null });

		await deriveFromFetchedCopy(fresh.deps);

		expect(fresh.holder.statusFor('Printer')?.state).toBe('pending');
		expect(fresh.holder.lastOutcome).toEqual({ kind: 'never' });
	});

	it('leave the holder empty for a folder that was never connected', async () => {
		const bare = mkdtempSync(join(tmpdir(), 'bare-'));
		try {
			const unconnected = deps({ local: () => ({ ...ctx, cwd: bare }) });

			await deriveFromFetchedCopy(unconnected.deps);

			expect(unconnected.holder.current).toBeNull();
			expect(unconnected.holder.lastOutcome).toEqual({ kind: 'never' });
		} finally {
			rmSync(bare, { recursive: true, force: true });
		}
	});

	it('leave the holder as it was when the copy cannot be read', async () => {
		const broken = deps({ local: () => ({ ...ctx, cwd: join(vault, 'does-not-exist') }) });

		await deriveFromFetchedCopy(broken.deps);

		expect(broken.holder.current).toBeNull();
	});
});
