// Plain specifiers; see the note in `git-runner.ts`.
import { constants, existsSync } from 'fs';
import { copyFile, lstat, mkdir, mkdtemp, readFile, rm, stat } from 'fs/promises';
import { homedir } from 'os';
import { join, posix, win32 } from 'path';
import { failureOf } from './failures';
import type { GitResult } from './failures';
import { buildGitEnv, runProcess } from './git-runner';
import type { ProcessRunner } from './git-runner';
import { absoluteDirs, findInDirs } from './locate-program';

/**
 * The author's SSH key, and the few things the plugin does with one
 * (replace-rest-with-local-git-ssh design.md D11).
 *
 * The rule this file is written around: the plugin never reads a private key.
 * It learns a key exists by `stat`, shows the public half by reading the `.pub`
 * file, and asks `ssh-keygen` — a separate program the author already trusts
 * with the key — the one question that needs the private half (whether it has
 * a password). The private bytes never enter this process.
 */

export type KeyKind = 'dedicated' | 'ed25519' | 'rsa';

export interface KeyFile {
	/** The private key's path. Handed to ssh as a path; never opened here. */
	path: string;
	publicPath: string;
	kind: KeyKind;
}

/** The key the plugin makes for itself. A name of its own so it can never be mistaken for, or overwrite, the author's. */
export const DEDICATED_KEY_NAME = 'docs-publisher_ed25519';

/** In the order the plugin prefers them: its own, then the modern default, then the old one. */
const CANDIDATES: ReadonlyArray<[KeyKind, string]> = [
	['dedicated', DEDICATED_KEY_NAME],
	['ed25519', 'id_ed25519'],
	['rsa', 'id_rsa'],
];

export function defaultSshDir(): string {
	return join(homedir(), '.ssh');
}

async function isFile(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isFile();
	} catch {
		return false;
	}
}

/**
 * Whether anything at all is at a path: a file, a folder, a link, even a link
 * to nothing. `stat` follows a link and reports a dangling one as absent, which
 * is exactly the case where writing "to the path" writes somewhere else.
 */
async function somethingAt(path: string): Promise<boolean> {
	try {
		await lstat(path);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code !== 'ENOENT';
	}
}

/** The keys that exist in a folder, preferred first. A missing folder is no keys, not an error. */
export async function findKeys(sshDir: string): Promise<KeyFile[]> {
	const found: KeyFile[] = [];
	for (const [kind, name] of CANDIDATES) {
		const path = join(sshDir, name);
		if (await isFile(path)) {
			found.push({ path, publicPath: `${path}.pub`, kind });
		}
	}
	return found;
}

/** Slow only on the author's first press; short because ssh-keygen without a password prompt finishes at once. */
const KEYGEN_TIMEOUT_MS = 20_000;

function toolEnv(): Record<string, string> {
	// English output, because the password probe below reads ssh-keygen's wording.
	return buildGitEnv(process.env, { sshCommand: null });
}

/**
 * Makes the plugin's own key. Refuses, writing nothing, if anything is already
 * at either name: `ssh-keygen -f` asks before overwriting, which in a process
 * with no terminal is a hang, and an answer would be a lost key. The refusal is
 * ours, made first.
 *
 * The pair is made in a folder of its own and then put in place with an
 * exclusive copy, which fails rather than replace what is there. Checking and
 * then writing leaves a gap in which a link or a file can appear at the name,
 * and `ssh-keygen` would write through it. The copy is made by the operating
 * system, so the private bytes still never enter this process.
 *
 * No password, because the process that will use the key cannot type one.
 * That is a recorded trade-off, bounded by the project's protected default
 * branch (design.md D11).
 */
export async function createDedicatedKey(
	sshDir: string,
	sshKeygen: string,
	run: ProcessRunner = runProcess
): Promise<GitResult<KeyFile>> {
	const path = join(sshDir, DEDICATED_KEY_NAME);
	const publicPath = `${path}.pub`;

	if ((await somethingAt(path)) || (await somethingAt(publicPath))) {
		console.error(`Docs Publisher: refused to overwrite what already exists at ${path}`);
		return { ok: false, failure: 'key-exists' };
	}

	let scratch: string;
	try {
		// Owner-only, as ssh itself requires of the folder holding a key.
		await mkdir(sshDir, { recursive: true, mode: 0o700 });
		scratch = await mkdtemp(join(sshDir, '.docs-publisher-'));
	} catch (error) {
		console.error(`Docs Publisher: could not prepare ${sshDir}`, error);
		return { ok: false, failure: 'unexpected' };
	}

	try {
		const scratchKey = join(scratch, 'key');
		const result = await run(
			sshKeygen,
			['-q', '-t', 'ed25519', '-N', '', '-C', 'docs-publisher', '-f', scratchKey],
			{ env: toolEnv(), timeoutMs: KEYGEN_TIMEOUT_MS }
		);
		if (result.exitCode !== 0) {
			return failureOf('ssh-keygen', result, 'ssh-keygen');
		}
		if (!(await isFile(scratchKey)) || !(await isFile(`${scratchKey}.pub`))) {
			console.error('Docs Publisher: ssh-keygen reported success but the key pair is incomplete');
			return { ok: false, failure: 'unexpected' };
		}
		try {
			// Private half first: a pair is only ever visible with both halves, so a
			// failure between the two removes the half that was placed.
			await copyFile(scratchKey, path, constants.COPYFILE_EXCL);
			try {
				await copyFile(`${scratchKey}.pub`, publicPath, constants.COPYFILE_EXCL);
			} catch (error) {
				await rm(path, { force: true });
				throw error;
			}
		} catch (error) {
			const raced = (error as NodeJS.ErrnoException).code === 'EEXIST';
			console.error(`Docs Publisher: could not put the new key at ${path}`, error);
			return { ok: false, failure: raced ? 'key-exists' : 'unexpected' };
		}
		return { ok: true, value: { path, publicPath, kind: 'dedicated' } };
	} finally {
		await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
	}
}

/**
 * The text an author copies into GitLab. Only the `.pub` file is read: a key
 * with no public file answers null rather than being opened to derive one.
 */
export async function readPublicKey(key: KeyFile): Promise<string | null> {
	let text: string;
	try {
		text = await readFile(key.publicPath, 'utf8');
	} catch {
		return null;
	}
	const line = text.trim().split('\n')[0].trim();
	return /^(ssh-|ecdsa-|sk-)/.test(line) ? line : null;
}

export type KeyProtection = 'open' | 'protected' | 'unreadable';

/**
 * Whether the key has a password, found by asking ssh-keygen to derive the
 * public key from it with an empty one. Under `BatchMode` ssh would report only
 * that the key was refused, which looks exactly like a key GitLab has not been
 * given — so a protected key has to be recognised before the network is
 * touched, and this is the one way to do it without reading the key here.
 *
 * `unreadable` is a third answer, not a flavour of the first two: a missing
 * file, or one with permissions ssh refuses, is not a key with a password.
 */
export async function probeKeyProtection(
	keyPath: string,
	sshKeygen: string,
	run: ProcessRunner = runProcess
): Promise<KeyProtection> {
	const result = await run(sshKeygen, ['-y', '-P', '', '-f', keyPath], {
		env: toolEnv(),
		timeoutMs: KEYGEN_TIMEOUT_MS,
	});
	if (result.exitCode === 0) {
		// The public key is on stdout. It is deliberately not returned: this
		// answers a question about the key and hands nothing on.
		return 'open';
	}
	if (/incorrect passphrase/i.test(result.stderr)) {
		return 'protected';
	}
	return 'unreadable';
}

export interface LocateDeps {
	pathEnv: string;
	platform: 'windows' | 'posix';
	exists(path: string): boolean;
	/** Where `git --exec-path` says git's helpers live, for the Git for Windows fallback; null when not known. */
	gitExecPath: string | null;
}

/**
 * Finds `ssh` or `ssh-keygen`. `PATH` first, because that is the copy the
 * author's own terminal would use; then, on Windows, the copy that ships inside
 * Git for Windows, which is on no `PATH` by default but is always beside git.
 *
 * Returns null rather than a bare name when nothing is found: a bare `ssh`
 * handed to a process that cannot find it fails in a way that reads as a
 * broken key, not a missing program.
 */
export function locateSshTool(name: 'ssh' | 'ssh-keygen', deps: LocateDeps): string | null {
	const windows = deps.platform === 'windows';
	const path = windows ? win32 : posix;
	const file = windows ? `${name}.exe` : name;

	// Absolute folders only: an empty or relative entry means "here" to some
	// shells, and here is wherever Obsidian happens to be running. A file in a
	// vault must not be able to stand in for ssh.
	const onPath = findInDirs(file, absoluteDirs(deps.pathEnv, deps.platform), deps.platform, deps.exists);
	if (onPath !== null) {
		return onPath;
	}

	if (windows && deps.gitExecPath !== null) {
		// `<root>\mingw64\libexec\git-core` is three levels below the install.
		const root = path.resolve(deps.gitExecPath, '..', '..', '..');
		const inside = ['usr\\bin', 'mingw64\\bin', 'bin'].map((sub) => path.join(root, sub));
		return findInDirs(file, inside, deps.platform, deps.exists);
	}
	return null;
}

/** `locateSshTool` against this machine. */
export function locateOnThisMachine(name: 'ssh' | 'ssh-keygen', gitExecPath: string | null): string | null {
	return locateSshTool(name, {
		pathEnv: process.env.PATH ?? process.env.Path ?? '',
		platform: process.platform === 'win32' ? 'windows' : 'posix',
		exists: (candidate) => existsSync(candidate),
		gitExecPath,
	});
}
