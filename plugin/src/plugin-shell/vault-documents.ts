import type { App, TFile } from 'obsidian';
import { isCandidateNote } from '../submission-tracking/note-identities';
import { readDocId } from '../submission-tracking/resolve';

/** One note in the vault that carries a `doc_id`, paired with that `doc_id`. */
export interface VaultDocument {
	file: TFile;
	docId: string;
}

/**
 * Every markdown note in the vault whose front matter carries a `doc_id`,
 * sorted by the name the author sees.
 *
 * Only the older notes carry one, since Submit no longer writes it: it is read
 * as an alias for the identity a note would otherwise be matched to by git, and
 * is what the derivation is told to look up before the vault's own notes are
 * considered. Everything else is a document by `listCandidateNotes` and
 * `resolveNotes`.
 */
export function listVaultDocuments(app: App): VaultDocument[] {
	const documents: VaultDocument[] = [];
	for (const file of app.vault.getMarkdownFiles()) {
		const docId = readDocId(app, file);
		if (docId !== null) {
			documents.push({ file, docId });
		}
	}
	return documents.sort((a, b) => a.file.basename.localeCompare(b.file.basename));
}

/** A note that could matter to the panel, with the one thing only the front matter says about it. */
export interface CandidateNote {
	file: TFile;
	/** The `doc_id` in the front matter, where there is one. */
	legacyDocId: string | null;
}

/**
 * Every markdown note the panel could say something about: not under a hidden
 * folder and not under the settings or repository folders
 * (panel-by-path-without-doc-id design.md D5, D6). Nothing is opened: what is
 * read about each note comes from Obsidian's metadata cache.
 */
export function listCandidateNotes(app: App): CandidateNote[] {
	const notes: CandidateNote[] = [];
	for (const file of app.vault.getMarkdownFiles()) {
		if (isCandidateNote(file.path)) {
			notes.push({ file, legacyDocId: readDocId(app, file) });
		}
	}
	return notes.sort((a, b) => a.file.path.localeCompare(b.file.path));
}
