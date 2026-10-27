// Plain specifiers; see the note in `git-runner.ts`.
import { existsSync } from 'fs';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { failureOf } from './failures';
import type { GitResult } from './failures';
import { stdoutText } from './git-runner';
import type { GitRequest, GitRunner, ProcessResult } from './git-runner';
import type { ProjectAddress } from './project-address';
import {
	CONNECTED_REF,
	SYNCED_REF,
	docIdOfSentRef,
	fetchedBranchRef,
	fetchedDefaultRef,
	isHiddenPath,
	isReservedPath,
	sentRef,
	SENT_REF_PREFIX,
} from './ref-names';
import { parseDefaultBranch } from './test-access';

/**
 * Everything the plugin does to, and reads from, the vault's repository
 * (replace-rest-with-local-git-ssh design.md D4, D6, D8, D16; task 2.1).
 *
 * Two rules run through it. Nothing here writes a file in the vault's working
 * tree: the only files touched are inside `.git/`, and the only commands that
 * move HEAD or the index are `advanceHead` and the mixed reset connecting does
 * to a repository it just made. And every read of the project is answered from
 * the fetched copy, never by asking the server, so a read costs no request and
 * works with the network down.
 *
 * Reads that decide whether something may be overwritten return three answers
 * and not two — present, absent, could-not-tell — because "could not tell"
 * collapsed into "absent" is a licence to overwrite.
 */
export interface RepoContext {
	git: GitRunner;
	/** The vault's own folder. */
	cwd: string;
}

/** The refspec every fetch uses: all branches into the remote-tracking namespace, never by the name `origin`. */
export const FETCH_REFSPEC = '+refs/heads/*:refs/remotes/origin/*';

const LOCAL_BIG_OUTPUT = 64 * 1024 * 1024;

/** The identity bookkeeping commits carry, so no commit depends on the repository's own settings. */
const BOOKKEEPING_IDENTITY = {
	GIT_AUTHOR_NAME: 'Docs Publisher',
	GIT_AUTHOR_EMAIL: 'docs-publisher@localhost',
	GIT_COMMITTER_NAME: 'Docs Publisher',
	GIT_COMMITTER_EMAIL: 'docs-publisher@localhost',
};

/** The folders that are never the project's content and never part of what the vault shares. */
const EXCLUDE_LINES = ['.obsidian/', '.trash/'];

function succeeded(result: ProcessResult): boolean {
	return result.spawnError === null && !result.timedOut && !result.truncated && result.exitCode === 0;
}

/** A command that answers by its exit status being 1, such as `--verify --quiet`, without that being a failure. */
function answeredNo(result: ProcessResult): boolean {
	return result.spawnError === null && !result.timedOut && !result.truncated && result.exitCode === 1;
}

async function git(ctx: RepoContext, args: string[], extra: Partial<GitRequest> = {}): Promise<ProcessResult> {
	return ctx.git.run({ args, cwd: ctx.cwd, ...extra });
}

// --- inspecting --------------------------------------------------------------

export interface RepoReport {
	/** A repository serves the vault's folder, whether its own or an enclosing one. */
	present: boolean;
	/** That repository's top level is the vault's own folder. */
	topLevelIsVault: boolean;
	origin: string | null;
	/** The current branch; null when detached or when there is no repository. */
	branch: string | null;
	headUnborn: boolean;
	objectFormat: 'sha1' | 'other';
}

const NO_REPOSITORY: RepoReport = {
	present: false,
	topLevelIsVault: false,
	origin: null,
	branch: null,
	headUnborn: false,
	objectFormat: 'sha1',
};

/**
 * Whether two folders are the same one, as the operating system sees it:
 * through links, with the separators git prints on Windows, and without regard
 * to case where the file system has none.
 */
export async function sameFolder(a: string, b: string): Promise<boolean> {
	const real = async (path: string): Promise<string> => {
		try {
			return await realpath(path);
		} catch {
			return resolve(path);
		}
	};
	const [left, right] = [await real(a), await real(b)];
	const fold = (path: string): string => (process.platform === 'win32' || process.platform === 'darwin' ? path.toLowerCase() : path);
	return fold(resolve(left)) === fold(resolve(right));
}

export async function inspectRepo(ctx: RepoContext): Promise<GitResult<RepoReport>> {
	const top = await git(ctx, ['rev-parse', '--show-toplevel']);
	if (!succeeded(top)) {
		if (top.spawnError === null && !top.timedOut && /not a git repository/i.test(top.stderr)) {
			return { ok: true, value: NO_REPOSITORY };
		}
		return failureOf('rev-parse --show-toplevel', top);
	}
	if (!(await sameFolder(stdoutText(top).trim(), ctx.cwd))) {
		return { ok: true, value: { ...NO_REPOSITORY, present: true } };
	}

	const origin = await git(ctx, ['config', '--local', '--get', 'remote.origin.url']);
	if (!succeeded(origin) && !answeredNo(origin)) {
		return failureOf('config remote.origin.url', origin);
	}
	const branch = await git(ctx, ['symbolic-ref', '--short', '-q', 'HEAD']);
	if (!succeeded(branch) && !answeredNo(branch)) {
		return failureOf('symbolic-ref HEAD', branch);
	}
	const head = await git(ctx, ['rev-parse', '--verify', '--quiet', 'HEAD']);
	if (!succeeded(head) && !answeredNo(head)) {
		return failureOf('rev-parse HEAD', head);
	}
	// Older git cannot print it, and cannot have made a repository of the other
	// kind in any way this plugin would meet, so a failure here reads as the usual one.
	const format = await git(ctx, ['rev-parse', '--show-object-format']);
	const objectFormat = succeeded(format) && stdoutText(format).trim() !== 'sha1' ? 'other' : 'sha1';

	return {
		ok: true,
		value: {
			present: true,
			topLevelIsVault: true,
			origin: succeeded(origin) ? stdoutText(origin).trim() : null,
			branch: succeeded(branch) ? stdoutText(branch).trim() : null,
			headUnborn: answeredNo(head),
			objectFormat,
		},
	};
}

export type HeadRelation = 'unborn' | 'equal' | 'ancestor' | 'diverged';

/** How HEAD stands to a fetched commit: nothing yet, the same, behind it, or carrying commits that were never sent. */
export async function headRelation(ctx: RepoContext, commit: string): Promise<GitResult<HeadRelation>> {
	const head = await git(ctx, ['rev-parse', '--verify', '--quiet', 'HEAD']);
	if (answeredNo(head)) {
		return { ok: true, value: 'unborn' };
	}
	if (!succeeded(head)) {
		return failureOf('rev-parse HEAD', head);
	}
	if (stdoutText(head).trim() === commit) {
		return { ok: true, value: 'equal' };
	}
	const ancestry = await git(ctx, ['merge-base', '--is-ancestor', 'HEAD', commit]);
	if (succeeded(ancestry)) {
		return { ok: true, value: 'ancestor' };
	}
	return answeredNo(ancestry) ? { ok: true, value: 'diverged' } : failureOf('merge-base --is-ancestor', ancestry);
}

// --- initialising and linking ------------------------------------------------

/**
 * Adds the two folders that are the vault's own business to the repository's
 * local ignore file, never to a committed one: a committed ignore file would be
 * a file in the vault, and a change to the project.
 */
export async function ensureExclude(ctx: RepoContext): Promise<GitResult<void>> {
	const dir = await git(ctx, ['rev-parse', '--git-dir']);
	if (!succeeded(dir)) {
		return failureOf('rev-parse --git-dir', dir);
	}
	const file = join(resolve(ctx.cwd, stdoutText(dir).trim()), 'info', 'exclude');
	try {
		let existing = '';
		try {
			existing = await readFile(file, 'utf8');
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				throw error;
			}
		}
		const have = existing.split(/\r?\n/).map((line) => line.trim());
		const missing = EXCLUDE_LINES.filter((line) => have.indexOf(line) === -1);
		if (missing.length > 0) {
			await mkdir(dirname(file), { recursive: true });
			const separator = existing === '' || existing.endsWith('\n') ? '' : '\n';
			await writeFile(file, `${existing}${separator}${missing.join('\n')}\n`, 'utf8');
		}
		return { ok: true, value: undefined };
	} catch (error) {
		console.error('Docs Publisher: could not write the repository ignore file', error);
		return { ok: false, failure: 'unexpected' };
	}
}

/**
 * Makes a repository in the vault, unborn, on the project's default branch,
 * with the project as its origin. Refuses over anything already at `.git`, and
 * takes back what it made if any step fails, so a failed attempt is not a
 * half-made repository that the next attempt would read as someone else's.
 * No file in the working tree is created, changed or deleted.
 */
export async function initRepository(
	ctx: RepoContext,
	address: ProjectAddress,
	defaultBranch: string
): Promise<GitResult<void>> {
	const gitDir = join(ctx.cwd, '.git');
	if (existsSync(gitDir)) {
		console.error('Docs Publisher: refused to initialise over an existing repository');
		return { ok: false, failure: 'unexpected' };
	}
	const undo = async (): Promise<void> => {
		await rm(gitDir, { recursive: true, force: true }).catch(() => undefined);
	};

	// Not `init -b`, which older git lacks; the unborn HEAD is pointed afterwards.
	const steps: string[][] = [
		['init', '-q'],
		['symbolic-ref', 'HEAD', `refs/heads/${defaultBranch}`],
		['remote', 'add', 'origin', address.sshUrl],
	];
	for (const args of steps) {
		const result = await git(ctx, args);
		if (!succeeded(result)) {
			await undo();
			return failureOf(args[0], result);
		}
	}
	const excluded = await ensureExclude(ctx);
	if (!excluded.ok) {
		await undo();
		return excluded;
	}
	return { ok: true, value: undefined };
}

/** Removes a repository this plugin has just made. For connecting's cleanup only; it is never pointed at an adopted one. */
export async function discardNewRepository(ctx: RepoContext): Promise<void> {
	await rm(join(ctx.cwd, '.git'), { recursive: true, force: true }).catch(() => undefined);
}

// --- the server, and the fetched copy ----------------------------------------

/** The project's default branch name, from the server. Nothing in the answer is "the project is empty". */
export async function readDefaultBranch(ctx: RepoContext, address: ProjectAddress): Promise<GitResult<string>> {
	const listing = await git(ctx, ['ls-remote', '--symref', address.sshUrl, 'HEAD'], { remote: address.sshUrl });
	if (!succeeded(listing)) {
		return failureOf('ls-remote', listing);
	}
	return parseDefaultBranch(stdoutText(listing));
}

/**
 * Whether the project's repository uses 40-character object identifiers, from
 * the same listing. The plugin computes identifiers itself and compares them
 * with git's, so a project that uses the other kind cannot be worked with.
 */
export async function projectUsesSha1(ctx: RepoContext, address: ProjectAddress): Promise<GitResult<boolean>> {
	const listing = await git(ctx, ['ls-remote', address.sshUrl, 'HEAD'], { remote: address.sshUrl });
	if (!succeeded(listing)) {
		return failureOf('ls-remote', listing);
	}
	const first = stdoutText(listing).trim().split(/\s/)[0];
	return { ok: true, value: first === '' || first.length === 40 };
}

/**
 * Updates every remote-tracking branch from the project and removes the ones
 * it no longer has. A fetch that does not finish leaves the previous fetched
 * copy as it was.
 */
export async function fetchProject(ctx: RepoContext, address: ProjectAddress): Promise<GitResult<void>> {
	const result = await git(ctx, ['fetch', '--prune', '--no-tags', '-q', address.sshUrl, FETCH_REFSPEC], {
		remote: address.sshUrl,
	});
	return succeeded(result) ? { ok: true, value: undefined } : failureOf('fetch', result);
}

// --- refs --------------------------------------------------------------------

/** A ref's commit, or null when it does not exist. Anything else is a failure, not "absent". */
export async function readRef(ctx: RepoContext, ref: string): Promise<GitResult<string | null>> {
	const result = await git(ctx, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
	if (succeeded(result)) {
		return { ok: true, value: stdoutText(result).trim() };
	}
	return answeredNo(result) ? { ok: true, value: null } : failureOf('rev-parse', result);
}

export async function writeRef(ctx: RepoContext, ref: string, commit: string): Promise<GitResult<void>> {
	const result = await git(ctx, ['update-ref', '-m', 'docs-publisher', ref, commit]);
	return succeeded(result) ? { ok: true, value: undefined } : failureOf('update-ref', result);
}

export async function deleteRef(ctx: RepoContext, ref: string): Promise<GitResult<void>> {
	const result = await git(ctx, ['update-ref', '-d', ref]);
	return succeeded(result) ? { ok: true, value: undefined } : failureOf('update-ref -d', result);
}

/** The last commit this vault built for a document; null when it never built one. */
export async function readSent(ctx: RepoContext, docId: string): Promise<GitResult<string | null>> {
	return readRef(ctx, sentRef(docId));
}

export async function writeSent(ctx: RepoContext, docId: string, commit: string): Promise<GitResult<void>> {
	return writeRef(ctx, sentRef(docId), commit);
}

/** Every document this vault has built a commit for, with the commit. */
export async function listSent(ctx: RepoContext): Promise<GitResult<Map<string, string>>> {
	const result = await git(ctx, ['for-each-ref', '--format=%(refname) %(objectname)', SENT_REF_PREFIX]);
	if (!succeeded(result)) {
		return failureOf('for-each-ref', result);
	}
	const sent = new Map<string, string>();
	for (const line of stdoutText(result).split('\n')) {
		const space = line.lastIndexOf(' ');
		const docId = space === -1 ? null : docIdOfSentRef(line.slice(0, space));
		if (docId !== null) {
			sent.set(docId, line.slice(space + 1).trim());
		}
	}
	return { ok: true, value: sent };
}

// --- listing and reading the fetched copy ------------------------------------

export interface TreeEntry {
	mode: string;
	blob: string;
}

/**
 * Every file at a revision, as path to mode and blob identifier. Whole or not
 * at all: an unreadable revision is a failure and never an empty listing,
 * which would read as "the project has no files". Paths under the settings and
 * repository folders are left out, since the plugin never compares them.
 */
export async function listEntries(ctx: RepoContext, rev: string): Promise<GitResult<Map<string, TreeEntry>>> {
	const result = await git(ctx, ['ls-tree', '-r', '-z', '--full-tree', rev], { maxOutputBytes: LOCAL_BIG_OUTPUT });
	if (!succeeded(result)) {
		return failureOf('ls-tree', result);
	}
	return { ok: true, value: parseTree(stdoutText(result)) };
}

function parseTree(text: string): Map<string, TreeEntry> {
	const entries = new Map<string, TreeEntry>();
	for (const record of text.split('\0')) {
		const tab = record.indexOf('\t');
		if (tab === -1) {
			continue;
		}
		const [mode, type, blob] = record.slice(0, tab).split(' ');
		const path = record.slice(tab + 1);
		// Submodule entries are commits, not files, and have nothing to compare.
		if (type === 'blob' && !isReservedPath(path) && !isHiddenPath(path)) {
			entries.set(path, { mode, blob });
		}
	}
	return entries;
}

/** `listEntries`, as path to blob identifier. */
export async function listFiles(ctx: RepoContext, rev: string): Promise<GitResult<Map<string, string>>> {
	const entries = await listEntries(ctx, rev);
	if (!entries.ok) {
		return entries;
	}
	const files = new Map<string, string>();
	entries.value.forEach((entry, path) => files.set(path, entry.blob));
	return { ok: true, value: files };
}

/** The branch HEAD is on, which after connecting is the project's default branch; null when detached or unborn without one. */
export async function currentBranch(ctx: RepoContext): Promise<GitResult<string | null>> {
	const result = await git(ctx, ['symbolic-ref', '--short', '-q', 'HEAD']);
	if (succeeded(result)) {
		return { ok: true, value: stdoutText(result).trim() };
	}
	// No repository at all is the same answer as no branch: nothing has been fetched.
	const noRepository = result.spawnError === null && !result.timedOut && /not a git repository/i.test(result.stderr);
	return answeredNo(result) || noRepository ? { ok: true, value: null } : failureOf('symbolic-ref HEAD', result);
}

/** The documents whose branch the last fetch listed, from one listing and not one lookup each. */
export async function listFetchedDocumentBranches(ctx: RepoContext): Promise<GitResult<Set<string>>> {
	const prefix = 'refs/remotes/origin/doc/';
	const result = await git(ctx, ['for-each-ref', '--format=%(refname)', prefix]);
	if (!succeeded(result)) {
		return failureOf('for-each-ref', result);
	}
	const ids = new Set<string>();
	for (const line of stdoutText(result).split('\n')) {
		if (line.indexOf(prefix) === 0 && line.length > prefix.length) {
			ids.add(line.slice(prefix.length));
		}
	}
	return { ok: true, value: ids };
}

/** One file's blob identifier at a revision, or null when the revision has no file there. A failure is a failure, not null. */
export async function blobAt(ctx: RepoContext, rev: string, path: string): Promise<GitResult<string | null>> {
	if (isReservedPath(path)) {
		return { ok: true, value: null };
	}
	const listed = await git(ctx, ['ls-tree', '-z', rev, '--', path]);
	if (!succeeded(listed)) {
		return failureOf('ls-tree', listed);
	}
	return { ok: true, value: parseTree(stdoutText(listed)).get(path)?.blob ?? null };
}

export type FileRead = { kind: 'file'; bytes: Buffer } | { kind: 'absent' } | { kind: 'failed' };

/**
 * One file's bytes at a fetched revision, in three answers: there, not there
 * though the revision exists, or could not be read — which includes a revision
 * that does not exist, never reported as an absent file.
 */
export async function readFileAt(ctx: RepoContext, rev: string, path: string): Promise<FileRead> {
	if (isReservedPath(path)) {
		return { kind: 'failed' };
	}
	const exists = await readRef(ctx, rev);
	if (!exists.ok || exists.value === null) {
		return { kind: 'failed' };
	}
	const listed = await git(ctx, ['ls-tree', '-z', rev, '--', path]);
	if (!succeeded(listed)) {
		return { kind: 'failed' };
	}
	const entry = parseTree(stdoutText(listed)).get(path);
	if (entry === undefined) {
		return { kind: 'absent' };
	}
	const blob = await git(ctx, ['cat-file', 'blob', entry.blob], { maxOutputBytes: LOCAL_BIG_OUTPUT });
	return succeeded(blob) ? { kind: 'file', bytes: blob.stdout } : { kind: 'failed' };
}

export type BranchLookup = 'exists' | 'absent' | 'failed';

/**
 * Whether a document's branch exists, as of the last fetch. Absent only when a
 * fetch has completed and the fetched copy does not list it; before the first
 * fetch, or when the copy cannot be read, the answer is "failed".
 */
export async function branchExists(ctx: RepoContext, docId: string, defaultBranch: string): Promise<BranchLookup> {
	const tip = await readRef(ctx, fetchedDefaultRef(defaultBranch));
	if (!tip.ok || tip.value === null) {
		return 'failed';
	}
	const branch = await readRef(ctx, fetchedBranchRef(docId));
	if (!branch.ok) {
		return 'failed';
	}
	return branch.value === null ? 'absent' : 'exists';
}

/** A blob's bytes by identifier, or null when it cannot be read. */
export async function readBlob(ctx: RepoContext, blob: string): Promise<Buffer | null> {
	if (!/^[0-9a-f]{40}$/.test(blob)) {
		return null;
	}
	const result = await git(ctx, ['cat-file', 'blob', blob], { maxOutputBytes: LOCAL_BIG_OUTPUT });
	return succeeded(result) ? result.stdout : null;
}

/**
 * What this vault last sent for each of the given paths: for every document it
 * has built a commit for, the blob it committed at each path that commit changed
 * relative to its parent. Only files the commit changed count, so a file that
 * merely rode along unchanged in a commit's tree is not mistaken for something
 * the author sent.
 */
export async function sentVersions(ctx: RepoContext, paths: readonly string[]): Promise<GitResult<Map<string, Set<string>>>> {
	const versions = new Map<string, Set<string>>();
	if (paths.length === 0) {
		return { ok: true, value: versions };
	}
	const sent = await listSent(ctx);
	if (!sent.ok) {
		return sent;
	}
	for (const commit of Array.from(sent.value.values())) {
		const own = await blobsAt(ctx, commit, [...paths]);
		if (!own.ok) {
			return own;
		}
		const before = await blobsAt(ctx, `${commit}^`, [...paths]);
		if (!before.ok) {
			// A commit with no parent cannot be compared: nothing in it is known to be the author's.
			continue;
		}
		own.value.forEach((blob, path) => {
			if (before.value.get(path) !== blob) {
				versions.set(path, new Set([...Array.from(versions.get(path) ?? []), blob]));
			}
		});
	}
	return { ok: true, value: versions };
}

/** The note a send carried: its path and the blob committed there. */
export interface SentNote {
	path: string;
	blob: string;
}

/** The line a send puts in its commit message to say which note it carried. */
export const NOTE_TRAILER = 'Docs-Publisher-Note: ';

/**
 * The note a commit this vault built carried, read from the commit itself and
 * not from anything stored (panel-by-path-without-doc-id design.md D3).
 *
 * The path comes from the trailer the send wrote in its message, which survives
 * a send that changed only an image or left the note's bytes as they were. A
 * commit without one, built before sends wrote it, falls back to the one
 * markdown file it changed relative to its parent. Null when there is neither,
 * or that file is several or has no parent to compare with: no path, never a
 * guess. A path the commit does not hold is not believed. A commit that cannot
 * be read is a failure.
 */
export async function sentNote(ctx: RepoContext, commit: string): Promise<GitResult<SentNote | null>> {
	if (!/^[0-9a-f]{40}$/.test(commit)) {
		return { ok: true, value: null };
	}
	const raw = await git(ctx, ['cat-file', '-p', commit]);
	if (!succeeded(raw)) {
		return failureOf('cat-file', raw);
	}
	const message = stdoutText(raw).split('\n\n').slice(1).join('\n\n');
	const line = message.split('\n').find((entry) => entry.indexOf(NOTE_TRAILER) === 0);
	const named = line === undefined ? null : line.slice(NOTE_TRAILER.length).trim();
	if (named !== null && /\.md$/i.test(named) && !isReservedPath(named)) {
		const blob = await blobAt(ctx, commit, named);
		if (!blob.ok) {
			return blob;
		}
		if (blob.value !== null) {
			return { ok: true, value: { path: named, blob: blob.value } };
		}
	}

	const parent = await git(ctx, ['rev-parse', '--verify', '--quiet', `${commit}^`]);
	if (answeredNo(parent)) {
		return { ok: true, value: null };
	}
	if (!succeeded(parent)) {
		return failureOf('rev-parse', parent);
	}
	const diff = await git(
		ctx,
		['diff', '--name-only', '-z', '--no-renames', '--no-ext-diff', '--no-textconv', '--diff-filter=AM', `${commit}^`, commit, '--'],
		{ maxOutputBytes: LOCAL_BIG_OUTPUT }
	);
	if (!succeeded(diff)) {
		return failureOf('diff', diff);
	}
	const notes = stdoutText(diff)
		.split('\0')
		.filter((path) => /\.md$/i.test(path) && !isReservedPath(path));
	if (notes.length !== 1) {
		return { ok: true, value: null };
	}
	const blob = await blobAt(ctx, commit, notes[0]);
	if (!blob.ok) {
		return blob;
	}
	return { ok: true, value: blob.value === null ? null : { path: notes[0], blob: blob.value } };
}

export interface ChangedFile {
	path: string;
	/** The file's blob on the document's branch; null when the branch deleted it. */
	branchBlob: string | null;
	/** The file's blob on the default branch; null when the default branch has none. */
	defaultBlob: string | null;
}

export interface BranchChanges {
	files: ChangedFile[];
	/** The one markdown file the branch changed; null when there is none or more than one. */
	document: string | null;
}

const PATHS_PER_LISTING = 200;

async function blobsAt(ctx: RepoContext, rev: string, paths: string[]): Promise<GitResult<Map<string, string>>> {
	const found = new Map<string, string>();
	for (let from = 0; from < paths.length; from += PATHS_PER_LISTING) {
		const result = await git(ctx, ['ls-tree', '-r', '-z', '--full-tree', rev, '--', ...paths.slice(from, from + PATHS_PER_LISTING)]);
		if (!succeeded(result)) {
			return failureOf('ls-tree', result);
		}
		parseTree(stdoutText(result)).forEach((entry, path) => found.set(path, entry.blob));
	}
	return { ok: true, value: found };
}

/**
 * Every file a fetched document branch changed relative to its merge base with
 * the default branch, with its identifier on each side. All of them, not only
 * the note: a branch whose changed files all equal the default branch's has
 * been merged however it was merged, a squash merge included, and a branch
 * carrying only a changed image is still under review.
 */
export async function changedFiles(ctx: RepoContext, docId: string, defaultBranch: string): Promise<GitResult<BranchChanges>> {
	const branch = fetchedBranchRef(docId);
	const base = fetchedDefaultRef(defaultBranch);
	const diff = await git(ctx, ['diff', '--name-only', '-z', '--no-renames', '--no-ext-diff', '--no-textconv', `${base}...${branch}`, '--'], {
		maxOutputBytes: LOCAL_BIG_OUTPUT,
	});
	if (!succeeded(diff)) {
		return failureOf('diff', diff);
	}
	const paths = stdoutText(diff)
		.split('\0')
		.filter((path) => path !== '' && !isReservedPath(path));

	const onBranch = await blobsAt(ctx, branch, paths);
	if (!onBranch.ok) {
		return onBranch;
	}
	const onDefault = await blobsAt(ctx, base, paths);
	if (!onDefault.ok) {
		return onDefault;
	}
	const files = paths.map((path) => ({
		path,
		branchBlob: onBranch.value.get(path) ?? null,
		defaultBlob: onDefault.value.get(path) ?? null,
	}));
	const documents = files.filter((file) => file.branchBlob !== null && /\.md$/i.test(file.path));
	return { ok: true, value: { files, document: documents.length === 1 ? documents[0].path : null } };
}

// --- the synced version, and moving HEAD -------------------------------------

/**
 * Records the fetched commit as the vault's last synced version, except that
 * each held-back path keeps the entry it had before (or stays absent), so a
 * file the caller could not apply is seen again by the next update. The synced
 * version is a commit with no parent that only the ref keeps alive; nothing
 * about it touches the vault.
 */
export async function advanceSynced(
	ctx: RepoContext,
	fetchedCommit: string,
	heldBack: ReadonlyArray<string> = []
): Promise<GitResult<string>> {
	const previous = await readRef(ctx, SYNCED_REF);
	if (!previous.ok) {
		return previous;
	}
	let before = new Map<string, TreeEntry>();
	if (heldBack.length > 0 && previous.value !== null) {
		const listed = await listEntries(ctx, previous.value);
		if (!listed.ok) {
			return listed;
		}
		before = listed.value;
	}

	const scratch = await mkdtemp(join(tmpdir(), 'docs-publisher-'));
	try {
		const env = { GIT_INDEX_FILE: join(scratch, 'index'), ...BOOKKEEPING_IDENTITY };
		const read = await git(ctx, ['read-tree', fetchedCommit], { extraEnv: env });
		if (!succeeded(read)) {
			return failureOf('read-tree', read);
		}
		if (heldBack.length > 0) {
			// Mode 0 with the null identifier removes an entry from the index.
			const NULL_BLOB = '0'.repeat(40);
			const lines = heldBack.map((path) => {
				const entry = before.get(path);
				return entry === undefined ? `0 ${NULL_BLOB}\t${path}` : `${entry.mode} ${entry.blob}\t${path}`;
			});
			const update = await git(ctx, ['update-index', '-z', '--index-info'], {
				extraEnv: env,
				stdin: `${lines.join('\0')}\0`,
			});
			if (!succeeded(update)) {
				return failureOf('update-index', update);
			}
		}
		const tree = await git(ctx, ['write-tree'], { extraEnv: env });
		if (!succeeded(tree)) {
			return failureOf('write-tree', tree);
		}
		const commit = await git(ctx, ['commit-tree', stdoutText(tree).trim(), '-m', 'docs-publisher: synced version'], {
			extraEnv: env,
		});
		if (!succeeded(commit)) {
			return failureOf('commit-tree', commit);
		}
		const sha = stdoutText(commit).trim();
		const written = await writeRef(ctx, SYNCED_REF, sha);
		return written.ok ? { ok: true, value: sha } : written;
	} finally {
		await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
	}
}

/**
 * A commit whose tree is empty: "nothing has been synced yet". What a vault
 * that connects with no repository of its own records as both its synced and its
 * connected version, so that every file the project holds differs from the base
 * and the first update offers to download it. Recording the fetched tip instead
 * would make the whole project look already received, and nothing would ever be
 * downloaded.
 */
export async function emptySyncedCommit(ctx: RepoContext): Promise<GitResult<string>> {
	const scratch = await mkdtemp(join(tmpdir(), 'docs-publisher-'));
	try {
		const env = { GIT_INDEX_FILE: join(scratch, 'index'), ...BOOKKEEPING_IDENTITY };
		const read = await git(ctx, ['read-tree', '--empty'], { extraEnv: env });
		if (!succeeded(read)) {
			return failureOf('read-tree --empty', read);
		}
		const tree = await git(ctx, ['write-tree'], { extraEnv: env });
		if (!succeeded(tree)) {
			return failureOf('write-tree', tree);
		}
		const commit = await git(ctx, ['commit-tree', stdoutText(tree).trim(), '-m', 'docs-publisher: nothing synced yet'], { extraEnv: env });
		return succeeded(commit) ? { ok: true, value: stdoutText(commit).trim() } : failureOf('commit-tree', commit);
	} finally {
		await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
	}
}

export type HeadMove = 'moved' | 'already' | 'not-fast-forward';

/**
 * Moves HEAD and the index to the fetched tip without changing a file, and only
 * as a fast-forward: when HEAD carries a commit that was never sent, nothing
 * moves and the caller is told. A mixed reset rewrites the index and the branch
 * and never the working tree.
 */
export async function advanceHead(ctx: RepoContext, tip: string): Promise<GitResult<HeadMove>> {
	const relation = await headRelation(ctx, tip);
	if (!relation.ok) {
		return relation;
	}
	if (relation.value === 'equal') {
		return { ok: true, value: 'already' };
	}
	if (relation.value === 'diverged') {
		return { ok: true, value: 'not-fast-forward' };
	}
	const reset = await git(ctx, ['reset', '--mixed', '-q', tip]);
	return succeeded(reset) ? { ok: true, value: 'moved' } : failureOf('reset --mixed', reset);
}

export { CONNECTED_REF, SYNCED_REF };
