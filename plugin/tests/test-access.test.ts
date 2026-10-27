import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitRequest, GitRunner, ProcessOptions, ProcessResult, ProcessRunner } from '../src/git-publishing/git-runner';
import { parseProjectAddress } from '../src/git-publishing/project-address';
import type { ProjectAddress } from '../src/git-publishing/project-address';
import { testAccess } from '../src/git-publishing/test-access';

function result(overrides: Partial<ProcessResult> & { out?: string } = {}): ProcessResult {
	const { out, ...rest } = overrides;
	return {
		exitCode: 0,
		stdout: Buffer.from(out ?? ''),
		stderr: '',
		timedOut: false,
		truncated: false,
		spawnError: null,
		...rest,
	};
}

const address = parseProjectAddress('git@gitlab.example.com:docs/kb.git') as ProjectAddress;
const KEY = '/home/Trai Pham/.ssh/docs-publisher_ed25519';

interface Harness {
	calls: string[];
	gitCalls: GitRequest[];
	toolCalls: Array<{ file: string; args: string[]; options: ProcessOptions }>;
	git: GitRunner;
	run: ProcessRunner;
}

/**
 * `lsRemote`: what git answers. `keygen`: what ssh-keygen answers to the
 * password probe. `greeting`: what `ssh -T` answers.
 */
function harness(answers: { keygen?: ProcessResult; lsRemote?: ProcessResult; greeting?: ProcessResult }): Harness {
	const calls: string[] = [];
	const gitCalls: GitRequest[] = [];
	const toolCalls: Harness['toolCalls'] = [];
	const git: GitRunner = {
		run: vi.fn(async (request: GitRequest) => {
			calls.push('ls-remote');
			gitCalls.push(request);
			return answers.lsRemote ?? result({ out: 'ref: refs/heads/main\tHEAD\nabc123\tHEAD\n' });
		}),
	};
	const run: ProcessRunner = vi.fn(async (file, args, options) => {
		toolCalls.push({ file, args, options });
		if (args[0] === '-y') {
			calls.push('probe');
			return answers.keygen ?? result({ out: 'ssh-ed25519 AAAA test\n' });
		}
		calls.push('ssh -T');
		return answers.greeting ?? result({ out: 'Welcome to GitLab, @ana.nguyen!\n' });
	});
	return { calls, gitCalls, toolCalls, git, run };
}

const tools = { sshPath: '/usr/bin/ssh', sshKeygenPath: '/usr/bin/ssh-keygen', cwd: '/vault' };

describe('testing the key and the project address together', () => {
	let errors: ReturnType<typeof vi.spyOn>;
	beforeEach(() => {
		errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
	});

	it('succeeds with the default branch and the username when everything is in order', async () => {
		const h = harness({});

		const outcome = await testAccess({ git: h.git, run: h.run, ...tools }, address, KEY);

		expect(outcome).toEqual({ ok: true, value: { defaultBranch: 'main', username: 'ana.nguyen' } });
	});

	it('checks the key, then the project, then asks who the key belongs to, in that order', async () => {
		const h = harness({});

		await testAccess({ git: h.git, run: h.run, ...tools }, address, KEY);

		expect(h.calls).toEqual(['probe', 'ls-remote', 'ssh -T']);
	});

	it('reads whatever the default branch is called, never assuming', async () => {
		const h = harness({ lsRemote: result({ out: 'ref: refs/heads/master\tHEAD\nabc\tHEAD\n' }) });

		const outcome = await testAccess({ git: h.git, run: h.run, ...tools }, address, KEY);

		expect(outcome.ok && outcome.value.defaultBranch).toBe('master');
	});

	it('lists the project by its ssh address, through the runner that was configured with the key', async () => {
		const h = harness({});

		await testAccess({ git: h.git, run: h.run, ...tools }, address, KEY);

		expect(h.gitCalls[0].args).toEqual(['ls-remote', '--symref', 'git@gitlab.example.com:docs/kb.git', 'HEAD']);
		expect(h.gitCalls[0].cwd).toBe('/vault');
	});

	it('says which address it reaches, so the runner can check that no setting sends it elsewhere', async () => {
		const h = harness({});

		await testAccess({ git: h.git, run: h.run, ...tools }, address, KEY);

		expect(h.gitCalls[0].remote).toBe('git@gitlab.example.com:docs/kb.git');
	});

	it('reports an address a git setting rewrites as such', async () => {
		const h = harness({ lsRemote: result({ exitCode: 128, stderr: 'fatal: address rewritten by a git setting' }) });

		expect(await testAccess({ git: h.git, run: h.run, ...tools }, address, KEY)).toEqual({
			ok: false,
			failure: 'address-rewritten',
		});
	});

	// The default branch comes from the server and later goes into an address
	// and a refspec, so only an ordinary name is believed.
	describe('a default branch name from the server', () => {
		for (const name of ['main', 'master', 'release/2026.10', 'trunk_2', 'v1.2-x']) {
			it(`accepts ${name}`, async () => {
				const h = harness({ lsRemote: result({ out: `ref: refs/heads/${name}\tHEAD\nabc\tHEAD\n` }) });

				const outcome = await testAccess({ git: h.git, run: h.run, ...tools }, address, KEY);

				expect(outcome.ok && outcome.value.defaultBranch).toBe(name);
			});
		}
		for (const name of ['--upload-pack=x', '-x', '.hidden', 'a..b', 'x.lock', 'a//b', 'trailing/', 'trailing.', 'a/.b', 'a$b', 'a;b']) {
			it(`does not believe ${name}`, async () => {
				const h = harness({ lsRemote: result({ out: `ref: refs/heads/${name}\tHEAD\nabc\tHEAD\n` }) });

				expect(await testAccess({ git: h.git, run: h.run, ...tools }, address, KEY)).toEqual({ ok: false, failure: 'unexpected' });
			});
		}
	});

	it('asks ssh for the greeting with the same key and rules, as arguments and not a shell string', async () => {
		const h = harness({});

		await testAccess({ git: h.git, run: h.run, ...tools }, address, KEY);

		const ssh = h.toolCalls.find((c) => c.args.indexOf('-T') !== -1);
		expect(ssh?.file).toBe('/usr/bin/ssh');
		expect(ssh?.args).toEqual([
			'-i', KEY,
			'-o', 'IdentitiesOnly=yes',
			'-o', 'BatchMode=yes',
			'-o', 'StrictHostKeyChecking=accept-new',
			'-o', 'ConnectTimeout=15',
			'-o', 'ForwardAgent=no',
			'-o', 'ClearAllForwardings=yes',
			'-o', 'ForwardX11=no',
			'-T', 'git@gitlab.example.com',
		]);
	});

	it('adds the port for a server that is not on 22', async () => {
		const h = harness({});
		const custom = parseProjectAddress('ssh://git@gitlab.example.com:2222/docs/kb.git') as ProjectAddress;

		await testAccess({ git: h.git, run: h.run, ...tools }, custom, KEY);

		const ssh = h.toolCalls.find((c) => c.args.indexOf('-T') !== -1);
		expect(ssh?.args.slice(-4)).toEqual(['-p', '2222', '-T', 'git@gitlab.example.com']);
	});

	describe('a key with a password', () => {
		it('stops before the network, since ssh could not tell it from an unregistered key', async () => {
			const h = harness({ keygen: result({ exitCode: 255, stderr: 'Load key "k": incorrect passphrase supplied to decrypt private key' }) });

			const outcome = await testAccess({ git: h.git, run: h.run, ...tools }, address, KEY);

			expect(outcome).toEqual({ ok: false, failure: 'key-protected' });
			expect(h.calls).toEqual(['probe']);
		});
	});

	describe('a key that cannot be read at all', () => {
		it('is not reported as a key with a password, and does not reach the network', async () => {
			const h = harness({ keygen: result({ exitCode: 255, stderr: 'k: No such file or directory' }) });

			const outcome = await testAccess({ git: h.git, run: h.run, ...tools }, address, KEY);

			expect(outcome).toEqual({ ok: false, failure: 'key-unreadable' });
			expect(h.calls).toEqual(['probe']);
		});
	});

	describe('a key GitLab has not been given', () => {
		it('is reported as rejected, and ssh is not asked for a greeting it cannot get', async () => {
			const h = harness({
				lsRemote: result({ exitCode: 128, stderr: 'git@gitlab.example.com: Permission denied (publickey).\nfatal: Could not read from remote repository.' }),
			});

			const outcome = await testAccess({ git: h.git, run: h.run, ...tools }, address, KEY);

			expect(outcome).toEqual({ ok: false, failure: 'key-rejected' });
			expect(h.calls).toEqual(['probe', 'ls-remote']);
		});
	});

	it('reports a project the key cannot see', async () => {
		const h = harness({
			lsRemote: result({ exitCode: 128, stderr: "remote: ERROR: The project you were looking for could not be found or you don't have permission to view it." }),
		});

		expect(await testAccess({ git: h.git, run: h.run, ...tools }, address, KEY)).toEqual({ ok: false, failure: 'project-not-found' });
	});

	it('reports a project with nothing in it, from an empty answer that is not an error', async () => {
		const h = harness({ lsRemote: result({ exitCode: 0, out: '' }) });

		expect(await testAccess({ git: h.git, run: h.run, ...tools }, address, KEY)).toEqual({ ok: false, failure: 'empty-repository' });
	});

	it('does not guess a default branch from an answer that names none', async () => {
		const h = harness({ lsRemote: result({ out: 'abc123\tHEAD\n' }) });

		expect(await testAccess({ git: h.git, run: h.run, ...tools }, address, KEY)).toEqual({ ok: false, failure: 'unexpected' });
	});

	it('reports a server that cannot be reached', async () => {
		const h = harness({
			lsRemote: result({ exitCode: 255, stderr: 'ssh: connect to host gitlab.example.com port 22: Connection timed out' }),
		});

		expect(await testAccess({ git: h.git, run: h.run, ...tools }, address, KEY)).toEqual({ ok: false, failure: 'server-unreachable' });
	});

	it('reports a test that ran out of time', async () => {
		const h = harness({ lsRemote: result({ exitCode: null, timedOut: true }) });

		expect(await testAccess({ git: h.git, run: h.run, ...tools }, address, KEY)).toEqual({ ok: false, failure: 'timed-out' });
	});

	describe('a greeting that cannot be read', () => {
		it('still succeeds, with no username, so the author can type one', async () => {
			const h = harness({ greeting: result({ out: 'Hi there! You have connected.\n' }) });

			const outcome = await testAccess({ git: h.git, run: h.run, ...tools }, address, KEY);

			expect(outcome).toEqual({ ok: true, value: { defaultBranch: 'main', username: null } });
		});

		it('also succeeds when ssh cannot be run at all, and does not try', async () => {
			const h = harness({});

			const outcome = await testAccess({ git: h.git, run: h.run, ...tools, sshPath: null }, address, KEY);

			expect(outcome).toEqual({ ok: true, value: { defaultBranch: 'main', username: null } });
			expect(h.calls).toEqual(['probe', 'ls-remote']);
		});

		it('also succeeds when ssh fails to start', async () => {
			const h = harness({ greeting: result({ exitCode: null, spawnError: 'ENOENT' }) });

			const outcome = await testAccess({ git: h.git, run: h.run, ...tools }, address, KEY);

			expect(outcome.ok).toBe(true);
			expect(outcome.ok && outcome.value.username).toBeNull();
		});

		it('reads the greeting from stderr as well, where some builds write it', async () => {
			const h = harness({ greeting: result({ exitCode: 1, stderr: 'Welcome to GitLab, @ana_n-2!\n' }) });

			const outcome = await testAccess({ git: h.git, run: h.run, ...tools }, address, KEY);

			expect(outcome.ok && outcome.value.username).toBe('ana_n-2');
		});

		it('does not take a name that is not GitLab\'s alphabet, even from a greeting that looks right', async () => {
			const h = harness({ greeting: result({ out: 'Welcome to GitLab, @.ana!\n' }) });

			const outcome = await testAccess({ git: h.git, run: h.run, ...tools }, address, KEY);

			expect(outcome.ok && outcome.value.username).toBeNull();
		});

		it('does not take a username from text that merely resembles a greeting', async () => {
			const h = harness({ greeting: result({ out: 'Welcome to GitLab, @not a name!\n' }) });

			const outcome = await testAccess({ git: h.git, run: h.run, ...tools }, address, KEY);

			expect(outcome.ok && outcome.value.username).toBeNull();
		});
	});

	it('reports a missing ssh-keygen as ssh missing, and tries nothing else', async () => {
		const h = harness({});

		const outcome = await testAccess({ git: h.git, run: h.run, ...tools, sshKeygenPath: null }, address, KEY);

		expect(outcome).toEqual({ ok: false, failure: 'ssh-missing' });
		expect(h.calls).toEqual([]);
	});

	it('never returns the public key text the probe printed', async () => {
		const h = harness({});

		const outcome = await testAccess({ git: h.git, run: h.run, ...tools }, address, KEY);

		expect(JSON.stringify(outcome)).not.toMatch(/AAAA/);
	});
});
