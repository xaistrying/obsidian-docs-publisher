import { stdoutText } from './git-runner';
import type { ProcessResult } from './git-runner';

/**
 * How a failed git or ssh call is described to its caller. It says which kind
 * of thing went wrong and nothing about what the author is told: the wording
 * belongs to each action that meets the failure, and the same kind reads
 * differently when a publish meets it than when a setup step does.
 *
 * Named apart from the REST client's `FailureKind`, which describes a
 * different set of failures and is deleted with that client
 * (replace-rest-with-local-git-ssh task 5.1).
 */
export type GitFailureKind =
	| 'git-missing'
	| 'identity-missing'
	| 'address-invalid'
	| 'ssh-missing'
	| 'key-rejected'
	| 'key-protected'
	| 'key-unreadable'
	| 'key-exists'
	| 'host-changed'
	| 'address-rewritten'
	| 'server-unreachable'
	| 'project-not-found'
	| 'empty-repository'
	| 'not-allowed'
	| 'changed-meanwhile'
	| 'timed-out'
	| 'unexpected';

export type GitResult<T> = { ok: true; value: T } | { ok: false; failure: GitFailureKind };

/** Which program failed to start, for a missing-program answer that names the right fix. */
export type FailedProgram = 'git' | 'ssh' | 'ssh-keygen';

/**
 * Phrases, in the order they are tried. The order is the logic: git ends a
 * refused key and an unreachable server with the same closing line
 * ("Could not read from remote repository"), and only the line above it tells
 * them apart, so the specific phrases come first and nothing matches on that
 * closing line alone.
 *
 * Matched against English text, which is why every process is started with its
 * language forced; matched case-insensitively because the wording of one
 * message differs in case between OpenSSH versions.
 */
const PHRASES: ReadonlyArray<[GitFailureKind, ReadonlyArray<RegExp>]> = [
	// Said by the runner itself, in git's shape, when a setting would send a
	// command somewhere other than the address it names.
	['address-rewritten', [/address rewritten by a git setting/]],
	// git could not start the ssh it was told to use: a missing program, not a
	// refused key.
	['ssh-missing', [/cannot run ssh/]],
	['host-changed', [/remote host identification has changed/, /host key verification failed/]],
	['key-rejected', [/permission denied \(publickey/]],
	[
		'server-unreachable',
		[
			/could not resolve hostname/,
			/connection timed out/,
			/operation timed out/,
			/connection refused/,
			/no route to host/,
			/network is unreachable/,
			/connection reset by peer/,
			/connection closed by remote host/,
			/kex_exchange_identification/,
		],
	],
	[
		'project-not-found',
		[/the project you were looking for could not be found/, /repository not found/],
	],
	[
		'changed-meanwhile',
		// `! [rejected]` (no "remote") is git's own refusal: the branch is not
		// what the caller expected. `! [remote rejected]` is the server's, below.
		[/stale info/, /\(fetch first\)/, /\(non-fast-forward\)/],
	],
	[
		'not-allowed',
		[/you are not allowed to/, /\[remote rejected\].*pre-receive hook declined/],
	],
	['identity-missing', [/author identity unknown/, /unable to auto-detect email address/, /please tell me who you are/]],
	['empty-repository', [/couldn't find remote ref head/, /remote head refers to nonexistent ref/]],
];

/** What the operating system says when a program cannot be started at all. */
const MISSING_PROGRAM_CODES: ReadonlyArray<string> = ['ENOENT', 'EACCES', 'ENOTDIR'];

/**
 * Reads a failed process into one kind. Pure, so the table of recorded
 * messages in the tests is the whole specification.
 */
export function classifyFailure(result: ProcessResult, program: FailedProgram = 'git'): GitFailureKind {
	if (result.spawnError !== null) {
		if (MISSING_PROGRAM_CODES.indexOf(result.spawnError) !== -1) {
			return program === 'git' ? 'git-missing' : 'ssh-missing';
		}
		return 'unexpected';
	}
	if (result.timedOut) {
		return 'timed-out';
	}
	if (result.truncated) {
		// Half a message is not a message to match against.
		return 'unexpected';
	}

	// Both streams: `ssh -T` answers on stdout where `git` answers on stderr.
	const text = `${result.stderr}\n${stdoutText(result)}`.toLowerCase();
	for (const [kind, patterns] of PHRASES) {
		if (patterns.some((pattern) => pattern.test(text))) {
			return kind;
		}
	}
	return 'unexpected';
}

/**
 * git's refusal to send push options to a server that does not advertise them.
 * Verified locally that nothing is pushed in that case, so the caller may send
 * the same commit again without them.
 */
export function isPushOptionsUnsupported(result: ProcessResult): boolean {
	return /the receiving end does not support push options/i.test(result.stderr);
}

/** Enough of a failure to diagnose it, not enough to flood the console. */
const LOG_CAP_CHARS = 600;

/**
 * Turns a failed process into a typed failure and writes what it said to the
 * console, once, for whoever supports the plugin. The raw text goes there and
 * only there: it is never returned, so no caller can pass it on to an author
 * by accident (spec: git-publishing, "Failures are classified, not passed
 * through raw").
 */
export function failureOf(
	context: string,
	result: ProcessResult,
	program: FailedProgram = 'git'
): { ok: false; failure: GitFailureKind } {
	const failure = classifyFailure(result, program);
	const said = `${result.stderr}\n${stdoutText(result)}`.trim();
	console.error(
		`Docs Publisher: ${context} failed (${failure}, exit ${result.exitCode === null ? 'none' : result.exitCode}): ${said.slice(0, LOG_CAP_CHARS)}`
	);
	return { ok: false, failure };
}
