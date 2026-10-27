import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGitRunner } from '../../src/git-publishing/git-runner';
import type { GitRunner } from '../../src/git-publishing/git-runner';
import { parseProjectAddress } from '../../src/git-publishing/project-address';
import type { ProjectAddress } from '../../src/git-publishing/project-address';
import { sshCommand } from '../../src/git-publishing/ssh-command';

/**
 * A project to talk to, on this machine.
 *
 * The runner allows only the ssh protocol, so a bare repository in a temp folder
 * cannot be named by path. Instead a stand-in `ssh` is put first on the search
 * path: it receives what git sends a server (`git-upload-pack '<path>'`) and runs
 * that against the bare repository. Everything the plugin does then goes through
 * the same runner, the same environment and the same ssh command as it would
 * against GitLab, except the last hop.
 */
export interface LocalRemote {
	/** The project's address as an author would have entered it. */
	address: ProjectAddress;
	/** The bare repository standing in for the server. */
	bare: string;
	/** A runner that reaches `bare` through the stand-in ssh. */
	runner(hooksDir?: string): GitRunner;
	/** Runs plain git, outside the plugin, for setting up or inspecting. */
	git(cwd: string, ...args: string[]): string;
	/** Adds a commit to a branch of the bare repository, from a scratch clone. */
	publish(branch: string, files: Record<string, string | Buffer>, message?: string): string;
	/** Removes a branch from the bare repository. */
	deleteBranch(branch: string): void;
	/** Installs a server-side hook in the bare repository; its output reaches the pusher as `remote:` lines. */
	setHook(name: string, body: string): void;
	/** The commit a branch of the bare repository holds, or null. */
	tip(branch: string): string | null;
	/** The folder everything lives in. */
	root: string;
	dispose(): void;
}

const IDENTITY = ['-c', 'user.name=Remote Person', '-c', 'user.email=remote@example.com'];

/** The arguments the stand-in ssh was last started with, one per line, for tests that assert on the command line. */
export const SSH_LOG = 'ssh-arguments';

export function createLocalRemote(
	options: { empty?: boolean; defaultBranch?: string; sha256?: boolean; advertisePushOptions?: boolean } = {}
): LocalRemote {
	const format = options.sha256 === true ? ['--object-format=sha256'] : [];
	const root = mkdtempSync(join(tmpdir(), 'local-remote-'));
	const defaultBranch = options.defaultBranch ?? 'main';
	const bare = join(root, 'project.git');
	const bin = join(root, 'bin');
	const home = join(root, 'home');
	mkdirSync(bin);
	mkdirSync(home);

	const git = (cwd: string, ...args: string[]): string =>
		execFileSync('git', [...IDENTITY, ...args], {
			cwd,
			encoding: 'utf8',
			env: { PATH: process.env.PATH ?? '', HOME: home, GIT_CONFIG_NOSYSTEM: '1' },
		});

	execFileSync('git', ['init', '-q', '--bare', ...format, bare]);
	git(bare, 'symbolic-ref', 'HEAD', `refs/heads/${defaultBranch}`);

	const script = [
		'#!/bin/sh',
		`printf '%s\\n' "$@" > '${join(root, SSH_LOG)}'`,
		'cmd=""',
		'for a in "$@"; do cmd="$a"; done',
		'case "$cmd" in',
		`  git-upload-pack*) exec git upload-pack '${bare}' ;;`,
		`  git-receive-pack*) exec git -c receive.advertisePushOptions=${options.advertisePushOptions === false ? 'false' : 'true'} receive-pack '${bare}' ;;`,
		'  *) echo "unsupported: $cmd" >&2; exit 1 ;;',
		'esac',
		'',
	].join('\n');
	writeFileSync(join(bin, 'ssh'), script);
	chmodSync(join(bin, 'ssh'), 0o755);

	const address = parseProjectAddress('git@gitlab.example.com:docs/kb.git') as ProjectAddress;

	const remote: LocalRemote = {
		address,
		bare,
		root,
		git,
		runner: (hooksDir = join(root, 'no-hooks')) =>
			createGitRunner({
				sshCommand: sshCommand({ keyPath: join(root, 'key') }),
				hooksDir,
				baseEnv: { PATH: `${bin}:${process.env.PATH ?? ''}`, HOME: home },
			}),
		publish: (branch, files, message = 'a change') => {
			const clone = mkdtempSync(join(root, 'clone-'));
			git(clone, 'init', '-q', ...format);
			git(clone, 'remote', 'add', 'origin', bare);
			try {
				git(clone, 'fetch', '-q', 'origin', `+refs/heads/${branch}:refs/heads/${branch}`);
				git(clone, 'checkout', '-q', branch);
			} catch {
				// A branch that is not there yet starts from the default branch, if there is one.
				try {
					git(clone, 'fetch', '-q', 'origin', `+refs/heads/${defaultBranch}:refs/heads/${defaultBranch}`);
					git(clone, 'checkout', '-q', '-b', branch, defaultBranch);
				} catch {
					git(clone, 'checkout', '-q', '-b', branch);
				}
			}
			for (const path of Object.keys(files)) {
				const full = join(clone, path);
				mkdirSync(join(full, '..'), { recursive: true });
				writeFileSync(full, files[path]);
			}
			git(clone, 'add', '-A');
			git(clone, 'commit', '-q', '-m', message);
			git(clone, 'push', '-q', 'origin', `${branch}:${branch}`);
			const sha = git(clone, 'rev-parse', 'HEAD').trim();
			rmSync(clone, { recursive: true, force: true });
			return sha;
		},
		deleteBranch: (branch) => {
			git(bare, 'update-ref', '-d', `refs/heads/${branch}`);
		},
		setHook: (name, body) => {
			mkdirSync(join(bare, 'hooks'), { recursive: true });
			writeFileSync(join(bare, 'hooks', name), `#!/bin/sh\n${body}\n`);
			chmodSync(join(bare, 'hooks', name), 0o755);
		},
		tip: (branch) => {
			try {
				return git(bare, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`).trim();
			} catch {
				return null;
			}
		},
		dispose: () => {
			rmSync(root, { recursive: true, force: true });
		},
	};

	if (options.empty !== true) {
		remote.publish(defaultBranch, { 'README.md': 'Project\n' }, 'first');
	}
	return remote;
}
