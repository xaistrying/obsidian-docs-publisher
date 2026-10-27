import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyFailure } from '../src/git-publishing/failures';
import {
	GIT_SUBCOMMAND_ALLOWLIST,
	buildGitEnv,
	createGitRunner,
	readGitExecPath,
	runProcess,
	stopAllProcesses,
	windowsKillCommand,
} from '../src/git-publishing/git-runner';
import type { GitRunnerConfig, ProcessOptions, ProcessResult, ProcessRunner } from '../src/git-publishing/git-runner';

/** A process runner that records what it was asked and never starts anything. */
function recordingProcess(): { run: ProcessRunner; calls: Array<{ file: string; args: string[]; options: ProcessOptions }> } {
	const calls: Array<{ file: string; args: string[]; options: ProcessOptions }> = [];
	const run: ProcessRunner = async (file, args, options) => {
		calls.push({ file, args, options });
		return okResult('');
	};
	return { run, calls };
}

function okResult(stdout: string): ProcessResult {
	return { exitCode: 0, stdout: Buffer.from(stdout), stderr: '', timedOut: false, truncated: false, spawnError: null };
}

const FAKE_GIT = '/usr/bin/git';
const SSH_COMMAND = "ssh -i '/k'";
const REMOTE = 'git@gitlab.example.com:docs/kb.git';

/** A runner over a recording process, standing in for a POSIX machine unless told otherwise. */
function mocked(extra: Partial<GitRunnerConfig> = {}) {
	const recording = recordingProcess();
	const runner = createGitRunner({
		gitPath: FAKE_GIT,
		sshCommand: null,
		hooksDir: '/h',
		platform: 'posix',
		process: recording.run,
		baseEnv: {},
		...extra,
	});
	return { runner, ...recording };
}

let work: string;
beforeEach(() => {
	work = mkdtempSync(join(tmpdir(), 'gitrunner-'));
});
afterEach(() => {
	rmSync(work, { recursive: true, force: true });
});

describe('the low-level process runner', () => {
	const baseEnv = { PATH: process.env.PATH ?? '' };

	it('captures output and the exit status', async () => {
		const result = await runProcess(process.execPath, ['-e', 'process.stdout.write("hi"); process.exit(3)'], {
			env: baseEnv,
			timeoutMs: 10_000,
		});

		expect(result.exitCode).toBe(3);
		expect(result.stdout.toString()).toBe('hi');
		expect(result.timedOut).toBe(false);
	});

	it('reports a program that cannot be started instead of throwing', async () => {
		const result = await runProcess(join(work, 'no-such-program'), [], { env: baseEnv, timeoutMs: 5_000 });

		expect(result.spawnError).toBe('ENOENT');
		expect(result.exitCode).toBeNull();
	});

	it('kills a process that outlives its timeout and says so', async () => {
		const started = Date.now();
		const result = await runProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
			env: baseEnv,
			timeoutMs: 300,
		});

		expect(result.timedOut).toBe(true);
		expect(Date.now() - started).toBeLessThan(8_000);
	});

	it.skipIf(process.platform === 'win32')(
		'kills a grandchild that holds the output pipes, not only the program it started',
		async () => {
			// git starts ssh and ssh keeps the pipes open: killing only the parent
			// leaves the caller waiting forever for the pipes to close. The
			// parent here starts a long-lived child that inherits stdout.
			const script = `
				const { spawn } = require('node:child_process');
				const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: ['ignore', 'inherit', 'inherit'] });
				process.stdout.write(String(child.pid) + '\\n');
				setInterval(() => {}, 1000);
			`;

			const result = await runProcess(process.execPath, ['-e', script], { env: baseEnv, timeoutMs: 600 });

			expect(result.timedOut).toBe(true);
			const grandchild = Number(result.stdout.toString().split('\n')[0]);
			expect(Number.isInteger(grandchild)).toBe(true);
			// Give the kernel a moment to reap it, then it must be gone.
			let alive = true;
			for (let i = 0; i < 20 && alive; i += 1) {
				try {
					process.kill(grandchild, 0);
					await new Promise((resolve) => setTimeout(resolve, 100));
				} catch {
					alive = false;
				}
			}
			expect(alive).toBe(false);
		}
	);

	it('stops collecting at the output cap and says it was cut', async () => {
		const result = await runProcess(
			process.execPath,
			['-e', 'process.stdout.write("x".repeat(200000)); setInterval(() => {}, 1000)'],
			{ env: baseEnv, timeoutMs: 10_000, maxOutputBytes: 1_000 }
		);

		expect(result.truncated).toBe(true);
		expect(result.stdout.length).toBeLessThan(200_000);
	});

	it('hands the program its input', async () => {
		const result = await runProcess(
			process.execPath,
			['-e', 'process.stdin.pipe(process.stdout)'],
			{ env: baseEnv, timeoutMs: 10_000, stdin: 'from the plugin' }
		);

		expect(result.stdout.toString()).toBe('from the plugin');
	});

	it('ends what is still running when the plugin is closed, and reports it as ended rather than timed out', async () => {
		const running = runProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
			env: baseEnv,
			timeoutMs: 60_000,
		});
		await new Promise((resolve) => setTimeout(resolve, 300));

		stopAllProcesses();
		const result = await running;

		expect(result.exitCode).toBeNull();
		expect(result.timedOut).toBe(false);
	});
});

describe('stopping a process tree on Windows', () => {
	it('runs taskkill by the path it always has, never by a name that is searched for', () => {
		const command = windowsKillCommand(4321, { SystemRoot: 'C:\\Windows' });

		expect(command.file).toBe('C:\\Windows\\System32\\taskkill.exe');
		expect(command.args).toEqual(['/pid', '4321', '/T', '/F']);
	});

	it('finds the system folder under either name Windows uses for it, and has a last resort', () => {
		expect(windowsKillCommand(1, { windir: 'D:\\WINNT' }).file).toBe('D:\\WINNT\\System32\\taskkill.exe');
		expect(windowsKillCommand(1, { systemroot: 'E:\\Win' }).file).toBe('E:\\Win\\System32\\taskkill.exe');
		expect(windowsKillCommand(1, {}).file).toBe('C:\\Windows\\System32\\taskkill.exe');
	});
});

describe('the environment a git process gets', () => {
	const base = {
		PATH: '/usr/bin',
		HOME: '/home/ana',
		AWS_SECRET_ACCESS_KEY: 'do-not-pass',
		GITHUB_TOKEN: 'do-not-pass',
		GIT_SSH_COMMAND: 'ssh -o ProxyCommand=evil',
		GIT_CONFIG_GLOBAL: '/evil',
		SSH_AUTH_SOCK: '/tmp/agent.sock',
		LANG: 'vi_VN.UTF-8',
	};

	it('carries only what git needs from the parent, never a stray secret', () => {
		const env = buildGitEnv(base, { sshCommand: "ssh -i '/k'" });

		expect(env.PATH).toBe('/usr/bin');
		expect(env.HOME).toBe('/home/ana');
		expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
		expect(env.GITHUB_TOKEN).toBeUndefined();
		expect(env.GIT_CONFIG_GLOBAL).toBeUndefined();
	});

	it('does not hand over the ssh agent, so only the key the author chose can answer', () => {
		expect(buildGitEnv(base, { sshCommand: null }).SSH_AUTH_SOCK).toBeUndefined();
	});

	it('forces English output and no prompting, whatever the machine is set to', () => {
		const env = buildGitEnv(base, { sshCommand: null });

		expect(env.LC_ALL).toBe('C');
		expect(env.LANG).toBe('C');
		expect(env.GIT_TERMINAL_PROMPT).toBe('0');
	});

	it('allows only the ssh protocol', () => {
		expect(buildGitEnv(base, { sshCommand: null }).GIT_ALLOW_PROTOCOL).toBe('ssh');
	});

	it('replaces an ssh command inherited from the parent with the plugin\'s own', () => {
		expect(buildGitEnv(base, { sshCommand: "ssh -i '/k'" }).GIT_SSH_COMMAND).toBe("ssh -i '/k'");
		expect(buildGitEnv(base, { sshCommand: null }).GIT_SSH_COMMAND).toBeUndefined();
	});

	it('lets a caller set the index and the identity, and nothing else', () => {
		const env = buildGitEnv(base, {
			sshCommand: null,
			extra: { GIT_INDEX_FILE: '/tmp/idx', GIT_AUTHOR_NAME: 'Ana', GIT_COMMITTER_EMAIL: 'a@x' },
		});

		expect(env.GIT_INDEX_FILE).toBe('/tmp/idx');
		expect(env.GIT_AUTHOR_NAME).toBe('Ana');
		expect(env.GIT_COMMITTER_EMAIL).toBe('a@x');
		expect(() => buildGitEnv(base, { sshCommand: null, extra: { GIT_DIR: '/x' } as never })).toThrow(/not allowed/);
	});

	it('matches Windows variable names without regard to case', () => {
		const env = buildGitEnv({ Path: 'C:\\Windows', SystemRoot: 'C:\\Windows' }, { sshCommand: null, platform: 'windows' });

		expect(env.Path).toBe('C:\\Windows');
		expect(env.SystemRoot).toBe('C:\\Windows');
	});

	describe('the search path', () => {
		it('keeps only the folders that name one place, so the vault cannot stand in for a program', () => {
			const env = buildGitEnv({ PATH: '/usr/bin:.:bin::/opt/tools:../x' }, { sshCommand: null, platform: 'posix' });

			expect(env.PATH).toBe('/usr/bin:/opt/tools');
		});

		it('leaves the search path out entirely when nothing absolute is left, rather than set it empty', () => {
			const env = buildGitEnv({ PATH: '.:bin:' }, { sshCommand: null, platform: 'posix' });

			expect(env.PATH).toBeUndefined();
		});

		it('does the same on Windows, where quotes are not part of a folder and a drive-less entry is not absolute', () => {
			const env = buildGitEnv(
				{ Path: '"C:\\Program Files\\Git\\cmd";.;tools;C:tools;C:\\Windows' },
				{ sshCommand: null, platform: 'windows' }
			);

			expect(env.Path).toBe('C:\\Program Files\\Git\\cmd;C:\\Windows');
		});
	});
});

describe('the git runner', () => {
	it('puts the forced settings in front of the subcommand', async () => {
		const { runner, calls } = mocked({ hooksDir: '/plugin/no-hooks', baseEnv: { PATH: '/usr/bin' } });

		await runner.run({ args: ['rev-parse', 'HEAD'], cwd: work });

		const args = calls[0].args;
		expect(args.slice(0, 14)).toEqual([
			'-c', 'color.ui=false',
			'-c', 'core.quotepath=false',
			'-c', 'core.longpaths=true',
			'-c', 'core.fsmonitor=false',
			'-c', 'core.hooksPath=/dev/null',
			'-c', 'gc.auto=0',
			'-c', 'maintenance.auto=false',
		]);
		expect(args.slice(-2)).toEqual(['rev-parse', 'HEAD']);
		expect(calls[0].file).toBe(FAKE_GIT);
		expect(calls[0].options.cwd).toBe(work);
	});

	it('gives a network command a longer timeout than a local one', async () => {
		const { runner, calls } = mocked({ sshCommand: SSH_COMMAND });

		await runner.run({ args: ['rev-parse', 'HEAD'], cwd: work });
		await runner.run({ args: ['ls-remote', REMOTE], cwd: work, remote: REMOTE });

		const local = calls[0];
		const network = calls[calls.length - 1];
		expect(network.options.timeoutMs).toBeGreaterThan(local.options.timeoutMs);
	});

	const forbidden: string[][] = [
		['checkout', 'main'],
		['switch', '-c', 'x'],
		['merge', 'origin/main'],
		['pull'],
		['rebase', 'main'],
		['restore', '.'],
		['stash'],
		['reset', '--hard', 'HEAD'],
		['reset', '--merge'],
		['reset', 'HEAD'],
		['clean', '-fd'],
		['gc'],
		// Constructor and prototype names are not subcommands.
		['constructor'],
		['__proto__'],
		['toString'],
	];
	for (const args of forbidden) {
		it(`refuses \`git ${args.join(' ')}\` without starting a process`, async () => {
			const { runner, calls } = mocked();

			await expect(runner.run({ args, cwd: work })).rejects.toThrow(/not allowed/);
			expect(calls).toHaveLength(0);
		});
	}

	it('accepts a mixed reset', async () => {
		const { runner, calls } = mocked();

		await runner.run({ args: ['reset', '--mixed', 'abc123'], cwd: work });

		expect(calls).toHaveLength(1);
	});

	it('refuses an option where the subcommand belongs', async () => {
		const { runner, calls } = mocked();

		await expect(runner.run({ args: ['--exec-path=/evil', 'version'], cwd: work })).rejects.toThrow(/not allowed/);
		expect(calls).toHaveLength(0);
	});

	for (const address of ['ext::sh -c touch /tmp/x', 'fd::17', 'EXT::sh']) {
		it(`refuses the transport-helper address ${JSON.stringify(address)} without starting a process`, async () => {
			const { runner, calls } = mocked({ sshCommand: SSH_COMMAND });

			await expect(runner.run({ args: ['ls-remote', address], cwd: work, remote: address })).rejects.toThrow(/not allowed/);
			expect(calls).toHaveLength(0);
		});
	}

	it('does not mistake a note called a::b.md for a transport address when it comes after the paths marker', async () => {
		const { runner, calls } = mocked();

		await runner.run({ args: ['hash-object', '--no-filters', '--', 'a::b.md'], cwd: work });

		expect(calls).toHaveLength(1);
	});

	it('keeps the allowlist free of every working-tree command', () => {
		for (const name of ['checkout', 'switch', 'merge', 'pull', 'rebase', 'restore', 'stash', 'clean', 'gc', 'am', 'apply', 'cherry-pick', 'revert']) {
			expect(GIT_SUBCOMMAND_ALLOWLIST.has(name)).toBe(false);
		}
	});

	it('does not let an env override reach the process', async () => {
		const { runner, calls } = mocked({ baseEnv: { PATH: '/usr/bin' } });

		await expect(
			runner.run({ args: ['rev-parse', 'HEAD'], cwd: work, extraEnv: { GIT_EXEC_PATH: '/evil' } as never })
		).rejects.toThrow(/not allowed/);
		expect(calls).toHaveLength(0);
	});
});

/**
 * The options each subcommand takes, written out in full. git accepts any
 * unique prefix of a long option and glued short options, so a check for the
 * dangerous word alone is a check the dangerous word can walk around: `--har`
 * is `--hard`, `-mu` is `-m -u`.
 */
describe('the options a subcommand may be given', () => {
	const INDEX = { GIT_INDEX_FILE: '/tmp/idx' };

	const refused: Array<[string, string[]]> = [
		['an abbreviated hard reset', ['reset', '--har', 'abc']],
		['a mixed reset that is also hard', ['reset', '--mixed', '--hard', 'abc']],
		['a reset that names no mode', ['reset', '-q', 'abc']],
		['a reset with the mode abbreviated', ['reset', '--mix', 'abc']],
		['read-tree with glued short options that write the working tree', ['read-tree', '-mu', 'abc']],
		['read-tree that updates the working tree', ['read-tree', '-u', 'abc']],
		['read-tree that resets', ['read-tree', '--reset', 'abc']],
		['a diff that writes its output to a file', ['diff', '--no-ext-diff', '--no-textconv', '--output=/vault/note.md']],
		['a diff that runs an external program', ['diff', '--ext-diff', '--no-textconv']],
		['a diff that does not turn the converters off', ['diff', '--name-only', 'a', 'b']],
		['a diff against files outside the repository', ['diff', '--no-ext-diff', '--no-textconv', '--no-index', 'a', 'b']],
		['a log that writes its output to a file', ['log', '--output=/vault/note.md']],
		['a log that prints patches', ['log', '-p']],
		['cat-file converting through a program', ['cat-file', '--textconv', 'abc']],
		['cat-file applying filters', ['cat-file', '--filters', 'abc']],
		['hash-object that runs a clean filter', ['hash-object', '-w', '--', 'a.md']],
		['hash-object told which attributes to use', ['hash-object', '--no-filters', '--path=other.md', '--', 'a.md']],
		['a signed commit, which starts gpg', ['commit-tree', '-S', 'abc']],
		['a forced push', ['push', '--force', 'x']],
		['a mirror push', ['push', '--mirror']],
		['a push that names its own receive-pack program', ['push', '--receive-pack=evil', 'x']],
		['config against the machine', ['config', '--global', 'user.name', 'x']],
		['config against the system', ['config', '--system', 'user.name', 'x']],
		['config against a named file', ['config', '--file=/x', 'a.b', 'c']],
		['config against a named file, short form', ['config', '-f', '/x', 'a.b', 'c']],
		['a fetch that names a program for the server to run', ['fetch', '--upload-pack=evil', 'x']],
		['an abbreviated long option on a command that has the full one', ['ls-remote', '--sym', 'x']],
		['merge-file that would overwrite the first file', ['merge-file', 'a', 'b', 'c']],
		['merge-file in a mode that writes objects', ['merge-file', '-p', '--object-id', 'a', 'b', 'c']],
	];
	for (const [label, args] of refused) {
		it(`refuses ${label}`, async () => {
			const { runner, calls } = mocked({ sshCommand: SSH_COMMAND });

			await expect(runner.run({ args, cwd: work, remote: 'x', extraEnv: INDEX })).rejects.toThrow(/not allowed/);
			expect(calls).toHaveLength(0);
		});
	}

	const accepted: Array<[string, string[]]> = [
		['rev-parse of a name', ['rev-parse', '--verify', '--quiet', 'refs/docs-publisher/synced']],
		['a config read', ['config', '--get', 'user.name']],
		['a repository-local config write', ['config', '--local', 'user.name', 'Ana']],
		['hash-object with the filters off, naming a note that starts with a dash', ['hash-object', '-w', '--no-filters', '--', '-odd.md']],
		['a name-only diff with the converters off', ['diff', '--no-ext-diff', '--no-textconv', '--name-only', 'a', 'b']],
		['an index update from a throwaway index', ['update-index', '--add', '--cacheinfo', '100644,abc,a.md']],
		['a tree write from a throwaway index', ['write-tree']],
		['a commit of a tree, with its parent and message', ['commit-tree', 'abc', '-p', 'def', '-m', 'docs: add a']],
		['a listing of what changed', ['log', '--format=%H', '--max-count=5', '--no-ext-diff', 'abc..def']],
		['a three-way merge printed to stdout', ['merge-file', '-p', '--diff3', 'a', 'b', 'c']],
		['for-each-ref with a format', ['for-each-ref', '--format=%(refname)', 'refs/docs-publisher/']],
	];
	for (const [label, args] of accepted) {
		it(`accepts ${label}`, async () => {
			const { runner, calls } = mocked();

			await runner.run({ args, cwd: work, extraEnv: INDEX });

			expect(calls).toHaveLength(1);
		});
	}

	it('refuses an index command without a throwaway index, which would be the real one', async () => {
		const { runner, calls } = mocked();

		await expect(runner.run({ args: ['update-index', '--add', '--cacheinfo', '100644,abc,a.md'], cwd: work })).rejects.toThrow(
			/real index/
		);
		await expect(runner.run({ args: ['write-tree'], cwd: work })).rejects.toThrow(/real index/);
		await expect(runner.run({ args: ['read-tree', 'abc'], cwd: work })).rejects.toThrow(/real index/);
		expect(calls).toHaveLength(0);
	});
});

describe('a command that reaches a server', () => {
	it('must say which address it reaches', async () => {
		const { runner, calls } = mocked({ sshCommand: SSH_COMMAND });

		await expect(runner.run({ args: ['ls-remote', REMOTE], cwd: work })).rejects.toThrow(/address/);
		expect(calls).toHaveLength(0);
	});

	it('must not say one address and use another', async () => {
		const { runner, calls } = mocked({ sshCommand: SSH_COMMAND });

		await expect(
			runner.run({ args: ['ls-remote', 'git@evil.example.com:a/b.git'], cwd: work, remote: REMOTE })
		).rejects.toThrow(/address/);
		expect(calls).toHaveLength(0);
	});

	it('is refused before a key is chosen, so no other identity can answer for the author', async () => {
		const { runner, calls } = mocked({ sshCommand: null });

		await expect(runner.run({ args: ['fetch', '--prune', REMOTE], cwd: work, remote: REMOTE })).rejects.toThrow(/key/);
		expect(calls).toHaveLength(0);
	});

	describe('when a git setting would send it somewhere else', () => {
		/** The query that looks for rewrite rules answers with `answer`; anything else answers with success. */
		function withRewriteRules(answer: ProcessResult) {
			const calls: Array<{ args: string[] }> = [];
			const run: ProcessRunner = async (_file, args) => {
				calls.push({ args });
				return args.indexOf('--get-regexp') !== -1 ? answer : okResult('');
			};
			const runner = createGitRunner({
				gitPath: FAKE_GIT,
				sshCommand: SSH_COMMAND,
				hooksDir: '/h',
				platform: 'posix',
				process: run,
				baseEnv: {},
			});
			return { runner, calls };
		}
		const noRules = { ...okResult(''), exitCode: 1 };
		const rule = (key: string, prefix: string): ProcessResult => okResult(`${key}\n${prefix}\0`);

		it('goes ahead when no setting rewrites anything', async () => {
			const { runner, calls } = withRewriteRules(noRules);

			await runner.run({ args: ['ls-remote', REMOTE], cwd: work, remote: REMOTE });

			expect(calls).toHaveLength(2);
			expect(calls[1].args).toContain('ls-remote');
		});

		it('stops, and starts nothing, when an insteadOf setting covers the address', async () => {
			const { runner, calls } = withRewriteRules(rule('url.ssh://evil.example.com/.insteadof', 'git@gitlab.example.com:'));

			const result = await runner.run({ args: ['ls-remote', REMOTE], cwd: work, remote: REMOTE });

			expect(result.exitCode).not.toBe(0);
			expect(classifyFailure(result)).toBe('address-rewritten');
			expect(calls).toHaveLength(1);
		});

		it('stops for a pushInsteadOf setting too, which only a push would honour', async () => {
			const { runner, calls } = withRewriteRules(rule('url.ssh://evil.example.com/.pushinsteadof', REMOTE));

			const result = await runner.run({ args: ['push', REMOTE, 'abc:refs/heads/doc/x'], cwd: work, remote: REMOTE });

			expect(classifyFailure(result)).toBe('address-rewritten');
			expect(calls).toHaveLength(1);
		});

		it('stops for a setting with an empty prefix, which git applies to every address', async () => {
			const { runner } = withRewriteRules(rule('url.ssh://evil.example.com/.insteadof', ''));

			const result = await runner.run({ args: ['ls-remote', REMOTE], cwd: work, remote: REMOTE });

			expect(classifyFailure(result)).toBe('address-rewritten');
		});

		it('leaves a setting for another address alone, such as the common one for github', async () => {
			const { runner, calls } = withRewriteRules(rule('url.git@github.com:.insteadof', 'https://github.com/'));

			await runner.run({ args: ['ls-remote', REMOTE], cwd: work, remote: REMOTE });

			expect(calls).toHaveLength(2);
		});

		it('finds a rule among several', async () => {
			const answer = okResult(
				'url.git@github.com:.insteadof\nhttps://github.com/\0url.ssh://evil.example.com/.insteadof\ngit@gitlab.example.com:\0'
			);
			const { runner } = withRewriteRules(answer);

			const result = await runner.run({ args: ['ls-remote', REMOTE], cwd: work, remote: REMOTE });

			expect(classifyFailure(result)).toBe('address-rewritten');
		});

		it('does not guess when the settings cannot be read, and returns the failure as it was', async () => {
			const broken: ProcessResult = { ...okResult(''), exitCode: 128, stderr: 'fatal: bad config line 3 in file .git/config' };
			const { runner, calls } = withRewriteRules(broken);

			const result = await runner.run({ args: ['ls-remote', REMOTE], cwd: work, remote: REMOTE });

			expect(result.exitCode).toBe(128);
			expect(calls).toHaveLength(1);
		});

		it('does not check a command that stays on this machine', async () => {
			const { runner, calls } = withRewriteRules(rule('url.x.insteadof', ''));

			await runner.run({ args: ['rev-parse', 'HEAD'], cwd: work });

			expect(calls).toHaveLength(1);
		});
	});
});

describe('hooks', () => {
	it('are pointed at the folder given on Windows, which has no path that means nothing', async () => {
		const { runner, calls } = mocked({ platform: 'windows', hooksDir: 'C:\\Temp\\no-hooks', listFolder: async () => [] });

		await runner.run({ args: ['rev-parse', 'HEAD'], cwd: work });

		expect(calls[0].args).toContain('core.hooksPath=C:\\Temp\\no-hooks');
	});

	it('are refused on Windows when something has been put in that folder, and nothing starts', async () => {
		const { runner, calls } = mocked({ platform: 'windows', hooksDir: 'C:\\Temp\\no-hooks', listFolder: async () => ['pre-push'] });

		await expect(runner.run({ args: ['rev-parse', 'HEAD'], cwd: work })).rejects.toThrow(/hooks folder/);
		expect(calls).toHaveLength(0);
	});

	it('are fine on Windows when the folder does not exist, which is how it is meant to be', async () => {
		const missing = async (): Promise<string[]> => {
			throw Object.assign(new Error('gone'), { code: 'ENOENT' });
		};
		const { runner, calls } = mocked({ platform: 'windows', hooksDir: 'C:\\Temp\\no-hooks', listFolder: missing });

		await runner.run({ args: ['rev-parse', 'HEAD'], cwd: work });

		expect(calls).toHaveLength(1);
	});

	it('are refused on Windows when the folder cannot be read, since it is then not known to be empty', async () => {
		const unreadable = async (): Promise<string[]> => {
			throw Object.assign(new Error('denied'), { code: 'EACCES' });
		};
		const { runner, calls } = mocked({ platform: 'windows', hooksDir: 'C:\\Temp\\no-hooks', listFolder: unreadable });

		await expect(runner.run({ args: ['rev-parse', 'HEAD'], cwd: work })).rejects.toThrow(/hooks folder/);
		expect(calls).toHaveLength(0);
	});
});

describe('finding git', () => {
	it('uses a git found on the search path, by its full path', async () => {
		const { runner, calls } = mocked({
			gitPath: undefined,
			baseEnv: { PATH: '/opt/tools:/usr/bin' },
			exists: (path) => path === '/opt/tools/git',
		});

		await runner.run({ args: ['version'], cwd: work });

		expect(calls[0].file).toBe('/opt/tools/git');
	});

	it('reports git as missing, and starts nothing, when it is nowhere', async () => {
		const { runner, calls } = mocked({ gitPath: undefined, baseEnv: { PATH: '/usr/bin' }, exists: () => false });

		const result = await runner.run({ args: ['version'], cwd: work });

		expect(result.spawnError).toBe('ENOENT');
		expect(classifyFailure(result)).toBe('git-missing');
		expect(calls).toHaveLength(0);
	});

	it('finds a git installed while the plugin was running, on the next try', async () => {
		let installed = false;
		const { runner, calls } = mocked({
			gitPath: undefined,
			baseEnv: { PATH: '/usr/bin' },
			exists: (path) => installed && path === '/usr/local/bin/git',
		});

		const before = await runner.run({ args: ['version'], cwd: work });
		installed = true;
		await runner.run({ args: ['version'], cwd: work });

		expect(before.spawnError).toBe('ENOENT');
		expect(calls[0].file).toBe('/usr/local/bin/git');
	});

	it('does not run a git that is only in the working folder', async () => {
		const { runner, calls } = mocked({
			gitPath: undefined,
			baseEnv: { PATH: '.:/usr/bin' },
			exists: (path) => path === 'git' || path === './git' || path === '/usr/bin/git/git' || path === `${work}/git`,
		});

		const result = await runner.run({ args: ['version'], cwd: work });

		expect(result.spawnError).toBe('ENOENT');
		expect(calls).toHaveLength(0);
	});
});

describe('finding where git keeps its helpers', () => {
	it('asks git, and returns the folder it names', async () => {
		const found = await readGitExecPath();

		expect(found).not.toBeNull();
		expect(found).toMatch(/git-core|libexec|git/);
	});

	it('returns nothing when git cannot be started, rather than throwing', async () => {
		expect(await readGitExecPath({ gitPath: join(work, 'no-git') })).toBeNull();
	});

	it('returns nothing when git is not installed at all', async () => {
		const never: ProcessRunner = vi.fn(async () => okResult('/x'));

		expect(await readGitExecPath({ process: never, baseEnv: { PATH: '/usr/bin' }, exists: () => false })).toBeNull();
		expect(never).not.toHaveBeenCalled();
	});

	it('returns nothing when git answers with nothing', async () => {
		const empty: ProcessRunner = async () => okResult('  \n');

		expect(await readGitExecPath({ process: empty })).toBeNull();
	});

	it('returns nothing when git fails', async () => {
		const failing: ProcessRunner = async () => ({ ...okResult('/x'), exitCode: 1 });

		expect(await readGitExecPath({ process: failing })).toBeNull();
	});
});

describe('the git runner against a real git', () => {
	const hooks = (): string => {
		const dir = join(work, 'no-hooks');
		mkdirSync(dir, { recursive: true });
		return dir;
	};

	it('runs a subcommand and returns its output', async () => {
		const runner = createGitRunner({ sshCommand: null, hooksDir: hooks() });

		const result = await runner.run({ args: ['version'], cwd: work });

		expect(result.exitCode).toBe(0);
		expect(result.stdout.toString()).toMatch(/^git version /);
	});

	it('overrides a repository that turns colour output on', async () => {
		execFileSync('git', ['init', '-q', work]);
		execFileSync('git', ['-C', work, 'config', 'color.ui', 'always']);
		const runner = createGitRunner({ sshCommand: null, hooksDir: hooks() });

		const result = await runner.run({ args: ['config', '--get', 'color.ui'], cwd: work });

		expect(result.stdout.toString().trim()).toBe('false');
	});

	it.skipIf(process.platform === 'win32')('points hooks at nothing, whatever the repository configures', async () => {
		execFileSync('git', ['init', '-q', work]);
		const runner = createGitRunner({ sshCommand: null, hooksDir: hooks() });

		const result = await runner.run({ args: ['config', '--get', 'core.hooksPath'], cwd: work });

		expect(result.stdout.toString().trim()).toBe('/dev/null');
	});

	// The strongest check there is: a hook that would leave a mark, in the
	// repository's own hooks folder, and a command that would run it.
	it.skipIf(process.platform === 'win32')('does not run a hook the repository carries', async () => {
		execFileSync('git', ['init', '-q', work]);
		const marker = join(work, 'hook-ran');
		const hook = join(work, '.git', 'hooks', 'reference-transaction');
		writeFileSync(hook, `#!/bin/sh\necho ran >> '${marker}'\n`);
		chmodSync(hook, 0o755);
		const identity = ['-c', 'user.name=T', '-c', 'user.email=t@example.com'];
		execFileSync('git', ['-C', work, ...identity, 'commit', '-q', '--allow-empty', '-m', 'first']);
		// The check that the check can fail: plain git does run this hook.
		rmSync(marker, { force: true });
		execFileSync('git', ['-C', work, 'update-ref', 'refs/test/plain', 'HEAD']);
		if (!existsSync(marker)) {
			return; // This git does not run reference-transaction hooks; nothing to prove with it.
		}
		rmSync(marker, { force: true });
		const runner = createGitRunner({ sshCommand: null, hooksDir: hooks() });

		const result = await runner.run({ args: ['update-ref', 'refs/test/through-runner', 'HEAD'], cwd: work });

		expect(result.exitCode).toBe(0);
		expect(existsSync(marker)).toBe(false);
	});

	it('passes a file called --help as a path, not as an option', async () => {
		execFileSync('git', ['init', '-q', work]);
		writeFileSync(join(work, '--help'), 'content');
		const runner = createGitRunner({ sshCommand: null, hooksDir: hooks() });

		const result = await runner.run({ args: ['hash-object', '--no-filters', '--', '--help'], cwd: work });

		expect(result.exitCode).toBe(0);
		expect(result.stdout.toString().trim()).toMatch(/^[0-9a-f]{40}$/);
	});

	it('never lets a shell see a name full of metacharacters', async () => {
		execFileSync('git', ['init', '-q', work]);
		const nasty = 'a;b $(touch pwned) `touch pwned2`.md';
		writeFileSync(join(work, nasty), 'x');
		const runner = createGitRunner({ sshCommand: null, hooksDir: hooks() });

		const result = await runner.run({ args: ['hash-object', '--no-filters', '--', nasty], cwd: work });

		expect(result.exitCode).toBe(0);
		expect(existsSync(join(work, 'pwned'))).toBe(false);
		expect(existsSync(join(work, 'pwned2'))).toBe(false);
	});

	it('reports a missing git binary as a spawn error', async () => {
		const runner = createGitRunner({ gitPath: join(work, 'no-git'), sshCommand: null, hooksDir: hooks() });

		const result = await runner.run({ args: ['version'], cwd: work });

		expect(result.spawnError).toBe('ENOENT');
	});

	it('does not run a git program that sits in the vault, even when the search path names the vault', async () => {
		const vault = join(work, 'vault');
		mkdirSync(vault);
		const planted = join(vault, process.platform === 'win32' ? 'git.exe' : 'git');
		writeFileSync(planted, '#!/bin/sh\necho planted > planted-ran\n');
		chmodSync(planted, 0o755);
		const runner = createGitRunner({
			sshCommand: null,
			hooksDir: hooks(),
			baseEnv: { PATH: `.${process.platform === 'win32' ? ';' : ':'}${join(vault, 'sub')}` },
			exists: (path) => path === planted,
		});

		const result = await runner.run({ args: ['version'], cwd: vault });

		expect(result.spawnError).toBe('ENOENT');
		expect(existsSync(join(vault, 'planted-ran'))).toBe(false);
	});

	describe.skipIf(process.platform === 'win32')('a network command through a stand-in ssh', () => {
		let bin: string;
		let record: string;
		beforeEach(() => {
			bin = join(work, 'bin');
			record = join(work, 'ssh-arguments');
			mkdirSync(bin);
			// Records what ssh was started with, then refuses like a server that
			// does not know the key, so git ends in a classified failure.
			const script = `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a"; done > '${record}'\necho 'git@gitlab.example.com: Permission denied (publickey).' >&2\nexit 255\n`;
			writeFileSync(join(bin, 'ssh'), script);
			chmodSync(join(bin, 'ssh'), 0o755);
		});

		const withStandIn = (): ReturnType<typeof createGitRunner> =>
			createGitRunner({
				sshCommand: 'ssh -i /nowhere -o BatchMode=yes',
				hooksDir: hooks(),
				baseEnv: { PATH: `${bin}:/usr/bin:/bin`, HOME: work },
			});

		it('reaches the stand-in with the options the plugin chose, and classifies what it says', async () => {
			execFileSync('git', ['init', '-q', work]);
			const runner = withStandIn();

			const result = await runner.run({ args: ['ls-remote', REMOTE, 'HEAD'], cwd: work, remote: REMOTE });

			expect(classifyFailure(result)).toBe('key-rejected');
			const seen = readFileSync(record, 'utf8').split('\n');
			expect(seen).toContain('BatchMode=yes');
			expect(seen).toContain('git@gitlab.example.com');
		});

		it('stops before ssh is started when the repository rewrites the address', async () => {
			execFileSync('git', ['init', '-q', work]);
			execFileSync('git', ['-C', work, 'config', 'url.ssh://evil.example.com/.insteadOf', 'git@gitlab.example.com:']);
			const runner = withStandIn();

			const result = await runner.run({ args: ['ls-remote', REMOTE, 'HEAD'], cwd: work, remote: REMOTE });

			expect(classifyFailure(result)).toBe('address-rewritten');
			expect(existsSync(record)).toBe(false);
		});

		it('stops for a pushInsteadOf setting in the repository as well', async () => {
			execFileSync('git', ['init', '-q', work]);
			execFileSync('git', ['-C', work, 'config', 'url.ssh://evil.example.com/.pushInsteadOf', 'git@gitlab.example.com:']);
			const runner = withStandIn();

			const result = await runner.run({ args: ['ls-remote', REMOTE, 'HEAD'], cwd: work, remote: REMOTE });

			expect(classifyFailure(result)).toBe('address-rewritten');
		});

		it('is not stopped by a rewrite of some other address', async () => {
			execFileSync('git', ['init', '-q', work]);
			execFileSync('git', ['-C', work, 'config', 'url.git@github.com:.insteadOf', 'https://github.com/']);
			const runner = withStandIn();

			const result = await runner.run({ args: ['ls-remote', REMOTE, 'HEAD'], cwd: work, remote: REMOTE });

			expect(classifyFailure(result)).toBe('key-rejected');
		});
	});
});
