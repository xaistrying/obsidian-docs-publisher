import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Installing the plugin into a vault must never disturb what the vault already
 * holds for it (replace-rest-with-local-git-ssh task 5.5): the saved settings
 * are the author's finished setup, and the keys an earlier version left in the
 * same file are what lets that version be reinstalled.
 */
const PLUGIN = join(__dirname, '..');

let vault: string;
let target: string;

beforeEach(() => {
	vault = mkdtempSync(join(tmpdir(), 'install-'));
	mkdirSync(join(vault, '.obsidian'));
	target = join(vault, '.obsidian', 'plugins', 'obsidian-docs-publisher');
});
afterEach(() => {
	rmSync(vault, { recursive: true, force: true });
});

const install = (): void => {
	execFileSync('bash', [join(PLUGIN, 'install.sh'), vault], { stdio: 'pipe' });
};

describe('installing into a vault', () => {
	it.skipIf(process.platform === 'win32')('copies the three runtime files', () => {
		install();

		for (const name of ['manifest.json', 'main.js', 'styles.css']) {
			expect(existsSync(join(target, name)), name).toBe(true);
		}
	});

	it.skipIf(process.platform === 'win32')('leaves an existing data.json exactly as it was, and any other file in the folder', () => {
		mkdirSync(target, { recursive: true });
		const saved = JSON.stringify({ setup: { projectAddress: 'git@h:a/b.git' }, submissions: { x: { docId: 'x' } } });
		writeFileSync(join(target, 'data.json'), saved);
		writeFileSync(join(target, 'something-else.txt'), 'keep me');

		install();
		install();

		expect(readFileSync(join(target, 'data.json'), 'utf8')).toBe(saved);
		expect(readFileSync(join(target, 'something-else.txt'), 'utf8')).toBe('keep me');
	});

	it.skipIf(process.platform === 'win32')('does not create a data.json that was not there', () => {
		install();

		expect(existsSync(join(target, 'data.json'))).toBe(false);
	});

	it.skipIf(process.platform === 'win32')('refuses a folder that is not a vault, and writes nothing into it', () => {
		const notVault = mkdtempSync(join(tmpdir(), 'not-a-vault-'));
		try {
			expect(() => execFileSync('bash', [join(PLUGIN, 'install.sh'), notVault], { stdio: 'pipe' })).toThrow();
			expect(existsSync(join(notVault, '.obsidian'))).toBe(false);
		} finally {
			rmSync(notVault, { recursive: true, force: true });
		}
	});
});

describe('what the manifest promises', () => {
	const manifest = JSON.parse(readFileSync(join(PLUGIN, 'manifest.json'), 'utf8')) as Record<string, unknown>;
	const versions = JSON.parse(readFileSync(join(PLUGIN, 'versions.json'), 'utf8')) as Record<string, string>;
	const pkg = JSON.parse(readFileSync(join(PLUGIN, 'package.json'), 'utf8')) as Record<string, unknown>;

	it('is desktop only, because the plugin starts programs on the author\'s computer', () => {
		expect(manifest.isDesktopOnly).toBe(true);
	});

	it('has one version across the manifest, the package and the versions file', () => {
		expect(pkg.version).toBe(manifest.version);
		expect(versions[manifest.version as string]).toBe(manifest.minAppVersion);
	});

	it('does not mention a token', () => {
		expect(JSON.stringify(manifest).toLowerCase()).not.toContain('token');
	});
});
