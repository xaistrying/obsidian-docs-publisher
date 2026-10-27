import type { App, TFile } from 'obsidian';

/**
 * The one way the plugin reads a note's frozen `doc_id`: from its own front
 * matter, never from the note's current or original path. A document's path may
 * change after its first send while its `doc_id` does not
 * (`docs/document-identity.md` §1 and §3).
 *
 * Exported because the panel, Reset and Send all ask the same question of a
 * note, and two readers of one field would be two places for that rule to
 * diverge.
 */
export function readDocId(app: App, file: TFile): string | null {
	const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
	const docId = frontmatter?.['doc_id'];
	return typeof docId === 'string' && docId.trim() !== '' ? docId : null;
}
