import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseProjectAddress } from '../src/git-publishing/project-address';
import type { ProjectAddress } from '../src/git-publishing/project-address';
import type { RepoContext } from '../src/git-publishing/repo';
import { connectVault } from '../src/vault-sync/connect';
import { OBSIDIAN_GIT_ID, WarnOnce, isObsidianGitEnabled } from '../src/vault-sync/obsidian-git';
import { createRepoFacts } from '../src/vault-sync/repo-facts';
import { createLocalRemote } from './support/local-remote';
import type { LocalRemote } from './support/local-remote';

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

function facts(saved: ProjectAddress | null = remote.address) {
	return createRepoFacts({ context: () => ctx, savedAddress: () => saved });
}

describe('what setup asks the vault\'s repository', () => {
	it('is not connected before connecting, and has no address to lock to', async () => {
		const f = facts();

		expect(await f.vaultConnected()).toBe(false);
		expect(await f.connectedAddress()).toBeNull();
	});

	it('is connected afterwards, to the address in the repository', async () => {
		await connectVault(ctx, remote.address);
		const f = facts();

		expect(await f.vaultConnected()).toBe(true);
		expect((await f.connectedAddress())?.sshUrl).toBe(remote.address.sshUrl);
	});

	it('is not connected when the saved address is another project\'s, though the vault is connected', async () => {
		await connectVault(ctx, remote.address);
		const other = parseProjectAddress('git@gitlab.example.com:docs/other.git');

		expect(await facts(other).vaultConnected()).toBe(false);
		expect((await facts(other).connectedAddress())?.sshUrl).toBe(remote.address.sshUrl);
	});

	it('is not connected when there is no saved address', async () => {
		await connectVault(ctx, remote.address);

		expect(await facts(null).vaultConnected()).toBe(false);
	});

	it('is not connected for a repository that was never connected by this plugin', async () => {
		remote.git(vault, 'init', '-q');
		remote.git(vault, 'remote', 'add', 'origin', remote.address.sshUrl);

		expect(await facts().vaultConnected()).toBe(false);
		expect(await facts().connectedAddress()).toBeNull();
	});

	it('has no identity until both a name and an email exist', async () => {
		remote.git(vault, 'config', '--global', 'user.name', 'Ana');

		expect(await facts().identity()).toBeNull();

		remote.git(vault, 'config', '--global', 'user.email', 'ana@example.com');

		expect(await facts().identity()).toEqual({ name: 'Ana', email: 'ana@example.com', scope: 'computer' });
	});

	it('has no identity when git cannot be asked', async () => {
		const broken = createRepoFacts({
			context: () => ({ ...ctx, git: { run: async () => ({ exitCode: null, stdout: Buffer.alloc(0), stderr: '', timedOut: false, truncated: false, spawnError: 'ENOENT' }) } }),
			savedAddress: () => remote.address,
		});

		expect(await broken.identity()).toBeNull();
		expect(await broken.vaultConnected()).toBe(false);
	});
});

describe('noticing the Obsidian Git plugin', () => {
	it('finds it among the enabled plugins, whichever collection Obsidian holds them in', () => {
		expect(isObsidianGitEnabled(new Set(['a', OBSIDIAN_GIT_ID]))).toBe(true);
		expect(isObsidianGitEnabled([OBSIDIAN_GIT_ID])).toBe(true);
	});

	it('says no for anything else, including a value it does not recognise', () => {
		expect(isObsidianGitEnabled(new Set(['a']))).toBe(false);
		expect(isObsidianGitEnabled(undefined)).toBe(false);
		expect(isObsidianGitEnabled({ [OBSIDIAN_GIT_ID]: true })).toBe(false);
	});

	it('warns once per session, however many times it is asked', () => {
		const warn = vi.fn();
		const once = new WarnOnce(() => true, warn);

		once.check();
		once.check();
		once.check();

		expect(warn).toHaveBeenCalledTimes(1);
	});

	it('does not warn while the plugin is off, and warns once it is turned on', () => {
		let enabled = false;
		const warn = vi.fn();
		const once = new WarnOnce(() => enabled, warn);

		once.check();
		enabled = true;
		once.check();
		once.check();

		expect(warn).toHaveBeenCalledTimes(1);
	});
});
