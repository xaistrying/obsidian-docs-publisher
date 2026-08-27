import { Notice, normalizePath } from 'obsidian';
import type { App, TFile, TFolder } from 'obsidian';
import type { ConnectionDetails } from '../git-publishing/gitlab-client';
import { NO_DOCUMENT_ACCESS_MESSAGE, readOnlyMessage } from '../platform-config/access-messages';
import { MISSING_DETAILS_MESSAGE, hasConnectionDetails } from '../platform-config/connection';
import type { ConnectionState } from '../platform-config/connection-state';
import { grantsAuthoring, grantsReadOnly } from '../platform-config/connection-state';
import { composeFrontMatter } from './front-matter';

export const UNCHECKED_CONNECTION_MESSAGE =
	"Test your connection in the plugin's settings before creating a document.";

export const CREATE_FAILED_MESSAGE = 'The document could not be created. Try again.';

/**
 * The default name. The space is deliberate and must not be tidied into
 * `untitled-document`: beyond matching Obsidian's own convention, a space is
 * illegal in a git ref, so a default that survived to a first submit is refused
 * there rather than frozen as a permanent `doc_id`.
 */
const DEFAULT_BASE_NAME = 'Untitled document';

/**
 * Creates one document and opens it, or refuses and creates nothing.
 *
 * Every entry point comes through here — the panel control and the command
 * palette both — so neither can behave differently from the other, and hiding
 * a control is never what enforces the gate.
 *
 * Makes no request to the platform: the identity comes from the connection
 * result the session already retains, so this works with the network down and
 * `git-publishing` stays the sole owner of remote access.
 */
export async function createDocument(
	app: App,
	details: ConnectionDetails,
	state: ConnectionState
): Promise<void> {
	const username = authoringUsername(details, state);
	if (username === null) {
		return;
	}

	// The folder Obsidian itself would use for a new note, honouring the
	// vault's "Default location for new notes". Passing the active file's path
	// is what makes "same folder as current file" work; the empty string is the
	// documented value for "nothing is open".
	const activeFile = app.workspace.getActiveFile();
	const parent = app.fileManager.getNewFileParent(activeFile === null ? '' : activeFile.path);

	const path = freePath(app, parent, DEFAULT_BASE_NAME);
	const content = composeFrontMatter(username, new Date());

	let file: TFile;
	try {
		// Content and creation are one call, so a rejected path leaves no
		// partial note behind. The probe above is not atomic — a sync client
		// can land a file in between — which is why this is guarded at all.
		file = await app.vault.create(path, `${content}\n`);
	} catch {
		new Notice(CREATE_FAILED_MESSAGE);
		return;
	}

	await app.workspace.getLeaf(false).openFile(file);
}

/**
 * The gate, in the order the author's next action changes: details they never
 * entered, a check they never ran, then a role that cannot author.
 *
 * Returns the username to write as `owner` when all three pass, and otherwise
 * says what to do next and returns null so the caller stops before touching
 * the vault.
 */
function authoringUsername(details: ConnectionDetails, state: ConnectionState): string | null {
	if (!hasConnectionDetails(details)) {
		new Notice(MISSING_DETAILS_MESSAGE);
		return null;
	}

	// Anything that is not a succeeded check: never run, still running, failed,
	// or discarded because a detail was edited. The author's next step is the
	// same in each, and no check is started on their behalf here.
	if (state.kind !== 'verified') {
		new Notice(UNCHECKED_CONNECTION_MESSAGE);
		return null;
	}

	if (!grantsAuthoring(state)) {
		new Notice(
			grantsReadOnly(state)
				? readOnlyMessage(state.access.accessLabel)
				: NO_DOCUMENT_ACCESS_MESSAGE
		);
		return null;
	}

	// The username as the platform reports it — never the display name or the
	// local part of an email address.
	return state.identity.username;
}

/**
 * The first free path from the base name, appending ` 1`, ` 2`, … as Obsidian
 * does. Terminates: each turn tests a different path and the vault holds
 * finitely many files, so a free one is always reached.
 *
 * Done here because `fileManager.createNewMarkdownFile`, which would handle
 * uniqueness for us, is absent from the `obsidian@1.13.1` typings.
 */
function freePath(app: App, parent: TFolder, baseName: string): string {
	for (let suffix = 0; ; suffix++) {
		const name = suffix === 0 ? baseName : `${baseName} ${suffix}`;
		// normalizePath collapses the double slash the root folder's own path
		// would otherwise introduce.
		const path = normalizePath(`${parent.path}/${name}.md`);
		if (app.vault.getAbstractFileByPath(path) === null) {
			return path;
		}
	}
}
