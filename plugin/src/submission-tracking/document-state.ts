import type { ConnectionDetails, FailureKind } from '../git-publishing/gitlab-client';
import { getMergeRequestChangedPath, listMergeRequests } from '../git-publishing/gitlab-client';
import type { ResolvedDocument } from './reconcile';
import { resolveMergeRequestState } from './reconcile';
import { branchForDocId } from './resolve';

/**
 * One document's state as the remote currently holds it, plus the path the
 * document occupies there.
 *
 * `remotePath` is null for two different reasons and the caller must treat
 * them the same way — as "not established" and never as "no path":
 * the document has no submission at all, or its submission changed something
 * other than exactly one file, which `getMergeRequestChangedPath` reports as
 * an answer rather than a failure. Refusing a submit on an unestablished
 * path would mean naming a path to restore that was never read.
 */
export interface DocumentState {
	document: ResolvedDocument;
	remotePath: string | null;
}

export type DocumentStateResult =
	| { ok: true; value: DocumentState }
	| { ok: false; failure: FailureKind; detail?: string };

/**
 * Resolves ONE document against the remote, for submit's own pre-flight.
 *
 * Deliberately not `reconcileDocuments` called with a single-element array.
 * That pass fetches ONE project-wide listing to answer for every tracked
 * document at once — right for the panel's batch refresh, and wasteful here,
 * where a resubmit would pay to paginate the whole project's review history
 * to learn about the one document in hand (`docs/resubmission-lifecycle.md`
 * §3). `listMergeRequests` already narrows by source branch server-side, and
 * this is the caller that wants it.
 *
 * What is NOT duplicated is the precedence itself: open wins, else the most
 * recent decides, else never submitted, with an open merge request carrying
 * unresolved review threads reading as changes-requested. That is
 * `resolveMergeRequestState`, shared with the bulk pass, so the two can never
 * answer the same question differently.
 *
 * Nothing is written here. This resolves and reports; correcting the store is
 * the caller's, after its own write succeeds.
 */
export async function resolveDocumentState(
	details: ConnectionDetails,
	docId: string
): Promise<DocumentStateResult> {
	const branch = branchForDocId(docId);
	const listing = await listMergeRequests(details, { sourceBranch: branch });
	if (!listing.ok) {
		return failure(listing);
	}

	// Not reachable for a single branch filtered server-side, and guarded
	// anyway for the same reason the bulk pass guards it: a document absent
	// from an incomplete listing is indistinguishable from one never
	// submitted, and that second answer would send this document's own
	// resubmit down the first-submit path.
	if (listing.value.truncated) {
		return { ok: false, failure: 'unexpected' };
	}

	const resolved = await resolveMergeRequestState(details, docId, listing.value.entries);
	if (!resolved.ok) {
		return failure(resolved);
	}

	if (resolved.document.submission === null) {
		return { ok: true, value: { document: resolved.document, remotePath: null } };
	}

	// `docs/document-identity.md` §4 is explicit that the remote path is read
	// from the merge request rather than kept locally — plugin data is not
	// reliably synced and does not survive a reinstall, so a stored path is
	// the wrong thing to compare against. This is a second request per
	// resubmit, which design.md's own risk note anticipated might be needed:
	// the listing entries carry no changed paths, so the path is genuinely
	// not available from the read above.
	const path = await getMergeRequestChangedPath(details, resolved.document.submission.mrIid);
	if (!path.ok) {
		return failure(path);
	}

	return { ok: true, value: { document: resolved.document, remotePath: path.value } };
}

/**
 * Spelled out rather than spread, because `detail` is optional rather than
 * nullable: assigning `detail: undefined` unconditionally puts the key on the
 * object, so a caller testing for its presence finds one that is not there.
 */
function failure(result: { failure: FailureKind; detail?: string }): DocumentStateResult {
	return result.detail === undefined
		? { ok: false, failure: result.failure }
		: { ok: false, failure: result.failure, detail: result.detail };
}
