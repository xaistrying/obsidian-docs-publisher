/**
 * Bringing an imported or recovered document's images down with it.
 *
 * THE MIRROR OF `submission-files.ts`, and structured the same way for the
 * same reason: the two effects it needs are behind an interface, so the rule
 * this file exists to express — which attachments to fetch, which to leave
 * alone, and what is reported when one does not arrive — is testable without
 * a vault or a server.
 *
 * THE RESOLUTION IS THE SAME RESOLUTION SUBMIT USES, unchanged, and that is
 * the whole design rather than an economy. `resolveEmbeddedAttachments` is
 * pure logic over `VaultEmbedIndex`, so what changes here is not the function
 * but the INDEX it is asked of: submit points it at the vault, and this
 * points it at the remote's own file listing. Obsidian's shortest-path rule
 * is still never reimplemented — see `remoteIndex` below for exactly where
 * that rule is declined rather than guessed at.
 *
 * CORRECTION TO design.md decision 3, which this file's shape records because
 * the correction matters more than the code: that decision said to resolve an
 * imported note's embeds "through the EXISTING `resolveEmbeddedAttachments`"
 * and fetch what came back, backed — implicitly — by the vault adapter. That
 * cannot work. `getFirstLinkpathDest` answers only for files ALREADY IN THE
 * VAULT and the markdown-link branch requires the file to exist, so for a
 * freshly imported note, whose images are by definition not in the vault yet,
 * it resolves nothing and there is nothing to fetch. The decision's mechanism
 * is right; the index it assumed was wrong.
 */

import type { App } from 'obsidian';
import type { ClientResult, ConnectionDetails, FileBytes } from '../git-publishing/gitlab-client';
import type { EmbedReference, VaultEmbedIndex } from './embeds';
import { resolveEmbeddedAttachments } from './embeds';
import { attachmentSource, awaitNoteIndexed } from './vault-attachments';

/**
 * The four questions fetching asks, and nothing else.
 *
 * `embedsFor` is the one Obsidian-shaped read and is the reason the note has
 * to be written and INDEXED first: Obsidian records a note's embeds whether
 * or not they resolve, so the links are available from the cache even while
 * every one of them points at a file the vault does not have yet.
 */
export interface AttachmentSource {
	/** The embeds Obsidian recorded for the note now in the vault. */
	embedsFor(notePath: string): readonly EmbedReference[];
	/** Whether the vault already holds a file at this exact path. */
	heldInVault(path: string): boolean;
	/** The attachment's bytes from the ref the note came from. */
	readRemote(path: string): Promise<ClientResult<FileBytes>>;
	/** Writes bytes at this vault path, creating folders. False when it could not. */
	write(path: string, base64: string): Promise<boolean>;
}

/**
 * What happened, per attachment, so nothing about a half-complete document is
 * silent (tasks.md 4.5).
 *
 * `unresolved` and `failed` are different problems and are kept apart: the
 * first is an embed the remote listing could not place, the second is one it
 * placed and could not deliver. Only the second is worth retrying.
 */
export interface AttachmentFetchReport {
	/** Written into the vault by this call. */
	fetched: string[];
	/** Already in the vault at that path, and left exactly as it was. */
	kept: string[];
	/** Embeds the remote listing could not place, by the link as written. */
	unresolved: string[];
	/** Attachments located on the remote whose bytes did not arrive, by path. */
	failed: string[];
}

/**
 * Fetches every attachment the note at `notePath` embeds, from the same ref
 * the note came from, writing each at its OWN remote path.
 *
 * NEVER OVERWRITES. A file the vault already holds at that path is left
 * alone and reported as kept — a shared logo twenty documents embed is
 * fetched once, by whichever import got there first, and every import after
 * that leaves it be. This is the read-side counterpart of the write side's
 * "never deletes": neither direction destroys what it finds.
 *
 * NEVER REFUSES THE DOCUMENT. Every failure is per-attachment and the note
 * stays: a readable document missing a picture beats no document, and the
 * author can import again or fetch the image by hand. That is the trade
 * design.md decision 3 states plainly rather than hides, and reporting is
 * what keeps it a trade rather than a silent loss.
 */
export async function fetchDocumentAttachments(
	params: { notePath: string; remotePaths: readonly string[] },
	source: AttachmentSource
): Promise<AttachmentFetchReport> {
	const unresolved: string[] = [];
	const index = remoteIndex(params.remotePaths, source, unresolved);

	const report: AttachmentFetchReport = { fetched: [], kept: [], unresolved, failed: [] };

	for (const path of resolveEmbeddedAttachments(params.notePath, index)) {
		if (source.heldInVault(path)) {
			report.kept.push(path);
			continue;
		}

		const bytes = await source.readRemote(path);
		if (!bytes.ok || !bytes.value.exists) {
			report.failed.push(path);
			continue;
		}

		if (await source.write(path, bytes.value.base64)) {
			report.fetched.push(path);
		} else {
			report.failed.push(path);
		}
	}

	return report;
}

/**
 * `VaultEmbedIndex`, backed by the remote's file listing instead of the
 * vault's.
 *
 * `fileAt` is exact and needs no cleverness: a markdown-style embed
 * (`![](assets/x.png)`) carries a path, `embeds.ts` has already joined it
 * against the note's folder, and the listing either holds that path or does
 * not.
 *
 * `resolveLinkpath` is where Obsidian's shortest-path rule would be needed,
 * and is where it is DECLINED RATHER THAN GUESSED AT. A wikilink
 * (`![[diagram.png]]`) names a file, not a location; only Obsidian knows
 * which `diagram.png` a note means when several exist, and add-attachment-sync
 * rejected reimplementing that rule because a second implementation would
 * disagree with the first at exactly the moment it mattered. So: exactly one
 * candidate in the listing is an answer, and anything else — none, or several
 * — is recorded as unresolved and skipped. The author is told which link
 * could not be placed rather than being handed an image that might be the
 * wrong one.
 *
 * A candidate is a listed path that IS the link, or that ends with the link
 * after a `/`. That covers both a bare filename and the partial path a
 * wikilink may carry (`![[assets/diagram.png]]`) without either case being
 * special.
 */
function remoteIndex(
	remotePaths: readonly string[],
	source: AttachmentSource,
	unresolved: string[]
): VaultEmbedIndex {
	const paths = new Set(remotePaths);

	function record(link: string): void {
		// A link naming a NOTE is not an unplaced attachment, it is
		// transclusion — out of scope project-wide, and `embeds.ts` already
		// skips it silently on the vault side. Recording it here would report
		// a deliberate non-feature as a failure on every document that uses
		// one. An attachment always carries an extension; `![[Other Document]]`
		// carries none, and `![[Other Document.md]]` is caught by the suffix.
		const name = link.slice(link.lastIndexOf('/') + 1);
		if (!name.includes('.') || /\.md$/i.test(name)) {
			return;
		}

		if (!unresolved.includes(link)) {
			unresolved.push(link);
		}
	}

	return {
		embedsFor: (path) => source.embedsFor(path),
		resolveLinkpath: (linkpath) => {
			const candidates = remotePaths.filter(
				(path) => path === linkpath || path.endsWith(`/${linkpath}`)
			);
			if (candidates.length === 1) {
				return candidates[0];
			}

			record(linkpath);
			return null;
		},
		fileAt: (path) => {
			if (paths.has(path)) {
				return path;
			}

			// Recorded by the path it was asked for, which for a markdown link
			// is what the author wrote joined to the note's own folder — the
			// thing they would have to correct.
			record(path);
			return null;
		},
	};
}

/**
 * THE ONE PATH BOTH IMPORT AND RECOVERY TAKE (tasks.md 4.4). Two mechanisms
 * for this would be two chances to get it wrong, and recovery has had the
 * gap this closes since the day it shipped: a recovered note's images were
 * never fetched, so every recovered document with a picture in it came back
 * broken.
 *
 * Runs AFTER the note is written, and waits for Obsidian to parse it, because
 * the embeds this resolves from are the ones Obsidian recorded for the note
 * in the vault (design.md decision 3).
 *
 * Between the note landing and this finishing, the document exists with
 * embeds that do not resolve. That window is real and is the accepted trade:
 * a readable document missing pictures beats no document. Nothing here can
 * fail the note.
 */
export async function bringAttachments(
	app: App,
	details: ConnectionDetails,
	params: { notePath: string; ref: string; remotePaths: readonly string[] }
): Promise<AttachmentFetchReport> {
	await awaitNoteIndexed(app, params.notePath);
	return fetchDocumentAttachments(
		{ notePath: params.notePath, remotePaths: params.remotePaths },
		attachmentSource(app, details, params.ref)
	);
}

/**
 * What the author is told about a document's attachments, or null when there
 * is nothing worth saying — which is the common case, and saying nothing is
 * what keeps the report meaningful when there IS something.
 *
 * Names what did not arrive and never how many did: a count of successes is
 * noise on an action whose success is visible in the document itself.
 */
export function attachmentReportMessage(report: AttachmentFetchReport): string | null {
	const problems = [...report.failed, ...report.unresolved];
	if (problems.length === 0) {
		return null;
	}

	return `Some images did not come with this document: ${problems.join(', ')}.`;
}
