import { deriveDocIdFromPath } from '../doc-authoring/doc-id';
import { isValidRefPart } from '../git-publishing/ref-names';
import { matchMoved } from '../vault-sync/moved-notes';
import type { DerivedStates, ResolutionIndex } from './derive-state';

/**
 * Which document a note belongs to, worked out from what git knows and nothing
 * the note has to carry (panel-by-path-without-doc-id design.md D1).
 *
 * In a fixed order, and the first step that yields exactly one document wins:
 *
 * 1. a legacy `doc_id` in the note, which is never rewritten or removed;
 * 2. the project's file at the note's own path, on the fetched default branch or
 *    in the last synced version;
 * 3. the document whose last send from this vault carried the note's path;
 * 4. exact bytes: a version this vault knows (synced, default branch, last sent)
 *    at a path the vault no longer has, equal to the note's. Never similarity,
 *    because a wrong guess ties a note to someone else's review.
 *
 * Two candidates at a step yield none, and none stops the search: a note that
 * could be either of two documents is listed as neither. For the same reason a
 * note whose exact bytes sit in the vault twice is matched to nothing, since
 * which of the two copies is the moved one cannot be told.
 *
 * Pure, over what the last derivation read, so the panel can resolve every note
 * on every draw without starting a process.
 */
export interface NoteToResolve {
	/** The note's path in the vault. */
	path: string;
	/** Its content identifier; null while not yet known, which step 4 cannot use. */
	blob: string | null;
	/** The `doc_id` in its front matter, where there is one. */
	legacyDocId: string | null;
}

export type ResolvedVia = 'doc-id' | 'project-path' | 'send-record' | 'content';

export interface ResolvedNote {
	docId: string;
	via: ResolvedVia;
	/** The note is not where the document is: it was moved or renamed, and its bytes may not have changed. */
	moved: boolean;
}

/** Whether the project holds a file at this path, as last fetched or last synced. */
export function isOnProject(index: ResolutionIndex, path: string): boolean {
	return index.main.has(path) || (index.synced !== null && index.synced.has(path));
}

/** The document a project path belongs to: the one its file name derives, unless two paths derive the same. */
function documentAtPath(states: Pick<DerivedStates, 'documents' | 'index'>, path: string): string | null {
	if (!/\.md$/i.test(path)) {
		return null;
	}
	const docId = deriveDocIdFromPath(path);
	if (docId === null || !isValidRefPart(docId) || !states.documents.has(docId)) {
		return null;
	}
	// A document is at one path. Two paths deriving one identity is the case
	// docs/document-naming.md forbids, and which is "the" document cannot be told.
	return (states.index.identities.get(docId) ?? []).length > 1 ? null : docId;
}

function documentSentFrom(index: ResolutionIndex, path: string): string[] {
	const owners: string[] = [];
	index.sentNotes.forEach((note, docId) => {
		if (note.path === path) {
			owners.push(docId);
		}
	});
	return owners;
}

/** Every absent path, per known version, with the document it belongs to. */
function absentVersions(index: ResolutionIndex, vaultPaths: ReadonlySet<string>): Array<Map<string, string>> {
	const absent = (files: ReadonlyMap<string, string> | null): Map<string, string> => {
		const result = new Map<string, string>();
		files?.forEach((blob, path) => {
			if (/\.md$/i.test(path) && !vaultPaths.has(path)) {
				result.set(path, blob);
			}
		});
		return result;
	};
	const sent = new Map<string, string>();
	index.sentNotes.forEach((note) => {
		if (!vaultPaths.has(note.path)) {
			sent.set(note.path, note.blob);
		}
	});
	return [absent(index.main), absent(index.synced), sent];
}

/**
 * Every note that resolves to a document, by path. A note that resolves to none
 * is not in the result.
 *
 * @param vaultPaths every path in the vault, so "absent" means absent from the vault
 */
export function resolveNotes(
	states: Pick<DerivedStates, 'documents' | 'index'>,
	notes: readonly NoteToResolve[],
	vaultPaths: ReadonlySet<string>
): Map<string, ResolvedNote> {
	const { index } = states;
	const resolved = new Map<string, ResolvedNote>();
	const needContent: NoteToResolve[] = [];

	for (const note of notes) {
		if (note.legacyDocId !== null) {
			const remote = states.documents.get(note.legacyDocId)?.remotePath ?? null;
			resolved.set(note.path, { docId: note.legacyDocId, via: 'doc-id', moved: remote !== null && remote !== note.path });
			continue;
		}
		if (isOnProject(index, note.path)) {
			const docId = documentAtPath(states, note.path);
			if (docId !== null) {
				resolved.set(note.path, { docId, via: 'project-path', moved: false });
			}
			continue;
		}
		const owners = documentSentFrom(index, note.path);
		if (owners.length > 0) {
			if (owners.length === 1 && states.documents.has(owners[0])) {
				resolved.set(note.path, { docId: owners[0], via: 'send-record', moved: false });
			}
			continue;
		}
		if (note.blob !== null) {
			needContent.push(note);
		}
	}

	if (needContent.length > 0) {
		resolveByContent(states, needContent, vaultPaths, resolved);
	}
	return resolved;
}

function resolveByContent(
	states: Pick<DerivedStates, 'documents' | 'index'>,
	notes: readonly NoteToResolve[],
	vaultPaths: ReadonlySet<string>,
	resolved: Map<string, ResolvedNote>
): void {
	const { index } = states;
	const blobs = notes.map((note) => ({ path: note.path, blob: note.blob ?? '' }));
	const candidates = new Map<string, Set<string>>();
	const claimed = new Map<string, number>();
	for (const absent of absentVersions(index, vaultPaths)) {
		const matches = matchMoved(absent, blobs, index.main);
		matches.byNote.forEach((paths, notePath) => {
			candidates.set(notePath, new Set([...Array.from(candidates.get(notePath) ?? []), ...paths]));
		});
		matches.byAbsent.forEach((notePaths, absentPath) => {
			// The same copies seen through each version are one claim, not several.
			claimed.set(absentPath, Math.max(claimed.get(absentPath) ?? 0, notePaths.length));
		});
	}

	candidates.forEach((absentPaths, notePath) => {
		if (Array.from(absentPaths).some((path) => (claimed.get(path) ?? 0) > 1)) {
			return;
		}
		const documents = new Set<string>();
		absentPaths.forEach((path) => {
			const owners = documentSentFrom(index, path);
			const owner = owners.length > 0 ? owners : [documentAtPath(states, path)];
			owner.forEach((docId) => documents.add(docId ?? ''));
		});
		if (documents.size !== 1) {
			return;
		}
		const [docId] = Array.from(documents);
		if (docId !== '' && states.documents.has(docId)) {
			resolved.set(notePath, { docId, via: 'content', moved: true });
		}
	});
}
