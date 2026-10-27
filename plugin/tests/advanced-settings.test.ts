import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTHOR_MESSAGES } from '../src/author-messages';
import { ADVANCED_KEYS, readLayers, readSetting } from '../src/git-publishing/git-config';
import type { RepoContext } from '../src/git-publishing/repo';
import {
	backToDefault,
	isValidAdvancedValue,
	readAdvanced,
	rowFrom,
	scopeLabel,
	setForVault,
} from '../src/platform-config/advanced-settings';
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
	remote.git(vault, 'init', '-q');
});
afterEach(() => {
	remote.dispose();
	rmSync(vault, { recursive: true, force: true });
	vi.restoreAllMocks();
});

const globalFile = (): string => join(remote.root, 'home', '.gitconfig');
const setGlobal = (key: string, value: string): void => {
	remote.git(vault, 'config', '--global', key, value);
};
const rowOf = async (key: string) => {
	const rows = await readAdvanced(ctx);
	if (!rows.ok) {
		throw new Error('could not read');
	}
	const row = rows.value.find((r) => r.key === key);
	if (row === undefined) {
		throw new Error(`no row for ${key}`);
	}
	return row;
};

describe('which settings appear', () => {
	it('are exactly core.editor, core.pager and color.ui, in that order', async () => {
		const rows = await readAdvanced(ctx);

		expect(rows.ok && rows.value.map((r) => r.key)).toEqual(['core.editor', 'core.pager', 'color.ui']);
		expect(Array.from(ADVANCED_KEYS)).toEqual(['core.editor', 'core.pager', 'color.ui']);
	});

	it('leave out init.defaultBranch and merge.ff even when the computer sets them', async () => {
		setGlobal('init.defaultBranch', 'trunk');
		setGlobal('merge.ff', 'only');
		setGlobal('pull.rebase', 'true');

		const rows = await readAdvanced(ctx);

		expect(rows.ok && rows.value.map((r) => r.key)).not.toContain('init.defaultBranch');
		expect(JSON.stringify(rows)).not.toMatch(/trunk|merge|pull/);
	});

	it('cannot be asked to read or write any other setting at all', async () => {
		await expect(readLayers(ctx, 'init.defaultBranch')).rejects.toThrow(/not one this plugin/);
		await expect(readSetting(ctx, 'merge.ff')).rejects.toThrow(/not one this plugin/);
		await expect(setForVault(ctx, 'merge.ff' as never, 'only')).rejects.toThrow(/not one this plugin/);
		await expect(backToDefault(ctx, 'pull.rebase' as never)).rejects.toThrow(/not one this plugin/);
	});
});

describe('a setting set nowhere', () => {
	it('has no value, is not ticked and has nothing to fall back to', async () => {
		expect((await rowOf('core.editor')).ticked).toBe(false);
	});
});

describe('a setting set for the computer only', () => {
	it('shows its value and where it comes from, not ticked, to be read and not edited', async () => {
		setGlobal('core.editor', 'nano');

		const row = await rowOf('core.editor');

		expect(row).toEqual({ key: 'core.editor', effective: { value: 'nano', scope: 'computer' }, ticked: false, fallback: { value: 'nano', scope: 'computer' } });
		expect(scopeLabel('computer')).toBe('from your computer-wide settings');
	});
});

describe('ticking a setting', () => {
	it('writes the value into this vault, and leaves the computer\'s settings file exactly as it was', async () => {
		setGlobal('core.editor', 'nano');
		const before = readFileSync(globalFile());

		const outcome = await setForVault(ctx, 'core.editor', 'code --wait');

		expect(outcome).toEqual({ ok: true });
		expect(remote.git(vault, 'config', '--local', '--get', 'core.editor').trim()).toBe('code --wait');
		expect(readFileSync(globalFile()).equals(before)).toBe(true);
		expect(await rowOf('core.editor')).toEqual({
			key: 'core.editor',
			effective: { value: 'code --wait', scope: 'vault' },
			ticked: true,
			fallback: { value: 'nano', scope: 'computer' },
		});
	});

	it('does not create the computer\'s settings file when there was none', async () => {
		await setForVault(ctx, 'color.ui', 'never');

		expect(() => readFileSync(globalFile())).toThrow();
	});

	it('refuses a value git would not take for colour, and writes nothing', async () => {
		const outcome = await setForVault(ctx, 'color.ui', 'sometimes');

		expect(outcome).toEqual({ ok: false, message: AUTHOR_MESSAGES.advancedInvalid });
		expect((await rowOf('color.ui')).ticked).toBe(false);
	});

	it('refuses a value with a line break, which would start a second setting', async () => {
		const outcome = await setForVault(ctx, 'core.pager', 'less\n[core]\nsshCommand = x');

		expect(outcome).toEqual({ ok: false, message: AUTHOR_MESSAGES.advancedInvalid });
		expect(remote.git(vault, 'config', '--local', '--list')).not.toContain('sshcommand');
	});

	it('is a failure, not a pretence, in a folder that is not a repository', async () => {
		const bare = mkdtempSync(join(tmpdir(), 'plain-'));
		try {
			const outcome = await setForVault({ ...ctx, cwd: bare }, 'core.pager', 'less');

			expect(outcome.ok).toBe(false);
		} finally {
			rmSync(bare, { recursive: true, force: true });
		}
	});
});

describe('unticking, and "Back to default"', () => {
	it('remove the vault\'s own value so the computer\'s applies, and show it', async () => {
		setGlobal('core.pager', 'less');
		await setForVault(ctx, 'core.pager', 'more');
		expect((await rowOf('core.pager')).effective?.value).toBe('more');

		const outcome = await backToDefault(ctx, 'core.pager');

		expect(outcome).toEqual({ ok: true });
		expect(await rowOf('core.pager')).toMatchObject({ ticked: false, effective: { value: 'less', scope: 'computer' } });
	});

	it('leave the computer\'s settings file exactly as it was', async () => {
		setGlobal('core.pager', 'less');
		await setForVault(ctx, 'core.pager', 'more');
		const before = readFileSync(globalFile());

		await backToDefault(ctx, 'core.pager');

		expect(readFileSync(globalFile()).equals(before)).toBe(true);
	});

	it('leave a setting as it was before the vault had its own, whatever the computer or the system says', async () => {
		const before = await rowOf('color.ui');
		await setForVault(ctx, 'color.ui', 'never');

		await backToDefault(ctx, 'color.ui');

		expect(await rowOf('color.ui')).toEqual(before);
		expect((await rowOf('color.ui')).ticked).toBe(false);
	});

	it('treat a setting the vault never had as already removed', async () => {
		expect(await backToDefault(ctx, 'core.editor')).toEqual({ ok: true });
	});
});

describe('a row from the layers a setting has', () => {
	it('takes the last layer as the one that applies and the one before a vault\'s own as the fallback', () => {
		expect(
			rowFrom('core.editor', [
				{ value: 'system-editor', scope: 'system' },
				{ value: 'computer-editor', scope: 'computer' },
				{ value: 'vault-editor', scope: 'vault' },
			])
		).toEqual({
			key: 'core.editor',
			effective: { value: 'vault-editor', scope: 'vault' },
			ticked: true,
			fallback: { value: 'computer-editor', scope: 'computer' },
		});
	});

	it('does not take a layer of unknown origin for the vault\'s', () => {
		expect(rowFrom('core.pager', [{ value: 'less', scope: 'other' }]).ticked).toBe(false);
	});
});

describe('which values are accepted', () => {
	it('are git\'s own words for colour, and any one line for an editor or a pager', () => {
		for (const good of ['true', 'false', 'always', 'auto', 'never']) {
			expect(isValidAdvancedValue('color.ui', good)).toBe(true);
		}
		expect(isValidAdvancedValue('color.ui', 'purple')).toBe(false);
		expect(isValidAdvancedValue('core.editor', 'code --wait')).toBe(true);
		expect(isValidAdvancedValue('core.pager', '')).toBe(false);
		expect(isValidAdvancedValue('core.pager', 'a\nb')).toBe(false);
	});

	it('are labelled in the author\'s words', () => {
		expect(scopeLabel('vault')).toBe('from this vault');
		expect(scopeLabel('system')).toBe('from the system settings');
		expect(scopeLabel('other')).toBe('');
	});
});
