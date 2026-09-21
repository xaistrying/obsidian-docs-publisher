import { Notice } from 'obsidian';
import type { App } from 'obsidian';
import type { ConnectionDetails } from '../git-publishing/gitlab-client';
import { listRepositoryFiles } from '../git-publishing/gitlab-client';
import type { ConnectionState } from '../platform-config/connection-state';
import { requireAuthoringGate } from './authoring-gate';
import { attachmentReportMessage, bringAttachments } from './fetch-attachments';

/** The action label both entry points to recovery share. */
export const RECOVER_LABEL = 'Recover';

export const RECOVER_OCCUPIED_MESSAGE = 'A note already exists at this location, so nothing was recovered.';

export const RECOVER_FAILED_MESSAGE = 'The document could not be recovered. Try again.';

/**
 * The note came back and its images did not, because the listing they would
 * have been located from could not be read. Says what actually happened —
 * the document IS recovered — rather than reporting a failure the author
 * would read as "nothing happened".
 */
export const RECOVER_ATTACHMENTS_FAILED_MESSAGE =
	"This document came back, but its images couldn't be fetched. Try recovering it again later.";

/**
 * Recreates a note from already-read remote content, at exactly the path
 * that content was read from — never a locally convenient one, and never
 * when a note already occupies that path (design.md decision 3: a recovered
 * note's path is not incidental, and placing it elsewhere would only be
 * refused later by the existing refuse-to-move check).
 *
 * Shared by both entry points recovery has — the panel's orphaned-record
 * list and a submit blocked by the path-collision pre-flight — so pressing
 * Recover means the same thing from either one (tasks.md 3.3).
 *
 * Gated the same way document creation is (`requireAuthoringGate`): this
 * mints a new local note exactly as `createDocument` does, and hiding the
 * control that offers it is never what enforces the gate.
 *
 * Makes no request to the platform FOR THE NOTE — the content is already in
 * hand, read by whichever caller is offering recovery. Returns whether the
 * note was created, so a caller that also needs to update its own
 * bookkeeping (the orphaned-record path backfill, tasks.md 2.5) knows
 * whether to.
 *
 * `ref` is where that content came from, and supplying it is what makes the
 * document's IMAGES come back too (add-discover-and-import, milestone 9a).
 * Recovery restored a note's text alone until 2026-09-14, so every recovered
 * document carrying a picture came back with a broken embed. That fetch does
 * make requests — the repository listing at that ref, then one per
 * attachment — and it runs after the note is written, never before: embed
 * resolution reads what Obsidian recorded for the note, and a note not yet
 * in the vault has nothing recorded.
 *
 * Omitting `ref` recovers the text alone, which is the old behaviour and is
 * left reachable rather than removed: a caller that genuinely does not know
 * which ref its content came from must not guess one, because fetching a
 * document's images from the wrong point in history is worse than not
 * fetching them.
 *
 * A failed attachment never fails the recovery. The note is already in the
 * vault by then, and it is worth more than the pictures.
 */
export async function recoverDocument(
	app: App,
	details: ConnectionDetails,
	state: ConnectionState,
	path: string,
	content: string,
	ref?: string
): Promise<boolean> {
	const gate = requireAuthoringGate(details, state);
	if (gate === null) {
		return false;
	}

	if (app.vault.getAbstractFileByPath(path) !== null) {
		new Notice(RECOVER_OCCUPIED_MESSAGE);
		return false;
	}

	try {
		// The recovered path may nest under folders this vault does not yet
		// have (a document filed deep in the corpus's own hierarchy, never
		// seen locally before). `createFolder` creates every missing
		// intermediate folder, so this is skipped only when the exact target
		// folder already exists — calling it again would throw.
		const folderPath = path.slice(0, path.lastIndexOf('/'));
		if (folderPath !== '' && app.vault.getAbstractFileByPath(folderPath) === null) {
			await app.vault.createFolder(folderPath);
		}

		const file = await app.vault.create(path, content);
		await app.workspace.getLeaf(false).openFile(file);
	} catch {
		new Notice(RECOVER_FAILED_MESSAGE);
		return false;
	}

	if (ref !== undefined) {
		await recoverAttachments(app, details, path, ref);
	}

	return true;
}

/**
 * The images, after the note. Shares `bringAttachments` with Import rather
 * than having a mechanism of its own (tasks.md 4.4) — two would be two
 * chances to get it wrong, and this gap existed in exactly one of them for
 * long enough already.
 *
 * A listing that fails is reported as images that did not arrive, which is
 * what it means here, rather than as a recovery failure: the note is already
 * in the vault and staying there.
 */
async function recoverAttachments(
	app: App,
	details: ConnectionDetails,
	path: string,
	ref: string
): Promise<void> {
	const listing = await listRepositoryFiles(details, ref);
	if (!listing.ok) {
		new Notice(RECOVER_ATTACHMENTS_FAILED_MESSAGE);
		return;
	}

	const report = await bringAttachments(app, details, {
		notePath: path,
		ref,
		remotePaths: listing.value.paths,
	});
	const message = attachmentReportMessage(report);
	if (message !== null) {
		new Notice(message);
	}
}
