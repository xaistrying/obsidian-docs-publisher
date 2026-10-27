// Plain specifiers; see the note in `git-runner.ts`.
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { failureOf } from './failures';
import type { GitResult } from './failures';
import { stdoutText } from './git-runner';
import type { ProcessResult } from './git-runner';
import { isReservedPath } from './ref-names';
import type { RepoContext } from './repo';

/**
 * Builds a commit from files without touching the vault
 * (replace-rest-with-local-git-ssh design.md D5 step 4, task 3.1).
 *
 * The tree is built in a throwaway index file that starts from the parent's
 * tree and adds or replaces the files given, so the vault's working tree, its
 * real index and its HEAD are never read or written. Nothing is deleted except
 * the notes named in `removals`, which is how a moved document leaves its old
 * path (panel-by-path-without-doc-id design.md D4). Each file's bytes are hashed exactly as they are, with every
 * filter off: a clean filter named by the repository's attributes would
 * otherwise rewrite what is stored, and `core.autocrlf` would turn the line
 * endings of a note, so the blob on the project would no longer be the file in
 * the vault.
 *
 * (Experiment E1 recorded why this is not done with the working tree: switching
 * to a branch and back reverts the note being sent to whatever that branch
 * holds, which is the author's own text. A plumbing commit has no such step.)
 *
 * Author and committer come from the identity given, passed in the
 * environment, so the commit does not depend on the repository's own settings,
 * which an author who has never set a name has not got.
 */
export interface CommitFile {
	/** Repository path, forward slashes, relative to the project's root. */
	path: string;
	bytes: Uint8Array;
}

export interface CommitIdentity {
	name: string;
	email: string;
}

export interface BuiltCommit {
	commit: string;
	tree: string;
	/** The blob identifier of each file as committed, by path. */
	blobs: ReadonlyMap<string, string>;
}

const FULL_COMMIT = /^[0-9a-f]{40}$/;

/**
 * Whether a path may be put in a commit: relative, forward slashes, no
 * `.`/`..` part, no control character, and not under the folders the plugin
 * never reads. A path from a note or a received file is data, and this is what
 * stops it reaching an argument as anything but a name.
 */
export function isCommittablePath(path: string): boolean {
	if (path === '' || path.length > 4096 || path[0] === '/' || path.indexOf('\\') !== -1) {
		return false;
	}
	// eslint-disable-next-line no-control-regex
	if (/[\u0000-\u001f\u007f]/.test(path) || isReservedPath(path)) {
		return false;
	}
	return path.split('/').every((part) => part !== '' && part !== '.' && part !== '..' && part !== '.git');
}

function succeeded(result: ProcessResult): boolean {
	return result.spawnError === null && !result.timedOut && !result.truncated && result.exitCode === 0;
}

export async function buildCommit(
	ctx: RepoContext,
	parent: string,
	files: readonly CommitFile[],
	identity: CommitIdentity,
	message: string,
	removals: readonly string[] = []
): Promise<GitResult<BuiltCommit>> {
	if (!FULL_COMMIT.test(parent)) {
		throw new Error('Docs Publisher: a commit is built on a full commit identifier');
	}
	for (const file of files) {
		if (!isCommittablePath(file.path)) {
			throw new Error(`Docs Publisher: "${file.path}" is not a path that can be committed`);
		}
	}
	for (const path of removals) {
		// The one removal Submit makes is a document's own old path when the
		// document moves, so only a note can be removed, and never a file the same
		// commit adds. An image shared with another document is never removed.
		if (!isCommittablePath(path) || !/\.md$/i.test(path) || files.some((file) => file.path === path)) {
			throw new Error(`Docs Publisher: "${path}" is not a path that can be removed`);
		}
	}
	// A message that began with a dash would be read as an option; this one is ours.
	if (message === '' || message[0] === '-') {
		throw new Error('Docs Publisher: a commit message must not be empty or start with a dash');
	}

	const scratch = await mkdtemp(join(tmpdir(), 'docs-publisher-'));
	try {
		const identityEnv = {
			GIT_AUTHOR_NAME: identity.name,
			GIT_AUTHOR_EMAIL: identity.email,
			GIT_COMMITTER_NAME: identity.name,
			GIT_COMMITTER_EMAIL: identity.email,
		};
		const env = { GIT_INDEX_FILE: join(scratch, 'index'), ...identityEnv };

		const read = await ctx.git.run({ args: ['read-tree', parent], cwd: ctx.cwd, extraEnv: env });
		if (!succeeded(read)) {
			return failureOf('read-tree', read);
		}

		const blobs = new Map<string, string>();
		for (const file of files) {
			// The bytes go in on standard input, so they never meet an argument,
			// a shell, a filter or a line-ending conversion.
			const hashed = await ctx.git.run({
				args: ['hash-object', '-w', '--no-filters', '--stdin'],
				cwd: ctx.cwd,
				stdin: Buffer.from(file.bytes),
				extraEnv: env,
			});
			if (!succeeded(hashed)) {
				return failureOf('hash-object', hashed);
			}
			const blob = stdoutText(hashed).trim();
			const added = await ctx.git.run({
				args: ['update-index', '--add', '--cacheinfo', `100644,${blob},${file.path}`],
				cwd: ctx.cwd,
				extraEnv: env,
			});
			if (!succeeded(added)) {
				return failureOf('update-index', added);
			}
			blobs.set(file.path, blob);
		}

		if (removals.length > 0) {
			// The paths go in on standard input, NUL-separated, so a name can never be
			// read as an option. A path the parent's tree does not hold is a no-op.
			const removed = await ctx.git.run({
				args: ['update-index', '--force-remove', '-z', '--stdin'],
				cwd: ctx.cwd,
				stdin: Buffer.from(removals.map((path) => `${path}\0`).join(''), 'utf8'),
				extraEnv: env,
			});
			if (!succeeded(removed)) {
				return failureOf('update-index', removed);
			}
		}

		const written = await ctx.git.run({ args: ['write-tree'], cwd: ctx.cwd, extraEnv: env });
		if (!succeeded(written)) {
			return failureOf('write-tree', written);
		}
		const tree = stdoutText(written).trim();
		const commit = await ctx.git.run({ args: ['commit-tree', tree, '-p', parent, '-m', message], cwd: ctx.cwd, extraEnv: env });
		if (!succeeded(commit)) {
			return failureOf('commit-tree', commit);
		}
		return { ok: true, value: { commit: stdoutText(commit).trim(), tree, blobs } };
	} finally {
		await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
	}
}
