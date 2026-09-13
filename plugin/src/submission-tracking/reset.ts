import type { ConnectionDetails, FailureKind } from '../git-publishing/gitlab-client';
import { getFileContent, getMergeRequestChangedPath } from '../git-publishing/gitlab-client';
import type { ResolvedDocument } from './reconcile';
import { branchForDocId } from './resolve';

/**
 * `recover.ts` answers "where can a document the vault has lost be read
 * from" — a question about a `doc_id` with no note. This answers the
 * narrower one Reset asks: "what does the note I am looking at say on the
 * ref reviewers are reading it from". Same three-way content shape, one
 * fewer ref, and kept in its own file for the same reason `recover.ts` is
 * kept out of `reconcile.ts`: one file per direction of "what does the
 * remote know" (add-document-recovery design.md decision 6).
 */

/**
 * A document whose review cycle is open, carrying the one thing the read
 * below needs beyond its `doc_id` — the merge request the remote path is
 * read from. Produced only by `resettableDocument`, so there is no way to
 * hand the read a document that is not eligible for one.
 */
export interface ResettableDocument {
	docId: string;
	mrIid: number;
}

/**
 * The eligibility rule, in one place: pending and changes-requested only.
 *
 * Published and not-accepted are excluded because their cycle is over —
 * a published document has no live branch to reset against, and revising
 * one is milestone 7's job under its own name
 * (`docs/panel-tracking-scope.md`). Never-submitted has nothing to reset
 * to at all.
 *
 * A document nothing has resolved yet (`null`) is NOT resettable, and that
 * is the deliberate half: it is the first-refresh-failed case, and treating
 * an unknown state as an open cycle would offer a destructive action on an
 * assumption nothing established.
 */
export function resettableDocument(document: ResolvedDocument | null): ResettableDocument | null {
	if (document === null || document.submission === null) {
		return null;
	}

	const { state, mrIid } = document.submission;
	if (state !== 'pending' && state !== 'changes-requested') {
		return null;
	}

	return { docId: document.docId, mrIid };
}

export type ResetContentResult =
	| { kind: 'found'; content: string }
	| { kind: 'absent' }
	| { kind: 'failed'; failure: FailureKind; detail?: string };

/**
 * Reads what a document currently carries on ITS OWN tracked branch, and
 * stops there — three-way, like every other content read, so a failed read
 * is never mistaken for an absent file (add-document-recovery design.md
 * decision 2).
 *
 * NO DEFAULT-BRANCH FALLBACK, and this is the whole reason this is not
 * `fetchRecoveryContent` with a flag. That fallback exists for one case —
 * recovering a document that has since been published, whose branch was
 * auto-deleted — which Reset cannot encounter: every resettable document
 * has an open review cycle and therefore a live branch. An absent answer
 * here means the caller's understanding of the state is stale (the review
 * ended since the panel last refreshed), not that the content lives
 * somewhere else. Falling back would quietly hand the author content from a
 * different cycle that they never asked for, over local work they are about
 * to lose (this change's design.md decision 1).
 *
 * The remote path is read from the merge request rather than taken from the
 * note's own vault path, per `docs/document-identity.md` §4: plugin data is
 * not reliably synced, and a note moved locally since submit would
 * otherwise read as absent rather than as the moved note it is. A merge
 * request that changed anything other than exactly one file yields no path
 * to read, which is reported as a failure and never as absence — the same
 * distinction `getMergeRequestChangedPath`'s own callers draw.
 */
export async function fetchResetContent(
	details: ConnectionDetails,
	document: ResettableDocument
): Promise<ResetContentResult> {
	const path = await getMergeRequestChangedPath(details, document.mrIid);
	if (!path.ok) {
		return failed(path);
	}
	if (path.value === null) {
		return { kind: 'failed', failure: 'unexpected' };
	}

	const onBranch = await getFileContent(details, {
		path: path.value,
		ref: branchForDocId(document.docId),
	});
	if (!onBranch.ok) {
		return failed(onBranch);
	}

	return onBranch.value.exists ? { kind: 'found', content: onBranch.value.content } : { kind: 'absent' };
}

/**
 * Spelled out rather than spread, for the reason `document-state.ts` gives
 * at its own copy of this: `detail` is optional rather than nullable, so
 * assigning it unconditionally puts a key on the object that a caller
 * testing for its presence then finds.
 */
function failed(result: { failure: FailureKind; detail?: string }): ResetContentResult {
	return result.detail === undefined
		? { kind: 'failed', failure: result.failure }
		: { kind: 'failed', failure: result.failure, detail: result.detail };
}
