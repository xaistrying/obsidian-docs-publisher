/**
 * The two adapters that back `embeds.ts` and `submission-files.ts` with the
 * real Obsidian and the real remote.
 *
 * Everything Obsidian-shaped about attachments lives HERE, which is what
 * keeps those two modules free of `App` and therefore testable at all
 * (design.md decisions 2 and 5). Nothing in this file is tested, and that is
 * the trade being made deliberately: it is adapter code with no rule in it,
 * so the only thing a test over a stubbed Obsidian could establish is that
 * this file calls the methods it visibly calls.
 */

import { arrayBufferToBase64, base64ToArrayBuffer, normalizePath } from 'obsidian';
import type { App } from 'obsidian';
import type { ClientResult, ConnectionDetails, FileCommitId } from '../git-publishing/gitlab-client';
import { getFileBytes, getFileCommitId } from '../git-publishing/gitlab-client';
import type { VaultEmbedIndex } from './embeds';
import type { AttachmentSource } from './fetch-attachments';
import type { SubmissionFileReads } from './submission-files';

/**
 * The vault's own answers to the three questions embed resolution asks.
 *
 * `getFirstLinkpathDest` is Obsidian's own resolver and is used rather than
 * anything that matches a filename out of the note's text — it is the only
 * thing that knows the shortest-path rule, which is what decides WHICH
 * `diagram.png` a note means when two folders hold one.
 */
export function vaultEmbedIndex(app: App): VaultEmbedIndex {
	return {
		embedsFor: (notePath) => app.metadataCache.getCache(notePath)?.embeds ?? [],
		resolveLinkpath: (linkpath, fromNotePath) =>
			app.metadataCache.getFirstLinkpathDest(linkpath, fromNotePath)?.path ?? null,
		fileAt: (path) => app.vault.getFileByPath(normalizePath(path))?.path ?? null,
	};
}

/**
 * The bytes and the verbs, bound to one `ref` — the branch the commit is
 * actually going to. Binding the ref here rather than passing it per call is
 * what stops a caller reading one file's verb against the default branch and
 * another's against the document's own branch, which would produce a commit
 * whose guards refer to two different points in history.
 */
export function submissionFileReads(app: App, details: ConnectionDetails, ref: string): SubmissionFileReads {
	return {
		readAttachment: (path) => readAttachmentBytes(app, path),
		commitIdAt: (path): Promise<ClientResult<FileCommitId>> => getFileCommitId(details, { path, ref }),
	};
}

/**
 * An attachment as base64, or null when the vault cannot produce it.
 *
 * Goes through Obsidian's own `arrayBufferToBase64` rather than a hand-rolled
 * loop over the bytes: the obvious hand-rolled form
 * (`String.fromCharCode.apply(null, bytes)`) overflows the call stack on a
 * file of any real size, which for a screenshot is not a theoretical bound.
 *
 * Null rather than a throw on every failure, because the caller's answer to
 * all of them is the same — skip this file and submit the document without it
 * (`SubmissionFileReads.readAttachment`).
 */
async function readAttachmentBytes(app: App, path: string): Promise<string | null> {
	const file = app.vault.getFileByPath(normalizePath(path));
	if (file === null) {
		return null;
	}

	try {
		return arrayBufferToBase64(await app.vault.readBinary(file));
	} catch (error) {
		console.error(`Docs Publisher: could not read ${path} to submit it.`, error);
		return null;
	}
}

/**
 * The four answers `fetchDocumentAttachments` needs, bound to the ref the
 * note came from — the read-side counterpart of `submissionFileReads` above,
 * and bound for the same reason: every file of one document must come from
 * one point in history.
 *
 * `embedsFor` is the SAME read `vaultEmbedIndex` makes. Only the other two
 * questions differ, which is the whole point — see `fetch-attachments.ts`.
 */
export function attachmentSource(app: App, details: ConnectionDetails, ref: string): AttachmentSource {
	return {
		embedsFor: (notePath) => app.metadataCache.getCache(notePath)?.embeds ?? [],
		heldInVault: (path) => app.vault.getAbstractFileByPath(normalizePath(path)) !== null,
		readRemote: (path) => getFileBytes(details, { path, ref }),
		write: (path, base64) => writeAttachmentBytes(app, path, base64),
	};
}

/**
 * Writes one attachment's bytes into the vault, creating the folders its
 * remote path nests under.
 *
 * `createBinary`, never `create`: an image written through the text path
 * arrives corrupted, which is the read-side twin of the encoding rule
 * `buildSubmissionFiles` follows going the other way.
 *
 * False rather than a throw on every failure, because the caller's answer to
 * all of them is the same — report this one attachment and carry on with the
 * rest of the document.
 */
async function writeAttachmentBytes(app: App, path: string, base64: string): Promise<boolean> {
	try {
		const folderPath = path.slice(0, path.lastIndexOf('/'));
		if (folderPath !== '' && app.vault.getAbstractFileByPath(folderPath) === null) {
			await app.vault.createFolder(folderPath);
		}

		await app.vault.createBinary(path, base64ToArrayBuffer(base64));
		return true;
	} catch (error) {
		console.error(`Docs Publisher: could not write ${path} into the vault.`, error);
		return false;
	}
}

/** How long to wait for Obsidian to parse a note before giving up on it. */
const INDEX_WAIT_MS = 2000;

/**
 * Waits until Obsidian has parsed the note just written, so its embeds are
 * in the metadata cache to be read.
 *
 * THE ORDERING DEPENDENCY design.md decision 3 names, made explicit: embed
 * resolution reads what Obsidian recorded for the note, and `vault.create`
 * resolves when the file is written rather than when it has been parsed.
 *
 * Resolves on the cache event for that file, or on the timeout, and then
 * lets the caller read whatever the cache holds. Both exits are the same
 * exit deliberately: the timeout is not an error, it is the point at which
 * waiting longer stops being worth it, and a note whose embeds are not
 * recorded by then simply resolves to no attachments — the same outcome as a
 * note with none.
 */
export async function awaitNoteIndexed(app: App, notePath: string): Promise<void> {
	if (app.metadataCache.getCache(notePath) !== null) {
		return;
	}

	await new Promise<void>((resolve) => {
		let settled = false;
		const finish = (): void => {
			if (settled) {
				return;
			}
			settled = true;
			app.metadataCache.offref(reference);
			window.clearTimeout(timer);
			resolve();
		};

		const reference = app.metadataCache.on('changed', (file) => {
			if (file.path === notePath) {
				finish();
			}
		});
		const timer = window.setTimeout(finish, INDEX_WAIT_MS);
	});
}
