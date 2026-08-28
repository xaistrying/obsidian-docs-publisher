import type { App, TFile } from 'obsidian';
import type { SubmissionRecord } from './submission-record';
import type { SubmissionStore } from './submission-store';

/**
 * Resolves a note's tracking record by reading `doc_id` from its own front
 * matter — never from the note's current or original file path.
 * `docs/document-identity.md` §2-3: a document's path may change after its
 * first submit while `doc_id` does not, and reading front matter is the
 * same approach reconciliation uses one layer earlier.
 *
 * Returns null both when the note has no `doc_id` yet (never submitted) and
 * when a `doc_id` is present but no record matches it — this milestone does
 * not distinguish those two cases.
 */
export function resolveSubmissionRecord(
	app: App,
	store: SubmissionStore,
	file: TFile
): SubmissionRecord | null {
	const docId = readDocId(app, file);
	if (docId === null) {
		return null;
	}

	return store.get(docId) ?? null;
}

function readDocId(app: App, file: TFile): string | null {
	const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
	const docId = frontmatter?.['doc_id'];
	return typeof docId === 'string' && docId.trim() !== '' ? docId : null;
}
