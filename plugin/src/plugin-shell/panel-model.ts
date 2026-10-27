import { AUTHOR_MESSAGES, AUTHOR_TEMPLATES } from '../author-messages';
import { filePageUrl, reviewListUrl } from '../git-publishing/project-address';
import type { ProjectAddress } from '../git-publishing/project-address';
import { isValidRefPart } from '../git-publishing/ref-names';
import { isEdited, panelSectionFor } from '../submission-tracking/derive-state';
import type { DerivedDocument, DerivedStates, DocumentState } from '../submission-tracking/derive-state';
import type { RefreshOutcome } from '../submission-tracking/derived-states';
import { isOnProject, resolveNotes } from '../submission-tracking/resolve-notes';
import type { ResolvedNote } from '../submission-tracking/resolve-notes';
import { matchMoved, movedAbsentPaths } from '../vault-sync/moved-notes';

/**
 * What the ready screen shows, decided apart from drawing it
 * (replace-rest-with-local-git-ssh task 2.6).
 *
 * The same reason as the setup view's: this project's `obsidian` stub does not
 * model Obsidian's interface and must not grow to, so a rule that lives inside
 * a `Setting` or a `ButtonComponent` is a rule no test can see. Everything here
 * is a function of plain values.
 */

/** One note in the vault that could matter to the panel: markdown, and not hidden or reserved. */
export interface ListedNote {
	/** The name the author sees. */
	name: string;
	/** The folder it is in, empty at the top of the vault. */
	folder: string;
	path: string;
	/** The note's content identifier as last computed; null while unknown. */
	blob: string | null;
	/** The `doc_id` in its front matter, where an older version of this plugin wrote one. Read as an alias, never required. */
	legacyDocId: string | null;
}

export interface PanelRow {
	docId: string;
	name: string;
	path: string;
	state: DocumentState | null;
	edited: boolean;
	/** The note is not where the document is: it was moved or renamed. */
	moved: boolean;
	/** Where "Open in GitLab" goes; null when there is nothing to open. */
	link: string | null;
}

/** A note that is not on the project and has not been sent from this vault. */
export interface NotSentRow {
	name: string;
	folder: string;
	path: string;
}

export interface PanelModel {
	needsYou: PanelRow[];
	waiting: PanelRow[];
	/** Documents with nothing to do (published, untouched), kept to tell "nothing needs you" from "nothing submitted". */
	settled: number;
	/** Every note that is not on the project and has not been sent: the vault's new files, as git's status would list them. */
	notSent: NotSentRow[];
	/** Every note that was matched to a document, by path; what the open note's own controls are decided from. */
	resolutions: ReadonlyMap<string, ResolvedNote>;
}

export interface DerivedLookup {
	statusFor(docId: string): DerivedDocument | null;
	readonly current: Pick<DerivedStates, 'defaultBranch' | 'documents' | 'index'> | null;
}

/** The label for a state, in the author's words. */
export function stateLabel(state: DocumentState): string {
	switch (state) {
		case 'pending':
			return AUTHOR_MESSAGES.waitingForReview;
		case 'published':
			return AUTHOR_MESSAGES.published;
		case 'closed':
			return AUTHOR_MESSAGES.notAccepted;
	}
}

/**
 * What the open note's send control is called, which depends on where the
 * document stands: a review that is still open takes a revision, and one that is
 * over starts a new round. No state means a first submission.
 */
export function submitLabel(state: DocumentState | null): string {
	switch (state) {
		case 'pending':
			return AUTHOR_MESSAGES.sendUpdate;
		case 'published':
			return AUTHOR_MESSAGES.submitNewVersion;
		case 'closed':
			return AUTHOR_MESSAGES.submitAgain;
		case null:
			return AUTHOR_MESSAGES.submitForReview;
	}
}

/**
 * The page "Open in GitLab" goes to, derived from the project's address and so
 * costing no request: the project's reviews filtered to the document's branch
 * while it is waiting, the document's file on the default branch once
 * published, and nothing for a document with no path and no review.
 */
export function documentLink(address: ProjectAddress | null, document: DerivedDocument | null, defaultBranch: string | null): string | null {
	if (address === null || document === null) {
		return null;
	}
	if (document.state === 'pending' && isValidRefPart(document.docId)) {
		return reviewListUrl(address, document.docId);
	}
	if (document.state === 'published' && document.remotePath !== null && defaultBranch !== null) {
		return filePageUrl(address, defaultBranch, document.remotePath);
	}
	return null;
}

/**
 * Splits the notes by who acts next, each document in exactly one place or none,
 * and sets aside the notes that are not on the project.
 *
 * A note is matched to its document by `resolveNotes`, from what the last
 * derivation read, so this draws without starting a process. Until something has
 * been derived no note outside the legacy `doc_id` case can be matched, and
 * saying such a note was never sent would assert something nothing established,
 * so none is listed as not sent.
 *
 * @param vaultPaths every path in the vault, so a path is "absent" only when the vault lacks it
 */
export function buildPanelModel(
	notes: readonly ListedNote[],
	derived: DerivedLookup,
	address: ProjectAddress | null,
	vaultPaths: ReadonlySet<string> = new Set(notes.map((note) => note.path))
): PanelModel {
	const current = derived.current;
	const defaultBranch = current === null ? null : current.defaultBranch;
	const resolved =
		current === null
			? new Map<string, ResolvedNote>()
			: resolveNotes(current, notes.map((note) => ({ path: note.path, blob: note.blob, legacyDocId: note.legacyDocId })), vaultPaths);
	const model: PanelModel = { needsYou: [], waiting: [], settled: 0, notSent: [], resolutions: resolved };
	for (const note of notes) {
		const match = resolved.get(note.path);
		if (match === undefined) {
			// Without a derivation, only a note with an identity property is known to be anything.
			if (note.legacyDocId !== null) {
				model.needsYou.push(unknownRow(note.legacyDocId, note));
			} else if (current !== null && !isOnProject(current.index, note.path)) {
				model.notSent.push({ name: note.name, folder: note.folder, path: note.path });
			}
			continue;
		}
		const document = derived.statusFor(match.docId);
		const state = document === null ? null : document.state;
		const edited = isEdited(document, note.blob);
		const row: PanelRow = {
			docId: match.docId,
			name: note.name,
			path: note.path,
			state,
			edited,
			moved: match.moved,
			link: documentLink(address, document, defaultBranch),
		};
		const section = panelSectionFor(state, edited, match.moved);
		if (section === 'needs-you') {
			model.needsYou.push(row);
		} else if (section === 'waiting-on-reviewers') {
			model.waiting.push(row);
		} else {
			model.settled += 1;
		}
	}
	model.notSent.sort((a, b) => a.path.localeCompare(b.path));
	return model;
}

/** A note that names a document nothing has been derived for: its name, and no state. */
function unknownRow(docId: string, note: ListedNote): PanelRow {
	return { docId, name: note.name, path: note.path, state: null, edited: false, moved: false, link: null };
}

/**
 * How many updates are waiting: the files the project changed, and the files it
 * has unchanged that this vault no longer holds, which come back. A file whose
 * exact bytes sit in the vault at a path the project lacks was moved, and Get
 * updates does not bring it back, so it is not counted: the same matcher decides
 * both. Only notes whose identifier is known can be matched, so a moved image is
 * still counted until Get updates leaves it alone. Null before anything has been derived.
 */
export function waitingUpdates(
	states: Pick<DerivedStates, 'updatesAvailable' | 'unchanged' | 'index'> | null,
	vaultPaths: ReadonlySet<string>,
	identified: ReadonlyArray<{ path: string; blob: string }>
): number | null {
	if (states === null) {
		return null;
	}
	const held = new Set(Array.from(vaultPaths, (path) => path.toLowerCase()));
	const absent = new Map<string, string>();
	for (const path of states.unchanged) {
		if (!held.has(path.toLowerCase())) {
			absent.set(path, states.index.main.get(path) ?? '');
		}
	}
	const moved = movedAbsentPaths(matchMoved(absent, identified, states.index.main));
	return states.updatesAvailable + absent.size - moved.size;
}

export type ProjectChangeKind = 'added' | 'changed' | 'removed' | 'deleted-here';

/** One file Get updates would act on: its path, and what it would do. */
export interface ProjectRow {
	path: string;
	kind: ProjectChangeKind;
}

/**
 * The files Get updates would act on, by name: what the project added, changed or
 * removed since the last update, and the files it has unchanged that this vault
 * no longer holds (deleted here, so they come back). A moved note is left out
 * for the reason `waitingUpdates` gives, and the same matcher decides it. Sorted
 * by path. Null before anything has been derived.
 */
export function projectChanges(
	states: Pick<DerivedStates, 'unchanged' | 'index'> | null,
	vaultPaths: ReadonlySet<string>,
	identified: ReadonlyArray<{ path: string; blob: string }>
): ProjectRow[] | null {
	if (states === null) {
		return null;
	}
	const { main, synced } = states.index;
	const rows: ProjectRow[] = [];
	if (synced !== null) {
		main.forEach((blob, path) => {
			const before = synced.get(path);
			if (before === undefined) {
				rows.push({ path, kind: 'added' });
			} else if (before !== blob) {
				rows.push({ path, kind: 'changed' });
			}
		});
		synced.forEach((_blob, path) => {
			if (!main.has(path)) {
				rows.push({ path, kind: 'removed' });
			}
		});
	}
	const held = new Set(Array.from(vaultPaths, (path) => path.toLowerCase()));
	const absent = new Map<string, string>();
	for (const path of states.unchanged) {
		if (!held.has(path.toLowerCase())) {
			absent.set(path, main.get(path) ?? '');
		}
	}
	const moved = movedAbsentPaths(matchMoved(absent, identified, main));
	absent.forEach((_blob, path) => {
		if (!moved.has(path)) {
			rows.push({ path, kind: 'deleted-here' });
		}
	});
	return rows.sort((a, b) => a.path.localeCompare(b.path));
}

/** The label for what Get updates would do with a file, in the author's words. */
export function projectChangeLabel(kind: ProjectChangeKind): string {
	switch (kind) {
		case 'added':
			return AUTHOR_MESSAGES.projectAdded;
		case 'changed':
			return AUTHOR_MESSAGES.projectChanged;
		case 'removed':
			return AUTHOR_MESSAGES.projectRemoved;
		case 'deleted-here':
			return AUTHOR_MESSAGES.projectDeletedHere;
	}
}

/**
 * What a section's heading says beside its title. A failed check says so
 * rather than a count that might be stale; otherwise the count, always, since it
 * describes the list on screen and nothing more.
 */
export function sectionSuffix(outcome: RefreshOutcome['kind'], count: number): string {
	return outcome === 'failed' ? AUTHOR_MESSAGES.checkFailedSuffix : String(count);
}

/** The line about the last refresh, or null when it went well or has not run. */
export function refreshNotice(outcome: RefreshOutcome): string | null {
	return outcome.kind === 'failed' ? AUTHOR_MESSAGES.refreshFailed : null;
}

/**
 * The one-line summary of what the project has changed since the vault last
 * synced, in the four cases the spec names. A count shows only when a fetch made
 * in this session has answered: states read from the copy fetched last session
 * are enough to draw the list, but not to say "you have the latest documents".
 */
export function updatesLine(updatesAvailable: number | null, outcome: RefreshOutcome): string {
	if (outcome.kind === 'failed') {
		return AUTHOR_MESSAGES.updatesCheckFailed;
	}
	if (outcome.kind !== 'succeeded' || updatesAvailable === null) {
		return AUTHOR_MESSAGES.updatesNotChecked;
	}
	return updatesAvailable === 0 ? AUTHOR_MESSAGES.latestDocuments : AUTHOR_TEMPLATES.updatesAvailable(updatesAvailable);
}

/** What the banner under the header says in one word, which picks its colour and icon. */
export type BannerKind = 'latest' | 'waiting' | 'failed' | 'unchecked';

/** The banner's condition, from the same two answers `updatesLine` words. */
export function bannerKind(updatesAvailable: number | null, outcome: RefreshOutcome): BannerKind {
	if (outcome.kind === 'failed') {
		return 'failed';
	}
	if (outcome.kind !== 'succeeded' || updatesAvailable === null) {
		return 'unchecked';
	}
	return updatesAvailable === 0 ? 'latest' : 'waiting';
}

/**
 * Two letters for the avatar: the first letters of the first two parts of the
 * name ("pham.ngoc.trai" gives PN), or the first two letters of a one-part name.
 * A name with nothing in it that can be a letter gives "?".
 */
export function initialsOf(name: string): string {
	const parts = name.split(/[^\p{L}\p{N}]+/u).filter((part) => part !== '');
	if (parts.length === 0) {
		return '?';
	}
	const letters = parts.length === 1 ? Array.from(parts[0]).slice(0, 2) : [Array.from(parts[0])[0], Array.from(parts[1])[0]];
	return letters.join('').toUpperCase();
}

/** The empty state of "Needs you": nothing submitted at all, or nothing owed. */
export function needsYouEmpty(model: Pick<PanelModel, 'needsYou' | 'waiting' | 'settled'>): string {
	return model.waiting.length + model.settled === 0 ? AUTHOR_MESSAGES.noDocuments : AUTHOR_MESSAGES.nothingNeedsYou;
}
