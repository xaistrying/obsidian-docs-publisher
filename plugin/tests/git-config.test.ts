import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	isUsableSettingValue,
	readIdentity,
	readSetting,
	removeVaultSetting,
	writeVaultSetting,
} from '../src/git-publishing/git-config';
import type { GitRequest, GitRunner, ProcessResult } from '../src/git-publishing/git-runner';
import type { RepoContext } from '../src/git-publishing/repo';
import { createLocalRemote } from './support/local-remote';
import type { LocalRemote } from './support/local-remote';

let remote: LocalRemote;
let vault: string;
let ctx: RepoContext;

beforeEach(() => {
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
	remote = createLocalRemote({ empty: true });
	vault = mkdtempSync(join(tmpdir(), 'vault-'));
	ctx = { git: remote.runner(), cwd: vault };
});
afterEach(() => {
	remote.dispose();
	rmSync(vault, { recursive: true, force: true });
	vi.restoreAllMocks();
});

/** The computer-wide settings file the runner sees, since the stand-in's HOME is its own folder. */
const globalFile = (): string => join(remote.root, 'home', '.gitconfig');

describe('reading a setting with the place it came from', () => {
	it('is nothing when it is set nowhere', async () => {
		expect(await readSetting(ctx, 'user.name')).toEqual({ ok: true, value: null });
	});

	it('labels a setting made only for the computer as the computer\'s, with no repository needed', async () => {
		remote.git(vault, 'config', '--global', 'user.name', 'Ana Nguyen');

		expect(await readSetting(ctx, 'user.name')).toEqual({ ok: true, value: { value: 'Ana Nguyen', scope: 'computer' } });
	});

	it('labels a setting made for the vault as the vault\'s, and prefers it to the computer\'s', async () => {
		remote.git(vault, 'config', '--global', 'user.name', 'Computer Name');
		remote.git(vault, 'init', '-q');
		remote.git(vault, 'config', '--local', 'user.name', 'Vault Name');

		expect(await readSetting(ctx, 'user.name')).toEqual({ ok: true, value: { value: 'Vault Name', scope: 'vault' } });
	});

	it('reads a value with accents and spaces whole', async () => {
		remote.git(vault, 'config', '--global', 'user.name', 'Trần Phạm Ngọc');

		const read = await readSetting(ctx, 'user.name');

		expect(read.ok && read.value?.value).toBe('Trần Phạm Ngọc');
	});

	it('still gives the value, with the place unknown, when git is too old to say where it came from', async () => {
		const old: GitRunner = {
			run: async (request: GitRequest): Promise<ProcessResult> =>
				request.args.indexOf('--show-scope') !== -1
					? { exitCode: 129, stdout: Buffer.alloc(0), stderr: 'error: unknown option `show-scope\'', timedOut: false, truncated: false, spawnError: null }
					: { exitCode: 0, stdout: Buffer.from('Ana\n'), stderr: '', timedOut: false, truncated: false, spawnError: null },
		};

		expect(await readSetting({ ...ctx, git: old }, 'user.name')).toEqual({ ok: true, value: { value: 'Ana', scope: 'other' } });
	});

	it('refuses a setting this plugin has no business with, before any command', async () => {
		await expect(readSetting(ctx, 'core.sshCommand')).rejects.toThrow(/not one this plugin/);
		await expect(writeVaultSetting(ctx, 'core.hooksPath', '/x')).rejects.toThrow(/not one this plugin/);
		await expect(removeVaultSetting(ctx, 'alias.x')).rejects.toThrow(/not one this plugin/);
	});
});

describe('writing a setting to the vault only', () => {
	it('writes to this vault\'s own settings and leaves the computer\'s file exactly as it was', async () => {
		remote.git(vault, 'config', '--global', 'user.email', 'old@example.com');
		remote.git(vault, 'init', '-q');
		const before = readFileSync(globalFile());

		const written = await writeVaultSetting(ctx, 'user.name', '  Ana Nguyen  ');

		expect(written.ok).toBe(true);
		expect(remote.git(vault, 'config', '--local', '--get', 'user.name').trim()).toBe('Ana Nguyen');
		expect(readFileSync(globalFile()).equals(before)).toBe(true);
	});

	it('does not write the computer\'s file at all when there is none', async () => {
		remote.git(vault, 'init', '-q');

		await writeVaultSetting(ctx, 'user.name', 'Ana');

		expect(existsSync(globalFile())).toBe(false);
	});

	it('refuses a value with a line break in it, which would start a second setting', async () => {
		remote.git(vault, 'init', '-q');

		await expect(writeVaultSetting(ctx, 'user.name', 'Ana\n[core]\nsshCommand = x')).rejects.toThrow(/cannot be written/);
		await expect(writeVaultSetting(ctx, 'user.name', '   ')).rejects.toThrow();
	});

	it('removes the vault\'s setting, after which the computer\'s shows again', async () => {
		remote.git(vault, 'config', '--global', 'user.name', 'Computer Name');
		remote.git(vault, 'init', '-q');
		await writeVaultSetting(ctx, 'user.name', 'Vault Name');

		const removed = await removeVaultSetting(ctx, 'user.name');

		expect(removed.ok).toBe(true);
		expect(await readSetting(ctx, 'user.name')).toEqual({ ok: true, value: { value: 'Computer Name', scope: 'computer' } });
	});

	it('treats removing a setting that was not there as done', async () => {
		remote.git(vault, 'init', '-q');

		expect((await removeVaultSetting(ctx, 'user.email')).ok).toBe(true);
	});

	it('fails, and does not pretend, when there is no repository to write to', async () => {
		const written = await writeVaultSetting(ctx, 'user.name', 'Ana');

		expect(written.ok).toBe(false);
	});
});

describe('the name and email together', () => {
	it('reads both, each with its own place', async () => {
		remote.git(vault, 'config', '--global', 'user.name', 'Ana');
		remote.git(vault, 'init', '-q');
		remote.git(vault, 'config', '--local', 'user.email', 'ana@example.com');

		const identity = await readIdentity(ctx);

		expect(identity.ok && identity.value).toEqual({
			name: { value: 'Ana', scope: 'computer' },
			email: { value: 'ana@example.com', scope: 'vault' },
		});
	});
});

describe('which values a setting may hold', () => {
	it('allows what an author types and not a line break or an empty value', () => {
		expect(isUsableSettingValue('Trần Phạm')).toBe(true);
		expect(isUsableSettingValue('ana@example.com')).toBe(true);
		expect(isUsableSettingValue('')).toBe(false);
		expect(isUsableSettingValue('  ')).toBe(false);
		expect(isUsableSettingValue('a\nb')).toBe(false);
		expect(isUsableSettingValue('a\0b')).toBe(false);
		expect(isUsableSettingValue('x'.repeat(201))).toBe(false);
	});
});
