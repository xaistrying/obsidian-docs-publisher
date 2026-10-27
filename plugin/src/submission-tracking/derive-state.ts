import { deriveDocIdFromPath } from '../doc-authoring/doc-id';
import type { GitResult } from '../git-publishing/failures';
import { SYNCED_REF, fetchedBranchRef, fetchedDefaultRef, isValidRefPart } from '../git-publishing/ref-names';
import {
	blobAt,
	changedFiles,
	currentBranch,
	listFetchedDocumentBranches,
	listFiles,
	listSent,
	readRef,
	sentNote,
} from '../git-publishing/repo';
import type { BranchChanges, RepoContext, SentNote } from '../git-publishing/repo';

/**
 * A document's state, worked out from git and never stored
 * (replace-rest-with-local-git-ssh design.md D8, task 2.5).
 *
 * With `M` the fetched default branch, `B` the fetched branch `doc/<doc_id>`,
 * `S` the last synced version and `L` the commit this vault last built for the
 * document:
 *
 * - A review is LIVE when `B` exists and at least one file it changed relative
 *   to its merge base differs from `M`'s copy, or `M` lacks it. Counting every
 *   changed file and not only the note keeps an image-only revision pending,
 *   and means a branch left behind after a merge — a squash merge included,
 *   whose commits are not ancestors of `M` but whose files equal `M`'s — is not.
 * - live → pending; not live and `M` has a file at the document's path →
 *   published; otherwise closed.
 * - The path is found by identity, not by where the note sits: the one markdown
 *   file `B` changed, else the one path on `M` whose file name derives the
 *   `doc_id`. More than one candidate is no path. A moved or renamed note keeps
 *   its state for that reason.
 *
 * Everything is read from the fetched copy, so deriving starts no connection;
 * it does start local processes, which is why it runs when something was
 * fetched and never when something is drawn. What a draw needs — whether a note
 * has been edited — is precomputed here as the set of content identifiers the
 * note may legitimately have, so the draw compares one string with a set.
 */
export type DocumentState = 'pending' | 'published' | 'closed';

export interface DerivedDocument {
	docId: string;
	state: DocumentState;
	/** Where the document lives on the project, found by identity; null when it cannot be found. */
	remotePath: string | null;
	/**
	 * The content identifiers the note may have without having been edited: the
	 * last synced version's, the default branch's, the last one this vault sent,
	 * and the document branch's, each at `remotePath`. Empty without a path.
	 */
	accepted: ReadonlySet<string>;
}

/**
 * What matching a note to its document needs, kept with the derived states so
 * that a draw can resolve notes without starting a process
 * (panel-by-path-without-doc-id design.md D1, D3).
 */
export interface ResolutionIndex {
	/** The files on the fetched default branch, as path to blob identifier. */
	main: ReadonlyMap<string, string>;
	/** The last synced version's files; null when nothing has been synced. */
	synced: ReadonlyMap<string, string> | null;
	/** The note each document's last send from this vault carried, read from the commit. */
	sentNotes: ReadonlyMap<string, SentNote>;
	/** Which paths on the default branch derive each identity. */
	identities: ReadonlyMap<string, string[]>;
}

export interface DerivedStates {
	defaultBranch: string;
	index: ResolutionIndex;
	documents: ReadonlyMap<string, DerivedDocument>;
	/** How many files differ between the fetched default branch and the last synced version. */
	updatesAvailable: number;
	/**
	 * The files the project has that are unchanged since the last update. One the
	 * vault no longer holds is an update too — it comes back — and only the view
	 * can see the vault, so it adds those to `updatesAvailable`.
	 */
	unchanged: readonly string[];
}

/** What is read once per derivation and shared by every document. */
export interface Snapshot {
	defaultBranch: string;
	/** `M`, as path to blob identifier. */
	main: ReadonlyMap<string, string>;
	/** `S`; null when nothing has been synced. */
	synced: ReadonlyMap<string, string> | null;
	/** The documents whose branch was fetched. */
	branches: ReadonlySet<string>;
	/** `L` for every document this vault has built a commit for. */
	sent: ReadonlyMap<string, string>;
	/** The note each of those commits carried. A document whose commit carried none or several is absent. */
	sentNotes: ReadonlyMap<string, SentNote>;
	/** Which paths on `M` derive each identity. */
	identities: ReadonlyMap<string, string[]>;
}

function identityIndex(main: ReadonlyMap<string, string>): Map<string, string[]> {
	const index = new Map<string, string[]>();
	main.forEach((_blob, path) => {
		if (!/\.md$/i.test(path)) {
			return;
		}
		const id = deriveDocIdFromPath(path);
		if (id !== null) {
			index.set(id, [...(index.get(id) ?? []), path]);
		}
	});
	return index;
}

/**
 * The note a commit carried, by commit and repository: a commit never changes,
 * so it is read once. Without this every derivation would start several
 * processes per document ever sent, and the `sent/` records are never pruned.
 */
const sentNoteCache = new Map<string, SentNote | null>();

async function cachedSentNote(ctx: RepoContext, commit: string): Promise<GitResult<SentNote | null>> {
	const key = `${ctx.cwd}\0${commit}`;
	if (sentNoteCache.has(key)) {
		return { ok: true, value: sentNoteCache.get(key) ?? null };
	}
	const note = await sentNote(ctx, commit);
	if (note.ok) {
		sentNoteCache.set(key, note.value);
	}
	return note;
}

/**
 * `null` when no fetch has completed, which is not a failure and is not "no documents".
 * `withSentNotes: false` skips reading what each send carried, for the caller that
 * only needs the files; those documents are then absent from `sentNotes`.
 */
export async function loadSnapshot(ctx: RepoContext, options: { withSentNotes?: boolean } = {}): Promise<GitResult<Snapshot | null>> {
	const branch = await currentBranch(ctx);
	if (!branch.ok) {
		return branch;
	}
	if (branch.value === null) {
		return { ok: true, value: null };
	}
	const tip = await readRef(ctx, fetchedDefaultRef(branch.value));
	if (!tip.ok) {
		return tip;
	}
	if (tip.value === null) {
		return { ok: true, value: null };
	}

	const main = await listFiles(ctx, tip.value);
	if (!main.ok) {
		return main;
	}
	const syncedTip = await readRef(ctx, SYNCED_REF);
	if (!syncedTip.ok) {
		return syncedTip;
	}
	let synced: Map<string, string> | null = null;
	if (syncedTip.value !== null) {
		const listed = await listFiles(ctx, syncedTip.value);
		if (!listed.ok) {
			return listed;
		}
		synced = listed.value;
	}
	const branches = await listFetchedDocumentBranches(ctx);
	if (!branches.ok) {
		return branches;
	}
	const sent = await listSent(ctx);
	if (!sent.ok) {
		return sent;
	}
	const sentNotes = new Map<string, SentNote>();
	for (const [docId, commit] of options.withSentNotes === false ? [] : Array.from(sent.value.entries())) {
		const note = await cachedSentNote(ctx, commit);
		if (!note.ok) {
			return note;
		}
		if (note.value !== null) {
			sentNotes.set(docId, note.value);
		}
	}
	return {
		ok: true,
		value: {
			defaultBranch: branch.value,
			main: main.value,
			synced,
			branches: branches.value,
			sent: sent.value,
			sentNotes,
			identities: identityIndex(main.value),
		},
	};
}

/** The files that differ between two listings, counting a file on one side only. */
export function unchangedPaths(main: ReadonlyMap<string, string>, synced: ReadonlyMap<string, string> | null): string[] {
	const paths: string[] = [];
	if (synced !== null) {
		main.forEach((blob, path) => {
			if (synced.get(path) === blob) {
				paths.push(path);
			}
		});
	}
	return paths;
}

export function countDifferences(main: ReadonlyMap<string, string>, synced: ReadonlyMap<string, string> | null): number {
	if (synced === null) {
		return 0;
	}
	let count = 0;
	main.forEach((blob, path) => {
		if (synced.get(path) !== blob) {
			count += 1;
		}
	});
	synced.forEach((_blob, path) => {
		if (!main.has(path)) {
			count += 1;
		}
	});
	return count;
}

/**
 * One document, against what was read. A document whose identity could not be a
 * ref part has no branch and no sent commit, and is derived from `M` alone.
 */
export async function deriveDocument(ctx: RepoContext, snapshot: Snapshot, docId: string): Promise<GitResult<DerivedDocument>> {
	const usable = isValidRefPart(docId);

	let changes: BranchChanges | null = null;
	if (usable && snapshot.branches.has(docId)) {
		const read = await changedFiles(ctx, docId, snapshot.defaultBranch);
		if (!read.ok) {
			return read;
		}
		changes = read.value;
	}
	const live = changes !== null && changes.files.some((file) => file.branchBlob !== file.defaultBlob);

	const candidates = snapshot.identities.get(docId) ?? [];
	const remotePath = changes !== null && changes.document !== null ? changes.document : candidates.length === 1 ? candidates[0] : null;

	const state: DocumentState = live ? 'pending' : remotePath !== null && snapshot.main.has(remotePath) ? 'published' : 'closed';

	const accepted = new Set<string>();
	if (remotePath !== null) {
		const add = (blob: string | null | undefined): void => {
			if (blob !== null && blob !== undefined) {
				accepted.add(blob);
			}
		};
		add(snapshot.synced?.get(remotePath));
		add(snapshot.main.get(remotePath));

		const sentCommit = usable ? snapshot.sent.get(docId) : undefined;
		if (sentCommit !== undefined) {
			const sentBlob = await blobAt(ctx, sentCommit, remotePath);
			if (!sentBlob.ok) {
				return sentBlob;
			}
			add(sentBlob.value);
		}
		if (usable && snapshot.branches.has(docId)) {
			const onBranch = changes?.files.find((file) => file.path === remotePath);
			if (onBranch !== undefined) {
				add(onBranch.branchBlob);
			} else {
				const branchBlob = await blobAt(ctx, fetchedBranchRef(docId), remotePath);
				if (!branchBlob.ok) {
					return branchBlob;
				}
				add(branchBlob.value);
			}
		}
	}
	return { ok: true, value: { docId, state, remotePath, accepted } };
}

/**
 * Every document's state from the fetched copy, with one set of listings and
 * no request per document. `null` when nothing has been fetched yet.
 */
export async function deriveStates(ctx: RepoContext, docIds: readonly string[]): Promise<GitResult<DerivedStates | null>> {
	const snapshot = await loadSnapshot(ctx);
	if (!snapshot.ok) {
		return snapshot;
	}
	if (snapshot.value === null) {
		return { ok: true, value: null };
	}
	return deriveFromSnapshot(ctx, snapshot.value, docIds);
}

/**
 * `deriveStates` over a snapshot that has already been read, for the caller
 * that needs the snapshot too and must not read the repository twice.
 */
export async function deriveFromSnapshot(ctx: RepoContext, snapshot: Snapshot, docIds: readonly string[]): Promise<GitResult<DerivedStates>> {
	// The identities the notes name, and every document the project or this vault
	// knows: a note without an identity property is matched to one of those by its
	// path or its bytes, so each must be derived already. Deriving one that has
	// neither a branch nor a send is memory only.
	const known = [
		...docIds,
		...Array.from(snapshot.identities.keys()),
		...Array.from(snapshot.sent.keys()),
		...Array.from(snapshot.branches),
	];
	const documents = new Map<string, DerivedDocument>();
	for (const docId of known) {
		if (documents.has(docId)) {
			continue;
		}
		const derived = await deriveDocument(ctx, snapshot, docId);
		if (!derived.ok) {
			// All or nothing: states derived from part of the data are not shown.
			return derived;
		}
		documents.set(docId, derived.value);
	}
	return {
		ok: true,
		value: {
			defaultBranch: snapshot.defaultBranch,
			index: {
				main: snapshot.main,
				synced: snapshot.synced,
				sentNotes: snapshot.sentNotes,
				identities: snapshot.identities,
			},
			documents,
			updatesAvailable: countDifferences(snapshot.main, snapshot.synced),
			unchanged: unchangedPaths(snapshot.main, snapshot.synced),
		},
	};
}

/**
 * Whether a note has been edited since it was last sent, from its content
 * identifier alone. A document with no known path, or a note whose identifier is
 * not known yet, is not edited: nothing has been established, and reporting an
 * unestablished difference would raise every document at once.
 */
export function isEdited(document: DerivedDocument | null | undefined, noteBlob: string | null): boolean {
	if (document === null || document === undefined || document.remotePath === null || noteBlob === null) {
		return false;
	}
	return !document.accepted.has(noteBlob);
}

/** Who acts next on a listed document; null for a document with no next action. */
export type PanelSection = 'needs-you' | 'waiting-on-reviewers';

/**
 * Which section a document is listed in. Needs the author: not accepted, edited
 * since it was last sent, or not derived yet (putting it under "Waiting on
 * reviewers" would assert a review nothing established). Waiting on reviewers:
 * under review and untouched. A published, untouched document has no next
 * action and is not listed, unless it has been moved: the project still holds
 * it at the old path until the author submits it where it now is.
 */
export function panelSectionFor(state: DocumentState | null, edited: boolean, moved = false): PanelSection | null {
	if (state === null || state === 'closed' || edited || (moved && state === 'published')) {
		return 'needs-you';
	}
	return state === 'pending' ? 'waiting-on-reviewers' : null;
}
