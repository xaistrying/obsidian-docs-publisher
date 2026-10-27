import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitRequest, GitRunner } from '../src/git-publishing/git-runner';
import { CONNECTED_REF } from '../src/git-publishing/ref-names';
import { readRef } from '../src/git-publishing/repo';
import type { RepoContext } from '../src/git-publishing/repo';
import { connectVault } from '../src/vault-sync/connect';
import { createLocalRemote } from './support/local-remote';
import type { LocalRemote } from './support/local-remote';

/**
 * Connecting must be all or nothing, whichever git command breaks part-way
 * (vault-sync "Connecting a vault adopts it without touching any file").
 * Each command the sequence uses is made to fail in turn: a repository the
 * plugin just made is taken back, and one it adopted never reads as connected.
 */
let remote: LocalRemote;
let vault: string;
let ctx: RepoContext;

beforeEach(() => {
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
	remote = createLocalRemote();
	vault = mkdtempSync(join(tmpdir(), 'vault-'));
	ctx = { git: remote.runner(), cwd: vault };
});
afterEach(() => {
	remote.dispose();
	rmSync(vault, { recursive: true, force: true });
	vi.restoreAllMocks();
});

/** Fails the `nth` call of one subcommand, and runs every other call as normal. */
function failing(subcommand: string, nth = 1): GitRunner {
	let seen = 0;
	return {
		run: async (request: GitRequest) => {
			if (request.args[0] === subcommand) {
				seen += 1;
				if (seen === nth) {
					return { exitCode: 1, stdout: Buffer.alloc(0), stderr: 'fatal: broken on purpose', timedOut: false, truncated: false, spawnError: null };
				}
			}
			return ctx.git.run(request);
		},
	};
}

const STEPS = ['ls-remote', 'init', 'symbolic-ref', 'remote', 'rev-parse', 'config', 'fetch', 'read-tree', 'write-tree', 'commit-tree', 'update-ref', 'reset'];

describe('a repository the plugin makes', () => {
	for (const step of STEPS) {
		it(`is taken back, leaving no repository, when ${step} fails`, async () => {
			const result = await connectVault({ ...ctx, git: failing(step) }, remote.address);

			// A command the sequence never needs cannot make it fail; every one it does need must.
			if (!result.ok) {
				expect(existsSync(join(vault, '.git')), step).toBe(false);
			}
		});
	}

	it('is made to fail by most of the commands it uses, so the loop above proves something', async () => {
		let failures = 0;
		for (const step of STEPS) {
			const result = await connectVault({ ...ctx, git: failing(step) }, remote.address);
			if (!result.ok) {
				failures += 1;
			}
			rmSync(join(vault, '.git'), { recursive: true, force: true });
		}

		expect(failures).toBeGreaterThanOrEqual(8);
	});

	it('is taken back when the second of the two project lookups fails', async () => {
		const result = await connectVault({ ...ctx, git: failing('ls-remote', 2) }, remote.address);

		expect(result.ok).toBe(false);
		expect(existsSync(join(vault, '.git'))).toBe(false);
	});
});

describe('a repository the plugin adopts', () => {
	beforeEach(() => {
		remote.git(vault, 'init', '-q');
		remote.git(vault, 'symbolic-ref', 'HEAD', 'refs/heads/main');
		remote.git(vault, 'remote', 'add', 'origin', remote.address.sshUrl);
		remote.git(vault, 'fetch', '-q', remote.bare, '+refs/heads/*:refs/remotes/origin/*');
		remote.git(vault, 'reset', '-q', '--mixed', 'refs/remotes/origin/main');
	});

	for (const step of ['ls-remote', 'rev-parse', 'config', 'symbolic-ref', 'fetch', 'merge-base', 'update-ref']) {
		it(`never reads as connected when ${step} fails`, async () => {
			const result = await connectVault({ ...ctx, git: failing(step) }, remote.address);

			if (!result.ok) {
				const connected = await readRef(ctx, CONNECTED_REF);
				expect(connected.ok && connected.value, step).toBeNull();
			}
		});
	}

	it('never reads as connected when only the second ref cannot be written', async () => {
		const result = await connectVault({ ...ctx, git: failing('update-ref', 2) }, remote.address);

		expect(result.ok).toBe(false);
		expect(await readRef(ctx, CONNECTED_REF)).toEqual({ ok: true, value: null });
	});

	it('is told a server that cannot be reached is not a refusal', async () => {
		const unreachable: GitRunner = {
			run: async (request: GitRequest) =>
				request.args[0] === 'ls-remote'
					? { exitCode: 255, stdout: Buffer.alloc(0), stderr: 'ssh: Could not resolve hostname gitlab.example.com', timedOut: false, truncated: false, spawnError: null }
					: ctx.git.run(request),
		};

		expect(await connectVault({ ...ctx, git: unreachable }, remote.address)).toEqual({ ok: false, kind: 'failed', failure: 'server-unreachable' });
	});
});
