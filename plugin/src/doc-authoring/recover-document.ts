import { Notice } from 'obsidian';
import type { App } from 'obsidian';
import type { ConnectionDetails } from '../git-publishing/gitlab-client';
import type { ConnectionState } from '../platform-config/connection-state';
import { requireAuthoringGate } from './authoring-gate';

/** The action label both entry points to recovery share. */
export const RECOVER_LABEL = 'Recover';

export const RECOVER_OCCUPIED_MESSAGE = 'A note already exists at this location, so nothing was recovered.';

export const RECOVER_FAILED_MESSAGE = 'The document could not be recovered. Try again.';

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
 * Makes no request to the platform — the content is already in hand, read
 * by whichever caller is offering recovery. Returns whether the note was
 * created, so a caller that also needs to update its own bookkeeping (the
 * orphaned-record path backfill, tasks.md 2.5) knows whether to.
 */
export async function recoverDocument(
	app: App,
	details: ConnectionDetails,
	state: ConnectionState,
	path: string,
	content: string
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

	return true;
}
