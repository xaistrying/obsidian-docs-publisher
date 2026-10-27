import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GIT_SUBCOMMAND_ALLOWLIST } from '../src/git-publishing/git-runner';

/**
 * The rules the design draws between modules, as tests that read the source
 * (replace-rest-with-local-git-ssh tasks 5.2 and 5.3).
 *
 * Words are searched for only in code, never in comments or strings that an
 * author reads, and the checks that matter most are on sets and not on text:
 * a search for `merge` would also find `merge-file` and `merge_request.*`,
 * both legitimate, so the forbidden commands are checked against the runner's
 * own allowlist and against the exact subcommand a call names.
 */

const SRC = join(__dirname, '..', 'src');

function sourceFiles(dir: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...sourceFiles(full));
		} else if (entry.name.endsWith('.ts')) {
			files.push(full);
		}
	}
	return files;
}

/** Code without its comments, so prose that mentions a word cannot trip a scan. */
function withoutComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

const FILES = sourceFiles(SRC).map((file) => ({
	path: relative(SRC, file).split('\\').join('/'),
	code: withoutComments(readFileSync(file, 'utf8')),
}));

const outsideGit = FILES.filter((file) => file.path.indexOf('git-publishing/') !== 0);

describe('who may start a process', () => {
	it('lists something, so the scans below are not scanning nothing', () => {
		expect(FILES.length).toBeGreaterThan(30);
		expect(outsideGit.length).toBeGreaterThan(10);
	});

	it('is git-publishing alone: no other module imports child_process', () => {
		const offenders = outsideGit.filter((file) => /from\s+['"](node:)?child_process['"]/.test(file.code) || /require\(\s*['"](node:)?child_process/.test(file.code));

		expect(offenders.map((f) => f.path)).toEqual([]);
	});

	it('does not use the node: spelling of a builtin anywhere, which the project\'s bundler cannot resolve', () => {
		const offenders = FILES.filter((file) => /from\s+['"]node:/.test(file.code));

		expect(offenders.map((f) => f.path)).toEqual([]);
	});

	it('starts processes through one runner: only git-runner.ts spawns', () => {
		const offenders = FILES.filter((file) => /(?<![.\w])(spawn|exec|execFile|spawnSync|execSync|fork)\s*\(/.test(file.code) && file.path !== 'git-publishing/git-runner.ts');

		expect(offenders.map((f) => f.path)).toEqual([]);
	});
});

describe('who may build a remote address or name a server command', () => {
	for (const word of ['ls-remote', 'GIT_SSH_COMMAND', 'execFile', 'receive-pack', 'upload-pack']) {
		it(`keeps "${word}" out of every module outside git-publishing`, () => {
			const offenders = outsideGit.filter((file) => file.code.indexOf(word) !== -1);

			expect(offenders.map((f) => f.path)).toEqual([]);
		});
	}

	it('keeps the ssh address form out of code outside git-publishing: only the author-facing messages mention it', () => {
		// Searched by what builds an address, not by the literal `git@`, which the
		// author messages contain on purpose.
		const offenders = outsideGit.filter((file) => /['"`]git@\$\{|`git@|['"]git@['"]\s*\+/.test(file.code));

		expect(offenders.map((f) => f.path)).toEqual([]);
	});
});

describe('the commands that would write the working tree', () => {
	const FORBIDDEN = ['checkout', 'switch', 'merge', 'pull', 'rebase', 'restore', 'stash', 'clean', 'gc', 'am', 'apply', 'cherry-pick', 'revert', 'commit', 'add', 'rm', 'mv', 'worktree', 'submodule'];

	it('are not in the runner\'s allowlist, which is where the rule is enforced at run time', () => {
		for (const name of FORBIDDEN) {
			expect(GIT_SUBCOMMAND_ALLOWLIST.has(name), name).toBe(false);
		}
	});

	it('are named by no call in the source, by the exact subcommand and not by a text search', () => {
		// `merge-file` and `merge-base` are allowed, and `merge_request.*` is a push
		// option: only a call whose first argument IS a forbidden name is a finding.
		const pattern = new RegExp(`args:\\s*\\[\\s*['"](${FORBIDDEN.join('|')})['"]`);
		const offenders = FILES.filter((file) => pattern.test(file.code));

		expect(offenders.map((f) => f.path)).toEqual([]);
	});

	it('reset is only ever asked for as a mixed reset', () => {
		const calls = FILES.filter((file) => /args:\s*\[\s*['"]reset['"]/.test(file.code));

		for (const file of calls) {
			expect(file.code, file.path).toMatch(/['"]reset['"],\s*['"]--mixed['"]/);
		}
	});

	it('the allowlist is exactly the commands the design names, so a new one is a decision and not an accident', () => {
		expect(Array.from(GIT_SUBCOMMAND_ALLOWLIST).sort()).toEqual(
			[
				'cat-file',
				'commit-tree',
				'config',
				'diff',
				'fetch',
				'for-each-ref',
				'hash-object',
				'init',
				'log',
				'ls-remote',
				'ls-tree',
				'merge-base',
				'merge-file',
				'push',
				'read-tree',
				'remote',
				'reset',
				'rev-list',
				'rev-parse',
				'symbolic-ref',
				'update-index',
				'update-ref',
				'version',
				'write-tree',
			].sort()
		);
	});
});

describe('what the REST path left behind', () => {
	for (const word of ['requestUrl', 'gitlab-client', 'Authorization', 'PRIVATE-TOKEN', 'access token']) {
		it(`has no "${word}" in the source`, () => {
			const offenders = FILES.filter((file) => file.code.indexOf(word) !== -1);

			expect(offenders.map((f) => f.path)).toEqual([]);
		});
	}
});
