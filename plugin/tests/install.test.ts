import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Installing the plugin into a vault must never disturb what the vault already
 * holds for it: the saved settings are the author's finished setup, and nothing
 * may be written until every download has been checked. The installer is run for
 * real against a release folder that is served through a file address, so no
 * network is involved.
 */
const PLUGIN = join(__dirname, '..');
const ID = 'obsidian-docs-publisher';

let vault: string;
let target: string;
let release: string;

const sha = (text: string): string => createHash('sha256').update(text).digest('hex');

/** A release folder holding the three files and a SHA256SUMS for them. */
function makeRelease(version: string, tamper = false): string {
	const dir = mkdtempSync(join(tmpdir(), 'release-'));
	const files: Record<string, string> = {
		'main.js': `// build ${version}\n`,
		'manifest.json': JSON.stringify({ id: ID, version }),
		'styles.css': `/* ${version} */\n`,
	};
	for (const name of Object.keys(files)) {
		writeFileSync(join(dir, name), files[name]);
	}
	writeFileSync(join(dir, 'SHA256SUMS'), Object.keys(files).map((name) => `${sha(files[name])}  ${name}`).join('\n') + '\n');
	if (tamper) {
		writeFileSync(join(dir, 'main.js'), '// not what was checksummed\n');
	}
	return dir;
}

beforeEach(() => {
	vault = mkdtempSync(join(tmpdir(), 'install-'));
	mkdirSync(join(vault, '.obsidian'));
	target = join(vault, '.obsidian', 'plugins', ID);
	release = makeRelease('1.0.0');
});
afterEach(() => {
	rmSync(vault, { recursive: true, force: true });
	rmSync(release, { recursive: true, force: true });
});

const install = (from = release): string =>
	execFileSync('bash', [join(PLUGIN, 'install.sh'), vault], {
		stdio: 'pipe',
		encoding: 'utf8',
		env: { ...process.env, DOCS_PUBLISHER_BASE_URL: `file://${from}` },
	});

const posix = describe.skipIf(process.platform === 'win32');

posix('installing into a vault', () => {
	it('copies the three runtime files and nothing else', () => {
		install();

		for (const name of ['manifest.json', 'main.js', 'styles.css']) {
			expect(existsSync(join(target, name)), name).toBe(true);
		}
		expect(existsSync(join(target, 'SHA256SUMS'))).toBe(false);
	});

	it('switches the plugin on, creating the list when there is none', () => {
		install();

		expect(JSON.parse(readFileSync(join(vault, '.obsidian', 'community-plugins.json'), 'utf8'))).toEqual([ID]);
	});

	it('adds to a list that has other plugins, keeps them, and leaves a .bak copy', () => {
		const list = join(vault, '.obsidian', 'community-plugins.json');
		writeFileSync(list, '[\n  "other-plugin"\n]\n');

		install();
		install();

		expect(JSON.parse(readFileSync(list, 'utf8'))).toEqual(['other-plugin', ID]);
		expect(readFileSync(`${list}.bak`, 'utf8')).toContain('other-plugin');
	});

	it('fills an empty list', () => {
		const list = join(vault, '.obsidian', 'community-plugins.json');
		writeFileSync(list, '[]');

		install();

		expect(JSON.parse(readFileSync(list, 'utf8'))).toEqual([ID]);
	});

	it('updates in place, says what changed, and leaves the saved settings and any other file exactly as it was', () => {
		install();
		const saved = JSON.stringify({ setup: { projectAddress: 'git@h:a/b.git' } });
		writeFileSync(join(target, 'data.json'), saved);
		writeFileSync(join(target, 'something-else.txt'), 'keep me');
		const newer = makeRelease('1.1.0');

		let said = '';
		try {
			said = install(newer);
		} finally {
			rmSync(newer, { recursive: true, force: true });
		}

		expect(said).toContain('Updated Docs Publisher 1.0.0 -> 1.1.0');
		expect(JSON.parse(readFileSync(join(target, 'manifest.json'), 'utf8')).version).toBe('1.1.0');
		expect(readFileSync(join(target, 'data.json'), 'utf8')).toBe(saved);
		expect(readFileSync(join(target, 'something-else.txt'), 'utf8')).toBe('keep me');
	});

	it('does not create a settings file that was not there', () => {
		install();

		expect(existsSync(join(target, 'data.json'))).toBe(false);
	});

	it('writes nothing when a file does not match its checksum', () => {
		install();
		const before = readFileSync(join(target, 'main.js'), 'utf8');
		const bad = makeRelease('2.0.0', true);

		try {
			expect(() => install(bad)).toThrow();
		} finally {
			rmSync(bad, { recursive: true, force: true });
		}
		expect(readFileSync(join(target, 'main.js'), 'utf8')).toBe(before);
		expect(JSON.parse(readFileSync(join(target, 'manifest.json'), 'utf8')).version).toBe('1.0.0');
	});

	it('writes nothing when a download is missing', () => {
		const empty = mkdtempSync(join(tmpdir(), 'empty-'));
		try {
			expect(() => install(empty)).toThrow();
		} finally {
			rmSync(empty, { recursive: true, force: true });
		}
		expect(existsSync(target)).toBe(false);
	});

	it('refuses files that are not this plugin, even with a matching checksum', () => {
		const other = makeRelease('1.0.0');
		const manifest = JSON.stringify({ id: 'something-else', version: '1.0.0' });
		writeFileSync(join(other, 'manifest.json'), manifest);
		const sums = [
			`${sha(readFileSync(join(other, 'main.js'), 'utf8'))}  main.js`,
			`${sha(manifest)}  manifest.json`,
			`${sha(readFileSync(join(other, 'styles.css'), 'utf8'))}  styles.css`,
		];
		writeFileSync(join(other, 'SHA256SUMS'), sums.join('\n') + '\n');
		try {
			expect(() => install(other)).toThrow();
		} finally {
			rmSync(other, { recursive: true, force: true });
		}
		expect(existsSync(target)).toBe(false);
	});

	it('refuses a folder that is not a vault, and writes nothing into it', () => {
		const notVault = mkdtempSync(join(tmpdir(), 'not-a-vault-'));
		try {
			expect(() =>
				execFileSync('bash', [join(PLUGIN, 'install.sh'), notVault], {
					stdio: 'pipe',
					env: { ...process.env, DOCS_PUBLISHER_BASE_URL: `file://${release}` },
				})
			).toThrow();
			expect(existsSync(join(notVault, '.obsidian'))).toBe(false);
		} finally {
			rmSync(notVault, { recursive: true, force: true });
		}
	});

	it('installs a local build from next to the script with --local', () => {
		const here = mkdtempSync(join(tmpdir(), 'local-'));
		try {
			copyFileSync(join(PLUGIN, 'install.sh'), join(here, 'install.sh'));
			writeFileSync(join(here, 'main.js'), '// local\n');
			writeFileSync(join(here, 'manifest.json'), JSON.stringify({ id: ID, version: '9.9.9' }));
			writeFileSync(join(here, 'styles.css'), '');

			execFileSync('bash', [join(here, 'install.sh'), vault, '--local'], { stdio: 'pipe' });

			expect(readFileSync(join(target, 'main.js'), 'utf8')).toBe('// local\n');
		} finally {
			rmSync(here, { recursive: true, force: true });
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
