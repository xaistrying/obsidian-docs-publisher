import { Notice, normalizePath } from 'obsidian';
import type { App, TFile, TFolder } from 'obsidian';
import { AUTHOR_MESSAGES } from '../author-messages';
import { GITLAB_USERNAME } from '../git-publishing/project-address';
import { composeFrontMatter } from './front-matter';

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
 * a control is never what enforces the gate. The gate itself, that setup is
 * complete, is the caller's, and is checked first.
 *
 * Makes no request and starts no process: the owner is the username the last
 * successful key test reported (or the author typed), remembered from an
 * earlier session, so this works with the network down.
 */
export async function createDocument(app: App, owner: string): Promise<void> {
	// Written into front matter unquoted, so only what GitLab allows in a
	// username may go there. A name that fails this came from a hand-edited
	// settings file, and is refused rather than repaired.
	if (!GITLAB_USERNAME.test(owner)) {
		new Notice(AUTHOR_MESSAGES.notReady);
		return;
	}
	const username = owner;

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
