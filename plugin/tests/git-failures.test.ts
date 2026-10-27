import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProcessResult } from '../src/git-publishing/git-runner';
import { classifyFailure, failureOf, isPushOptionsUnsupported } from '../src/git-publishing/failures';
import type { GitFailureKind } from '../src/git-publishing/failures';

/**
 * Failed-process fixtures. These are PROVISIONAL: they are written from what
 * git, ssh and GitLab are documented and remembered to say, and task 3.10
 * replaces each with the line recorded from the real target. They are kept as
 * whole messages, not as the phrase the classifier looks for, so that a wording
 * change in the classifier is tested against the text around it.
 */
function failed(stderr: string, overrides: Partial<ProcessResult> = {}): ProcessResult {
	return {
		exitCode: 128,
		stdout: Buffer.alloc(0),
		stderr,
		timedOut: false,
		truncated: false,
		spawnError: null,
		...overrides,
	};
}

const FIXTURES: Array<[GitFailureKind, string, string]> = [
	[
		'key-rejected',
		'GitLab refuses the key',
		'git@gitlab.example.com: Permission denied (publickey).\r\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.',
	],
	[
		'key-rejected',
		'a server that lists more than one method',
		'git@gitlab.example.com: Permission denied (publickey,keyboard-interactive).',
	],
	[
		'host-changed',
		'the server key changed',
		'@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\n@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @\n@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\nHost key verification failed.\nfatal: Could not read from remote repository.',
	],
	['host-changed', 'a refused host key on its own', 'Host key verification failed.'],
	[
		'server-unreachable',
		'a host that does not resolve',
		'ssh: Could not resolve hostname gitlab.example.com: Name or service not known\nfatal: Could not read from remote repository.',
	],
	['server-unreachable', 'a connect that times out', 'ssh: connect to host gitlab.example.com port 22: Connection timed out'],
	['server-unreachable', 'a refused connection', 'ssh: connect to host gitlab.example.com port 22: Connection refused'],
	['server-unreachable', 'no route', 'ssh: connect to host 10.1.1.1 port 22: No route to host'],
	['server-unreachable', 'a network that is down', 'ssh: connect to host x port 22: Network is unreachable'],
	['server-unreachable', 'a server that closes during the handshake', 'kex_exchange_identification: Connection closed by remote host'],
	[
		'project-not-found',
		'a path that does not exist, or no access',
		"remote: ERROR: The project you were looking for could not be found or you don't have permission to view it.\nfatal: Could not read from remote repository.",
	],
	['project-not-found', 'a host that words it the other way', 'ERROR: Repository not found.\nfatal: Could not read from remote repository.'],
	[
		'not-allowed',
		'a push to a protected branch',
		'remote: GitLab: You are not allowed to push code to protected branches on this project.\nTo gitlab.example.com:a/b.git\n ! [remote rejected] abc -> doc/x (pre-receive hook declined)\nerror: failed to push some refs',
	],
	['not-allowed', 'an account with no write access', 'remote: GitLab: You are not allowed to push code to this project.'],
	[
		'changed-meanwhile',
		'a lease that no longer holds',
		'To gitlab.example.com:a/b.git\n ! [rejected]        abc -> doc/x (stale info)\nerror: failed to push some refs',
	],
	['changed-meanwhile', 'a branch that moved on', ' ! [rejected]        abc -> doc/x (fetch first)\nerror: failed to push some refs'],
	['changed-meanwhile', 'a non-fast-forward', ' ! [rejected]        abc -> doc/x (non-fast-forward)'],
	[
		'identity-missing',
		'the error in the author\'s own screenshot',
		"Author identity unknown\n\n*** Please tell me who you are.\n\nRun\n\n  git config --global user.email \"you@example.com\"\n  git config --global user.name \"Your Name\"\n\nfatal: unable to auto-detect email address (got 'STYLVN@VI26031-Trai-Pham.(none)')",
	],
	['empty-repository', 'a project with no commits', "fatal: couldn't find remote ref HEAD"],
	['ssh-missing', 'git being unable to start the ssh it was told to use', 'fatal: cannot run ssh: No such file or directory\nfatal: unable to fork'],
	['address-rewritten', 'the runner refusing an address a git setting would send elsewhere', 'fatal: address rewritten by a git setting'],
	['unexpected', 'something nobody has seen', 'fatal: the flux capacitor is out of plutonium'],
	['unexpected', 'a failure that said nothing', ''],
];

describe('classifying a failed process', () => {
	for (const [kind, label, stderr] of FIXTURES) {
		it(`reads ${label} as ${kind}`, () => {
			expect(classifyFailure(failed(stderr))).toBe(kind);
		});
	}

	it('does not mistake a refused key for an unreachable server just because git adds its usual closing line', () => {
		// "Could not read from remote repository" ends both; only the line above it differs.
		expect(classifyFailure(failed('git@h: Permission denied (publickey).\nfatal: Could not read from remote repository.'))).toBe(
			'key-rejected'
		);
		expect(classifyFailure(failed('ssh: Could not resolve hostname h: Name or service not known\nfatal: Could not read from remote repository.'))).toBe(
			'server-unreachable'
		);
	});

	it('reads English wording whatever case the program used', () => {
		expect(classifyFailure(failed('PERMISSION DENIED (PUBLICKEY).'))).toBe('key-rejected');
	});

	it('reads a message that arrived on stdout, as ssh -T does', () => {
		expect(classifyFailure(failed('', { stdout: Buffer.from('git@h: Permission denied (publickey).') }))).toBe('key-rejected');
	});

	describe('a program that never ran', () => {
		it('is git missing when git cannot be started', () => {
			expect(classifyFailure(failed('', { exitCode: null, spawnError: 'ENOENT' }), 'git')).toBe('git-missing');
		});

		it('is ssh missing when ssh or ssh-keygen cannot be started', () => {
			expect(classifyFailure(failed('', { exitCode: null, spawnError: 'ENOENT' }), 'ssh')).toBe('ssh-missing');
			expect(classifyFailure(failed('', { exitCode: null, spawnError: 'ENOENT' }), 'ssh-keygen')).toBe('ssh-missing');
		});

		it('is missing too when the file exists but cannot be run', () => {
			expect(classifyFailure(failed('', { exitCode: null, spawnError: 'EACCES' }), 'git')).toBe('git-missing');
		});

		it('is unexpected for any other reason a program would not start', () => {
			expect(classifyFailure(failed('', { exitCode: null, spawnError: 'EINVAL' }), 'git')).toBe('unexpected');
		});
	});

	it('is timed out when the process was killed for taking too long, whatever it had printed', () => {
		expect(classifyFailure(failed('Permission denied (publickey).', { exitCode: null, timedOut: true }))).toBe('timed-out');
	});

	it('treats output that hit the cap as unexpected rather than reading half a message', () => {
		expect(classifyFailure(failed('Permission denied (publickey).', { exitCode: null, truncated: true }))).toBe('unexpected');
	});
});

describe('a server that does not take push options', () => {
	it('is recognised from the wording git uses when it refuses to send them', () => {
		expect(isPushOptionsUnsupported(failed('fatal: the receiving end does not support push options\nfatal: the remote end hung up unexpectedly'))).toBe(true);
	});

	it('is not mistaken for any other failed push', () => {
		expect(isPushOptionsUnsupported(failed('Permission denied (publickey).'))).toBe(false);
		expect(isPushOptionsUnsupported(failed(''))).toBe(false);
	});
});

describe('reporting a failure', () => {
	let errors: ReturnType<typeof vi.spyOn>;
	beforeEach(() => {
		errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
	});
	afterEach(() => {
		errors.mockRestore();
	});

	it('hands the caller the kind and nothing else', () => {
		const outcome = failureOf('fetch', failed('git@h: Permission denied (publickey).'));

		expect(outcome).toEqual({ ok: false, failure: 'key-rejected' });
	});

	it('keeps the raw output for support in the console and out of the result', () => {
		const outcome = failureOf('fetch', failed('git@h: Permission denied (publickey).\nfatal: Could not read from remote repository.'));

		expect(JSON.stringify(outcome)).not.toContain('Permission denied');
		const logged = errors.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
		expect(logged).toContain('fetch');
		expect(logged).toContain('Permission denied (publickey)');
		expect(logged.startsWith('Docs Publisher:')).toBe(true);
	});

	it('bounds what it writes to the console', () => {
		failureOf('fetch', failed('x'.repeat(50_000)));

		const logged = errors.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
		expect(logged.length).toBeLessThan(5_000);
	});
});
