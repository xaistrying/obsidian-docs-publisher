import { failureOf } from './failures';
import type { GitResult } from './failures';
import { stdoutText } from './git-runner';
import type { ProcessResult } from './git-runner';
import type { RepoContext } from './repo';

/**
 * Git settings, read with the place they came from and written to the vault
 * only (replace-rest-with-local-git-ssh task 2.7, git-publishing "Git settings
 * can be read with their scope and written to the vault only").
 *
 * Only the keys named here can be read or written through this module. The
 * runner would let `config` set anything, and a setting such as `core.sshCommand`
 * or `core.hooksPath` is a program to run; the plugin's own settings screens
 * need two keys, and the "Advanced" section (task 5.4) adds a fixed list.
 */
export type SettingScope = 'vault' | 'computer' | 'system' | 'other';

export interface EffectiveSetting {
	value: string;
	scope: SettingScope;
}

export const IDENTITY_KEYS = ['user.name', 'user.email'] as const;

/**
 * The settings the Advanced section lists (platform-config "Advanced git
 * settings can be set for this vault or returned to default"). A fixed short
 * list, and none that is about how documents are sent or received.
 */
export const ADVANCED_KEYS = ['core.editor', 'core.pager', 'color.ui'] as const;

const SETTABLE_KEYS: ReadonlyArray<string> = [...IDENTITY_KEYS, ...ADVANCED_KEYS];

function assertKnown(key: string): void {
	if (SETTABLE_KEYS.indexOf(key) === -1) {
		throw new Error(`Docs Publisher: the setting ${key} is not one this plugin reads or writes`);
	}
}

function scopeOf(name: string): SettingScope {
	switch (name) {
		case 'local':
			return 'vault';
		case 'global':
			return 'computer';
		case 'system':
			return 'system';
		default:
			return 'other';
	}
}

function ran(result: ProcessResult): boolean {
	return result.spawnError === null && !result.timedOut && !result.truncated;
}

/**
 * A setting's effective value and where it comes from, or null when it is set
 * nowhere. Works in a folder with no repository, where only the computer-wide
 * and system settings exist.
 */
export async function readSetting(ctx: RepoContext, key: string): Promise<GitResult<EffectiveSetting | null>> {
	assertKnown(key);
	let result = await ctx.git.run({ args: ['config', '--show-scope', '--get', key], cwd: ctx.cwd });
	let scoped = true;
	if (ran(result) && result.exitCode === 129) {
		// Git older than 2.26 does not know `--show-scope`. The value is still
		// the effective one; only its place is not known.
		scoped = false;
		result = await ctx.git.run({ args: ['config', '--get', key], cwd: ctx.cwd });
	}
	if (ran(result) && result.exitCode === 1) {
		return { ok: true, value: null };
	}
	if (!ran(result) || result.exitCode !== 0) {
		return failureOf('config', result);
	}
	const line = stdoutText(result).replace(/\r?\n$/, '');
	if (!scoped) {
		return { ok: true, value: { value: line, scope: 'other' } };
	}
	const tab = line.indexOf('\t');
	return { ok: true, value: { value: line.slice(tab + 1), scope: scopeOf(line.slice(0, tab)) } };
}

/**
 * Every value a setting has, one per place it is set, lowest first (the
 * system's, then the computer's, then this vault's): the last is the effective
 * one, and the one before a vault's own is what the setting falls back to when
 * the vault's is removed. Empty when it is set nowhere.
 *
 * Git older than 2.26 cannot say where a value came from; the layers are then
 * all labelled "other", so none of them is taken for the vault's.
 */
export async function readLayers(ctx: RepoContext, key: string): Promise<GitResult<EffectiveSetting[]>> {
	assertKnown(key);
	let result = await ctx.git.run({ args: ['config', '--show-scope', '--get-all', key], cwd: ctx.cwd });
	let scoped = true;
	if (ran(result) && result.exitCode === 129) {
		scoped = false;
		result = await ctx.git.run({ args: ['config', '--get-all', key], cwd: ctx.cwd });
	}
	if (ran(result) && result.exitCode === 1) {
		return { ok: true, value: [] };
	}
	if (!ran(result) || result.exitCode !== 0) {
		return failureOf('config', result);
	}
	const layers: EffectiveSetting[] = [];
	for (const line of stdoutText(result).split('\n')) {
		if (line === '') {
			continue;
		}
		if (!scoped) {
			layers.push({ value: line, scope: 'other' });
			continue;
		}
		const tab = line.indexOf('\t');
		layers.push({ value: line.slice(tab + 1), scope: scopeOf(line.slice(0, tab)) });
	}
	return { ok: true, value: layers };
}

/**
 * What a name or an email may be. Anything an author could type, short of a
 * line break: the value is written to a configuration file, where a line break
 * would start a second setting.
 */
export function isUsableSettingValue(value: string): boolean {
	// eslint-disable-next-line no-control-regex
	return value.trim() !== '' && value.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value);
}

/** Writes a setting to this vault's own configuration, never to the computer's or the system's. */
export async function writeVaultSetting(ctx: RepoContext, key: string, value: string): Promise<GitResult<void>> {
	assertKnown(key);
	if (!isUsableSettingValue(value)) {
		throw new Error('Docs Publisher: that value cannot be written to a git setting');
	}
	const result = await ctx.git.run({ args: ['config', '--local', key, value.trim()], cwd: ctx.cwd });
	return ran(result) && result.exitCode === 0 ? { ok: true, value: undefined } : failureOf('config --local', result);
}

/** Removes a setting from this vault's own configuration. A setting that was not there is already removed. */
export async function removeVaultSetting(ctx: RepoContext, key: string): Promise<GitResult<void>> {
	assertKnown(key);
	const result = await ctx.git.run({ args: ['config', '--local', '--unset', key], cwd: ctx.cwd });
	// Exit 5 is git's way of saying there was nothing to remove.
	if (ran(result) && (result.exitCode === 0 || result.exitCode === 5)) {
		return { ok: true, value: undefined };
	}
	return failureOf('config --local --unset', result);
}

export interface EffectiveIdentity {
	name: EffectiveSetting | null;
	email: EffectiveSetting | null;
}

export async function readIdentity(ctx: RepoContext): Promise<GitResult<EffectiveIdentity>> {
	const name = await readSetting(ctx, 'user.name');
	if (!name.ok) {
		return name;
	}
	const email = await readSetting(ctx, 'user.email');
	if (!email.ok) {
		return email;
	}
	return { ok: true, value: { name: name.value, email: email.value } };
}
