import type { App } from 'obsidian';
import type { ConnectionDetails } from '../git-publishing/gitlab-client';
import type { ConnectionState } from '../platform-config/connection-state';
import type { DiscoverableDocument } from '../submission-tracking/discover';
import { listVaultDocuments } from '../submission-tracking/document-status';
import { requireAuthoringGate } from './authoring-gate';
import { deriveDocIdFromPath } from './doc-id';
import type { AttachmentFetchReport } from './fetch-attachments';
import { bringAttachments } from './fetch-attachments';
import { readContentDocId, withDocId } from './front-matter';

/** The action label the panel's two import controls share. */
export const IMPORT_LABEL = 'Import';
export const IMPORT_ALL_LABEL = 'Import all';

export const IMPORT_OCCUPIED_MESSAGE = 'A note already exists at this location, so nothing was imported.';

export const IMPORT_FAILED_MESSAGE = 'The document could not be imported. Try again.';

/**
 * Two documents whose IDs collide, said WITHOUT asserting which case it is.
 *
 * CORRECTED 2026-09-15, after the first real "import all" (§E6): this used to
 * say "Another note in this vault is already this document", which is often
 * FALSE. A document ID is derived from the filename alone, so
 * `Products/Barcode-Scanner/README.md` and
 * `Products/Back-Office-Administration/README.md` are two entirely different
 * documents that derive one ID — and telling the author they are the same
 * document sends them to look for a duplicate that does not exist.
 *
 * The two cases the plugin genuinely cannot tell apart from here:
 *
 * - the vault holds THIS document, moved to another folder; or
 * - the vault holds a DIFFERENT document whose filename derives the same ID.
 *
 * So the message states the fact that holds in both — one ID, two documents,
 * and which note already has it — and names the only fix that works for
 * either, which is a rename on the platform rather than anything local.
 *
 * Vocabulary-checked like every other author-facing string here: no "branch",
 * "commit", "merge request", "MR", or "main". "Document ID" is the
 * established author-facing name for `doc_id`.
 */
export function importDuplicateMessage(docId: string, otherPath: string): string {
	return (
		`The document ID "${docId}" is already used by ${otherPath}. ` +
		'Two documents cannot share one, so this was not imported. ' +
		'Ask whoever publishes it to give it a name of its own.'
	);
}

/**
 * A remote filename that cannot become a document ID. Not something the
 * author can fix locally — the name lives on the platform — so this says who
 * can, rather than offering a rename the author cannot perform from here.
 *
 * CORRECTED 2026-09-15: this said "without spaces or punctuation", which
 * over-restricts. Punctuation is mostly fine — parentheses, `&`, `#` and `_`
 * all pass — and both real refusals observed (§E6) were caused by a SPACE
 * alone, in names that were otherwise legal. Telling an author to strip
 * punctuation sends them to change what was never the problem. The rule is
 * named exactly instead; see `deriveDocId` and `docs/document-naming.md` §3.
 */
export function importUnusableNameMessage(): string {
	return (
		"This document's name can't be used as a document ID. " +
		'Ask whoever publishes it to rename it without spaces, and without ' +
		'any of ~ ^ : ? * [ \\'
	);
}

/**
 * One import's result, per document, so a batch can report every outcome
 * rather than stopping at the first refusal (tasks.md 5.4). `reason` is
 * already author-facing copy — the caller shows it, it does not translate
 * it.
 */
export type ImportOutcome =
	| { ok: true; path: string; attachments: AttachmentFetchReport }
	| { ok: false; path: string; reason: string };

/**
 * Writes one discovered document into the vault, at exactly the path it
 * occupies on the remote, with `doc_id` frozen into its front matter.
 *
 * THE PATH IS THE REMOTE'S, never a locally convenient one and never the
 * milestone-3a default directory for new documents — nothing on this path
 * reads that setting, and that is the requirement rather than an oversight.
 * A brand-new document has no identity yet and may go anywhere; an imported
 * document's path is already half of its identity
 * (`docs/document-identity.md` §4), and placing it elsewhere would only be
 * refused later by refuse-to-move. Same rule, same reason, as
 * `recoverDocument`.
 *
 * FREEZING `doc_id` HERE is the amendment this change makes to
 * `docs/document-identity.md` §3, and it is what makes an imported document
 * submittable at all. Without it the first submit takes the FIRST-submit
 * path, where `checkTargetPathFree` refuses — a file does exist at the
 * document's path on the default branch, by construction, for every imported
 * document (`docs/ce-verification.md` §E3). With it, the submit resolves as
 * a resubmission, that check never runs, and the commit verb is read rather
 * than assumed. The §3 freedom this appears to take away does not exist for
 * an imported document: its name and path were decided by whoever published
 * it, and refuse-to-move already forbids changing them.
 *
 * WRITES NO `SubmissionRecord`. `doc_id` in front matter is the identity;
 * the store is a cache of what the remote said, and an imported document has
 * no submission of its own for a record to describe. Reconciliation resolves
 * it from front matter on the next refresh (design.md decision 2).
 *
 * Gated the same way creating and recovering are: this mints a new local
 * note exactly as they do, and hiding the control that offers it is never
 * what enforces the gate.
 *
 * Returns the outcome instead of only announcing it, because "import all"
 * must continue past a refusal and report each one.
 */
export async function importDocument(
	app: App,
	details: ConnectionDetails,
	state: ConnectionState,
	document: DiscoverableDocument,
	source: { ref: string; remotePaths: readonly string[] }
): Promise<ImportOutcome> {
	const gate = requireAuthoringGate(details, state);
	if (gate === null) {
		// The gate has already said what to do next; nothing to add.
		return { ok: false, path: document.path, reason: '' };
	}

	// A document this plugin published already carries its own frozen
	// `doc_id`, and that value — not a fresh derivation — is its identity.
	// Deriving over the top would be a second birth for an identity that
	// already has one, and would write a duplicate key into the block.
	const existing = readContentDocId(document.content);
	const docId = existing ?? deriveDocIdFromPath(document.path);
	if (docId === null) {
		return { ok: false, path: document.path, reason: importUnusableNameMessage() };
	}

	// Both refusals run BEFORE anything is written, and both are purely
	// local. The duplicate check is the one `docs/panel-tracking-scope.md`
	// flagged as missing at import: today it exists only at submit, which is
	// far too late for a collision created by the import itself.
	const duplicate = findNoteWithDocId(app, docId);
	if (duplicate !== null) {
		return { ok: false, path: document.path, reason: importDuplicateMessage(docId, duplicate) };
	}

	if (app.vault.getAbstractFileByPath(document.path) !== null) {
		return { ok: false, path: document.path, reason: IMPORT_OCCUPIED_MESSAGE };
	}

	const content = existing === null ? withDocId(document.content, docId) : document.content;

	try {
		// The remote path may nest under folders this vault does not yet have.
		// `createFolder` creates every missing intermediate one, so this is
		// skipped only when the exact target folder already exists — calling it
		// again would throw. Same shape as `recoverDocument`.
		const folderPath = document.path.slice(0, document.path.lastIndexOf('/'));
		if (folderPath !== '' && app.vault.getAbstractFileByPath(folderPath) === null) {
			await app.vault.createFolder(folderPath);
		}

		await app.vault.create(document.path, content);
	} catch (error) {
		console.error(`Docs Publisher: could not import ${document.path}.`, error);
		return { ok: false, path: document.path, reason: IMPORT_FAILED_MESSAGE };
	}

	// The images, after the note and never before it: embed resolution reads
	// what Obsidian recorded for the note, and a note not yet in the vault has
	// nothing recorded (design.md decision 3). Resolved against the SAME
	// listing discovery was built from, so "import all" pays for one tree read
	// rather than one per document.
	//
	// Nothing here can fail the import. Between the note landing and this
	// finishing the document exists with embeds that do not resolve; if the
	// fetch does not complete, the note stays and its pictures do not, which
	// is the right failure and is reported rather than silent.
	const attachments = await bringAttachments(app, details, {
		notePath: document.path,
		ref: source.ref,
		remotePaths: source.remotePaths,
	});

	// Deliberately does NOT open the imported note. "Import all" over a
	// corpus would otherwise open thirty editor tabs, and a single import
	// behaving differently from a batch would be two mechanisms where the
	// point of this one is that there is one. The note is in the vault and
	// the panel's own list is where the author sees that.
	return { ok: true, path: document.path, attachments };
}

/**
 * The path of any note in the vault already claiming `docId`, or null.
 *
 * Reads the same vault-wide front-matter scan `findDuplicateNote` in
 * `submit-document.ts` does, and for its reason: a note carrying a `doc_id`
 * may have no stored record at all, which is exactly the case worth
 * catching. Takes no note to exclude, unlike that one — nothing has been
 * written yet, so every match is somebody else.
 */
function findNoteWithDocId(app: App, docId: string): string | null {
	for (const entry of listVaultDocuments(app)) {
		if (entry.docId === docId) {
			return entry.file.path;
		}
	}

	return null;
}

