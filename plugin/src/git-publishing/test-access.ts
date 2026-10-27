import { failureOf } from './failures';
import type { GitResult } from './failures';
import { buildGitEnv, runProcess, stdoutText } from './git-runner';
import type { GitRunner, ProcessRunner } from './git-runner';
import { probeKeyProtection } from './keys';
import { GITLAB_USERNAME } from './project-address';
import type { ProjectAddress } from './project-address';
import { sshArguments } from './ssh-command';

export interface AccessResult {
	/** Read from the server, never assumed: the target's own project may be on `master`. */
	defaultBranch: string;
	/** From the server's greeting; null when it could not be read and the author is asked to type it. */
	username: string | null;
}

export interface TestAccessDeps {
	/** Already configured with the key's ssh command. */
	git: GitRunner;
	run?: ProcessRunner;
	sshPath: string | null;
	sshKeygenPath: string | null;
	/** The vault folder; `ls-remote` needs no repository, only somewhere to stand. */
	cwd: string;
}

/**
 * GitLab's own greeting. The username alphabet is GitLab's: a greeting that
 * puts anything else after the `@` is something else saying something similar,
 * and the answer then is "unknown", not a guess.
 */
const GREETING = /Welcome to GitLab, @([A-Za-z0-9_.-]+)!/;

const GREETING_TIMEOUT_MS = 30_000;

/**
 * A branch name git itself would accept and that is safe in an address or a
 * refspec: the ordinary characters of a name, no leading dash or slash, no
 * `..`, no component that starts with a dot or ends in `.lock`. Narrower than
 * git on purpose — a project whose default branch needs more than this is told
 * it is unusable, which is better than a name that changes what a command means.
 */
export function isUsableBranchName(name: string): boolean {
	return (
		/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(name) &&
		name.indexOf('..') === -1 &&
		name.indexOf('//') === -1 &&
		!/(^|\/)\./.test(name) &&
		!/\.lock(\/|$)/.test(name) &&
		!/[./]$/.test(name)
	);
}

/**
 * "Test": does this key reach this project, and whose key is it
 * (replace-rest-with-local-git-ssh design.md D11).
 *
 * In this order, and each step is only worth taking if the one before passed:
 * the key is probed for a password first because ssh would report a protected
 * key only as refused, which reads as "not registered" and sends the author to
 * GitLab to fix something that is not wrong; then `ls-remote` proves the key
 * and the project together and reads the default branch; and only then is ssh
 * asked for the greeting, which answers a different question and whose failure
 * must not fail the test (the author can type a username, they cannot work
 * around a rejected key).
 */
export async function testAccess(
	deps: TestAccessDeps,
	address: ProjectAddress,
	keyPath: string
): Promise<GitResult<AccessResult>> {
	const run = deps.run ?? runProcess;

	if (deps.sshKeygenPath === null) {
		return { ok: false, failure: 'ssh-missing' };
	}

	const protection = await probeKeyProtection(keyPath, deps.sshKeygenPath, run);
	if (protection === 'protected') {
		return { ok: false, failure: 'key-protected' };
	}
	if (protection === 'unreadable') {
		console.error(`Docs Publisher: the key at ${keyPath} could not be read by ssh-keygen`);
		return { ok: false, failure: 'key-unreadable' };
	}

	const listing = await deps.git.run({
		args: ['ls-remote', '--symref', address.sshUrl, 'HEAD'],
		cwd: deps.cwd,
		remote: address.sshUrl,
	});
	if (listing.exitCode !== 0) {
		return failureOf('ls-remote', listing);
	}
	const branch = parseDefaultBranch(stdoutText(listing));
	if (!branch.ok) {
		return branch;
	}

	const username = deps.sshPath === null ? null : await readUsername(deps.sshPath, run, address, keyPath);
	return { ok: true, value: { defaultBranch: branch.value, username } };
}

/**
 * The default branch from `ls-remote --symref <address> HEAD`. Nothing at all
 * is how git reports a project with no commits: success with nothing to say,
 * which is not an error and not a project to publish to. A name the server
 * gives that is not an ordinary branch name is refused, not repaired.
 */
export function parseDefaultBranch(output: string): GitResult<string> {
	const answer = output.trim();
	if (answer === '') {
		return { ok: false, failure: 'empty-repository' };
	}
	const symref = /^ref: refs\/heads\/(\S+)\tHEAD$/m.exec(answer);
	if (symref === null || !isUsableBranchName(symref[1])) {
		// The name comes from the server and is later put in an address and a
		// refspec, so it is checked rather than trusted.
		console.error(`Docs Publisher: ls-remote named no usable default branch: ${answer.slice(0, 300)}`);
		return { ok: false, failure: 'unexpected' };
	}
	return { ok: true, value: symref[1] };
}

async function readUsername(
	sshPath: string,
	run: ProcessRunner,
	address: ProjectAddress,
	keyPath: string
): Promise<string | null> {
	const args = [...sshArguments(keyPath)];
	if (address.port !== null) {
		args.push('-p', String(address.port));
	}
	args.push('-T', `git@${address.host}`);

	const result = await run(sshPath, args, {
		env: buildGitEnv(process.env, { sshCommand: null }),
		timeoutMs: GREETING_TIMEOUT_MS,
	});
	if (result.spawnError !== null || result.timedOut) {
		console.error(`Docs Publisher: could not ask ssh for the greeting (${result.spawnError ?? 'timed out'})`);
		return null;
	}
	// Either stream, and whatever the exit code: GitLab greets with status 0,
	// other hosts with 1, and some builds write the line to stderr.
	const match = GREETING.exec(`${stdoutText(result)}\n${result.stderr}`);
	// The same check a typed name gets: what the server says becomes the owner
	// written into documents.
	return match === null || !GITLAB_USERNAME.test(match[1]) ? null : match[1];
}
