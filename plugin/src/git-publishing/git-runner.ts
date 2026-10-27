// Plain specifiers, not `node:child_process`: this project's esbuild (0.13)
// only treats the names in `builtin-modules` as external, and fails to bundle a
// `node:`-prefixed one (checked against the real build, not assumed).
import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import { readdir } from 'fs/promises';
import { win32 } from 'path';
import {
	GIT_SUBCOMMAND_ALLOWLIST,
	NETWORK_SUBCOMMANDS,
	REWRITE_QUERY,
	addressRewrittenBy,
	commandRefusal,
	networkRefusal,
} from './git-command-rules';
import { absoluteDirs, envValue, locateGit, thisPlatform } from './locate-program';
import type { ProgramPlatform } from './locate-program';

export { GIT_SUBCOMMAND_ALLOWLIST };

/**
 * Everything the plugin knows about a finished process. A program that cannot
 * be started, one that was killed, and one that ran and failed are three
 * different things and a caller needs to tell them apart — "git is not
 * installed" and "the server said no" lead the author to opposite fixes — so
 * none of them is thrown and none is collapsed into an exit code.
 */
export interface ProcessResult {
	/** Null when the process was killed (timeout, output cap) or never started. */
	exitCode: number | null;
	/** Bytes, not text: `cat-file` returns images. See `stdoutText`. */
	stdout: Buffer;
	stderr: string;
	timedOut: boolean;
	/** Output went past the cap; `stdout` holds what fitted. A caller treats this as a failure. */
	truncated: boolean;
	/** The OS error code when the program could not be started (`ENOENT`, `EACCES`), else null. */
	spawnError: string | null;
}

export interface ProcessOptions {
	cwd?: string;
	/** The whole environment. Nothing is inherited: see `buildGitEnv`. */
	env: Record<string, string>;
	timeoutMs: number;
	maxOutputBytes?: number;
	stdin?: string | Buffer;
}

export type ProcessRunner = (file: string, args: string[], options: ProcessOptions) => Promise<ProcessResult>;

export function stdoutText(result: ProcessResult): string {
	return result.stdout.toString('utf8');
}

const DEFAULT_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const STDERR_CAP_BYTES = 256 * 1024;
/**
 * After a kill the process normally closes its pipes within milliseconds. If it
 * does not, something else still holds them, and waiting for it would hold the
 * caller — and through the busy slot every control in the panel — with it.
 */
const KILL_GRACE_MS = 2000;

/**
 * The command that ends a process tree on Windows, by the path it always has:
 * the bare name would be searched for in the working folder first, which is the
 * vault, and what it finds there it runs.
 */
export function windowsKillCommand(
	pid: number,
	env: Record<string, string | undefined>
): { file: string; args: string[] } {
	const root = envValue(env, 'SystemRoot') ?? envValue(env, 'windir') ?? 'C:\\Windows';
	return { file: win32.join(root, 'System32', 'taskkill.exe'), args: ['/pid', String(pid), '/T', '/F'] };
}

/**
 * Kills a process and everything it started. Git starts ssh, and ssh keeps the
 * output pipes open: killing only git leaves the caller waiting for a close
 * that never comes (replace-rest-with-local-git-ssh design.md D11). On POSIX the
 * child leads its own process group, so one signal to the group reaches the
 * lot; Windows has no groups to signal, so `taskkill /T` walks the tree.
 *
 * The group is signalled even when its leader has already exited, because the
 * leader going first while ssh lingers is the case this exists for. The usual
 * worry about signalling a number that was reused does not apply to a group
 * that still has members, and one with none answers "no such process".
 */
function killTree(child: ChildProcess, posix: boolean): void {
	const pid = child.pid;
	if (pid === undefined) {
		return;
	}
	if (posix) {
		try {
			process.kill(-pid, 'SIGKILL');
		} catch {
			// The group is already gone, or the process never became a leader.
			try {
				child.kill('SIGKILL');
			} catch {
				// Already exited; nothing left to kill.
			}
		}
		return;
	}
	const command = windowsKillCommand(pid, process.env);
	const killer = spawn(command.file, command.args, { windowsHide: true, stdio: 'ignore' });
	killer.on('error', () => {
		child.kill();
	});
}

/**
 * Every process started and not yet finished, so that closing the plugin does
 * not leave an ssh behind it holding a connection open.
 */
const liveChildren = new Set<ChildProcess>();

/** For the plugin's `onunload`: ends whatever is still running, with its children. */
export function stopAllProcesses(): void {
	const posix = process.platform !== 'win32';
	for (const child of Array.from(liveChildren)) {
		killTree(child, posix);
	}
}

function failedToStart(code: string): ProcessResult {
	return {
		exitCode: null,
		stdout: Buffer.alloc(0),
		stderr: '',
		timedOut: false,
		truncated: false,
		spawnError: code,
	};
}

/**
 * Starts a program with no shell, a given environment, a deadline and an output
 * cap, and always resolves. The shell is the whole reason `execFile` semantics
 * are used rather than `exec`: nothing a note's file name contains can mean
 * anything but itself.
 */
export const runProcess: ProcessRunner = (file, args, options) =>
	new Promise<ProcessResult>((resolve) => {
		const posix = process.platform !== 'win32';
		const maxOutput = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		let stdoutBytes = 0;
		let stderrBytes = 0;
		let timedOut = false;
		let truncated = false;
		let settled = false;
		let killTimer: ReturnType<typeof setTimeout> | null = null;

		let child: ChildProcess;
		try {
			child = spawn(file, args, {
				cwd: options.cwd,
				env: options.env,
				shell: false,
				windowsHide: true,
				// A group leader on POSIX so `killTree` can signal the group. Not on
				// Windows, where it would give the process its own console window.
				detached: posix,
				stdio: [options.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
			});
		} catch (error) {
			// `spawn` throws for an argument it cannot pass at all, such as one with
			// a NUL in it. That is a refusal to start, not a crash.
			const code = (error as NodeJS.ErrnoException).code;
			resolve(failedToStart(typeof code === 'string' ? code : 'EINVAL'));
			return;
		}
		liveChildren.add(child);

		const finish = (exitCode: number | null, spawnError: string | null): void => {
			if (settled) {
				return;
			}
			settled = true;
			liveChildren.delete(child);
			clearTimeout(deadline);
			if (killTimer !== null) {
				clearTimeout(killTimer);
			}
			resolve({
				exitCode,
				stdout: Buffer.concat(stdoutChunks),
				stderr: Buffer.concat(stderrChunks).toString('utf8'),
				timedOut,
				truncated,
				spawnError,
			});
		};

		const stop = (): void => {
			killTree(child, posix);
			killTimer = setTimeout(() => {
				child.stdout?.destroy();
				child.stderr?.destroy();
				finish(null, null);
			}, KILL_GRACE_MS);
		};

		const deadline = setTimeout(() => {
			timedOut = true;
			stop();
		}, options.timeoutMs);

		child.stdout?.on('data', (chunk: Buffer) => {
			if (truncated) {
				return;
			}
			if (stdoutBytes + chunk.length > maxOutput) {
				stdoutChunks.push(chunk.subarray(0, maxOutput - stdoutBytes));
				stdoutBytes = maxOutput;
				truncated = true;
				stop();
				return;
			}
			stdoutChunks.push(chunk);
			stdoutBytes += chunk.length;
		});
		child.stderr?.on('data', (chunk: Buffer) => {
			if (stderrBytes >= STDERR_CAP_BYTES) {
				return;
			}
			stderrChunks.push(chunk.subarray(0, STDERR_CAP_BYTES - stderrBytes));
			stderrBytes += chunk.length;
		});

		if (options.stdin !== undefined) {
			// A program that exits before reading its input closes the pipe; that
			// is its answer, not a failure of ours.
			child.stdin?.on('error', () => undefined);
			child.stdin?.end(options.stdin);
		}

		child.on('error', (error: NodeJS.ErrnoException) => {
			// `error` also fires when a kill fails; only a process that never got a
			// pid failed to start.
			if (child.pid === undefined) {
				finish(null, typeof error.code === 'string' ? error.code : 'ERROR');
			}
		});
		child.on('close', (code) => {
			finish(code, null);
		});
	});

/** Names a caller may set. The index so plumbing never touches the real one; the identity so no commit depends on repository settings. */
const ALLOWED_EXTRA_ENV = [
	'GIT_INDEX_FILE',
	'GIT_AUTHOR_NAME',
	'GIT_AUTHOR_EMAIL',
	'GIT_AUTHOR_DATE',
	'GIT_COMMITTER_NAME',
	'GIT_COMMITTER_EMAIL',
	'GIT_COMMITTER_DATE',
] as const;
export type AllowedGitEnvName = (typeof ALLOWED_EXTRA_ENV)[number];

/**
 * What a git process may inherit from Obsidian. Enough for git and ssh to find
 * their programs, a home folder and a temp folder on every platform; nothing
 * else, so a token the parent happens to hold can never reach a child, and
 * neither can a stray `GIT_*` override. No agent socket either: the key is the
 * file the author chose, and an agent that happens to be running must not be
 * able to answer for a different one.
 * Matched case-insensitively because Windows names are.
 */
const INHERITED_ENV = [
	'path',
	'pathext',
	'home',
	'userprofile',
	'homedrive',
	'homepath',
	'systemroot',
	'systemdrive',
	'windir',
	'comspec',
	'temp',
	'tmp',
	'tmpdir',
	'appdata',
	'localappdata',
	'programdata',
	'programfiles',
	'programfiles(x86)',
	'username',
	'user',
	'logname',
	'xdg_config_home',
];

export interface GitEnvOptions {
	/** The `GIT_SSH_COMMAND` to use, or null for an operation that never reaches a server. */
	sshCommand: string | null;
	extra?: Partial<Record<AllowedGitEnvName, string>>;
	/** Whose search-path rules apply to `PATH`: this process's own unless a test says otherwise. */
	platform?: ProgramPlatform;
}

export function buildGitEnv(
	base: Record<string, string | undefined>,
	options: GitEnvOptions
): Record<string, string> {
	const platform = options.platform ?? thisPlatform();
	const env: Record<string, string> = {};
	for (const name of Object.keys(base)) {
		const value = base[name];
		if (value === undefined || INHERITED_ENV.indexOf(name.toLowerCase()) === -1) {
			continue;
		}
		if (name.toLowerCase() === 'path') {
			// Only the folders that name one place. A path that ends up empty is
			// left out altogether: an empty one means "search here" to a POSIX
			// exec, and here is the vault.
			const dirs = absoluteDirs(value, platform);
			if (dirs.length > 0) {
				env[name] = dirs.join(platform === 'windows' ? ';' : ':');
			}
			continue;
		}
		env[name] = value;
	}

	// English, because failures are classified by their wording; no prompting,
	// because there is no terminal to answer on; ssh only, so an address of the
	// form `ext::<command>` cannot start a program.
	env.LC_ALL = 'C';
	env.LANG = 'C';
	env.GIT_TERMINAL_PROMPT = '0';
	env.GIT_ALLOW_PROTOCOL = 'ssh';
	if (options.sshCommand !== null) {
		env.GIT_SSH_COMMAND = options.sshCommand;
	}

	const extra = options.extra ?? {};
	for (const name of Object.keys(extra)) {
		if ((ALLOWED_EXTRA_ENV as ReadonlyArray<string>).indexOf(name) === -1) {
			throw new Error(`Docs Publisher: setting ${name} on a git process is not allowed`);
		}
		const value = (extra as Record<string, string | undefined>)[name];
		if (value !== undefined) {
			env[name] = value;
		}
	}
	return env;
}

/**
 * Where git is told to look for hooks on POSIX: a path that is not a folder, so
 * there is nothing to find and nothing anyone could put there. Hooks are
 * programs, and a repository that lives in a vault is a place files arrive in
 * from elsewhere.
 */
const NO_HOOKS_POSIX = '/dev/null';

/**
 * Settings forced onto every command, in front of the subcommand, so what
 * the plugin parses cannot be changed by the author's own configuration:
 * no colour codes, no quoted paths (non-ASCII file names), long Windows paths,
 * no filesystem monitor, no hooks, and no background gc.
 */
function forcedConfig(hooksPath: string): string[] {
	const settings = [
		'color.ui=false',
		'core.quotepath=false',
		'core.longpaths=true',
		'core.fsmonitor=false',
		`core.hooksPath=${hooksPath}`,
		'gc.auto=0',
		'maintenance.auto=false',
	];
	const args: string[] = [];
	for (const setting of settings) {
		args.push('-c', setting);
	}
	return args;
}

/** Thrown for a request the runner will not make: a bug in the caller, never a condition to handle. */
export class GitCommandRefused extends Error {
	constructor(reason: string) {
		super(`Docs Publisher: ${reason}`);
		this.name = 'GitCommandRefused';
	}
}

export interface GitRequest {
	/** The subcommand first, then its arguments, with `--` before any path. */
	args: string[];
	/** The vault's folder; any folder for a command that needs no repository. */
	cwd: string;
	/**
	 * The address a command that reaches a server reaches, which must also be
	 * one of `args`. The runner checks that no git setting rewrites it to
	 * somewhere else before it runs the command.
	 */
	remote?: string;
	timeoutMs?: number;
	maxOutputBytes?: number;
	stdin?: string | Buffer;
	extraEnv?: Partial<Record<AllowedGitEnvName, string>>;
}

export interface GitRunner {
	run(request: GitRequest): Promise<ProcessResult>;
}

export interface GitRunnerConfig {
	/** git's full path. Found on the search path, or in an install folder, when not given. */
	gitPath?: string;
	/** The `GIT_SSH_COMMAND` for operations that reach a server; null when no key is chosen yet. */
	sshCommand: string | null;
	/**
	 * A folder that must stay empty and outside the vault, which Windows uses to
	 * say "no hooks" because it has no path that means nothing. Left alone on
	 * POSIX, where hooks are pointed at `/dev/null`. Never created: the runner
	 * refuses to run if anything has been put in it.
	 */
	hooksDir: string;
	/** For tests: what to start processes with. */
	process?: ProcessRunner;
	/** For tests: the parent environment to inherit from. */
	baseEnv?: Record<string, string | undefined>;
	/** For tests: which platform's rules apply. */
	platform?: ProgramPlatform;
	/** For tests: whether a file exists, for finding git. */
	exists?: (path: string) => boolean;
	/** For tests: what a folder holds. */
	listFolder?: (dir: string) => Promise<string[]>;
}

const LOCAL_TIMEOUT_MS = 20_000;
/** Longer than ssh's own 15 s connect bound, to leave room for a transfer. */
const NETWORK_TIMEOUT_MS = 90_000;

/**
 * What a network command is answered with when a git setting would send it
 * somewhere other than the address it names. Shaped like git's own refusal so
 * it goes through the same classification as every other failure.
 */
export const ADDRESS_REWRITTEN_TEXT = 'fatal: address rewritten by a git setting';

function addressRewritten(): ProcessResult {
	return {
		exitCode: 128,
		stdout: Buffer.alloc(0),
		stderr: ADDRESS_REWRITTEN_TEXT,
		timedOut: false,
		truncated: false,
		spawnError: null,
	};
}

/**
 * Where git keeps its helper programs, which on Windows says where Git for
 * Windows is installed and so where its own `ssh` is. `--exec-path` is an
 * option and not a subcommand, so it is not something `run` accepts — and
 * nothing else with a leading dash should become acceptable by way of this
 * one. Null when git cannot be run.
 */
export async function readGitExecPath(
	config: Pick<GitRunnerConfig, 'gitPath' | 'process' | 'baseEnv' | 'platform' | 'exists'> = {}
): Promise<string | null> {
	const processRunner = config.process ?? runProcess;
	const base = config.baseEnv ?? process.env;
	const platform = config.platform ?? thisPlatform();
	const git = config.gitPath ?? locateGit(base, platform, config.exists ?? existsSync);
	if (git === null) {
		return null;
	}
	const result = await processRunner(git, ['--exec-path'], {
		env: buildGitEnv(base, { sshCommand: null, platform }),
		timeoutMs: LOCAL_TIMEOUT_MS,
	});
	if (result.spawnError !== null || result.exitCode !== 0) {
		return null;
	}
	const path = stdoutText(result).trim();
	return path === '' ? null : path;
}

export function createGitRunner(config: GitRunnerConfig): GitRunner {
	const processRunner = config.process ?? runProcess;
	const platform = config.platform ?? thisPlatform();
	const hooksPath = platform === 'posix' ? NO_HOOKS_POSIX : config.hooksDir;
	let located: string | null = null;

	/** Looked for until it is found, then remembered: an author may install git while the plugin is running. */
	const gitProgram = (): string | null => {
		if (config.gitPath !== undefined) {
			return config.gitPath;
		}
		if (located === null) {
			located = locateGit(config.baseEnv ?? process.env, platform, config.exists ?? existsSync);
		}
		return located;
	};

	/** Fails closed: a folder that cannot be read is not known to be empty. */
	const hooksFolderIsEmpty = async (): Promise<boolean> => {
		try {
			const entries = await (config.listFolder ?? ((dir: string) => readdir(dir)))(config.hooksDir);
			return entries.length === 0;
		} catch (error) {
			return (error as NodeJS.ErrnoException).code === 'ENOENT';
		}
	};

	/**
	 * Null when no setting rewrites the address; otherwise the result to answer
	 * with, which is either the refusal or the failure of the check itself.
	 */
	const checkAddress = async (
		program: string,
		env: Record<string, string>,
		request: GitRequest,
		remote: string
	): Promise<ProcessResult | null> => {
		const result = await processRunner(program, [...forcedConfig(hooksPath), ...REWRITE_QUERY], {
			cwd: request.cwd,
			env,
			timeoutMs: LOCAL_TIMEOUT_MS,
		});
		const noneSet = result.exitCode === 1 && result.spawnError === null && !result.timedOut;
		if (noneSet) {
			return null;
		}
		if (result.exitCode === 0 && !result.truncated) {
			return addressRewrittenBy(stdoutText(result), remote) ? addressRewritten() : null;
		}
		return result;
	};

	return {
		async run(request: GitRequest): Promise<ProcessResult> {
			const reason = commandRefusal(request.args, request.extraEnv ?? {});
			if (reason !== null) {
				throw new GitCommandRefused(reason);
			}
			const network = NETWORK_SUBCOMMANDS.has(request.args[0]);
			if (network) {
				const why = networkRefusal(request.args, request.remote, config.sshCommand !== null);
				if (why !== null) {
					throw new GitCommandRefused(why);
				}
			}

			const program = gitProgram();
			if (program === null) {
				return failedToStart('ENOENT');
			}
			if (platform === 'windows' && !(await hooksFolderIsEmpty())) {
				throw new GitCommandRefused(
					`a hooks folder with something in it is not allowed (${config.hooksDir}); it must stay empty`
				);
			}

			const env = buildGitEnv(config.baseEnv ?? process.env, {
				sshCommand: config.sshCommand,
				extra: request.extraEnv,
				platform,
			});
			if (network && request.remote !== undefined) {
				const stopped = await checkAddress(program, env, request, request.remote);
				if (stopped !== null) {
					return stopped;
				}
			}
			return processRunner(program, [...forcedConfig(hooksPath), ...request.args], {
				cwd: request.cwd,
				env,
				timeoutMs: request.timeoutMs ?? (network ? NETWORK_TIMEOUT_MS : LOCAL_TIMEOUT_MS),
				maxOutputBytes: request.maxOutputBytes,
				stdin: request.stdin,
			});
		},
	};
}
