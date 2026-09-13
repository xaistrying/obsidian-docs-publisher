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

import { arrayBufferToBase64, normalizePath } from 'obsidian';
import type { App } from 'obsidian';
import type { ClientResult, ConnectionDetails, FileCommitId } from '../git-publishing/gitlab-client';
import { getFileCommitId } from '../git-publishing/gitlab-client';
import type { VaultEmbedIndex } from './embeds';
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
