import type { ConnectionDetails, FailureKind } from '../git-publishing/gitlab-client';
import { getFileContent, getMergeRequestChangedPath } from '../git-publishing/gitlab-client';
import type { ResolvedDocument } from './reconcile';
import { branchForDocId } from './resolve';
import type { ProjectRef } from './submission-record';
import { belongsToProject } from './submission-record';
import type { SubmissionStore } from './submission-store';

/**
 * One question, asked two ways: "what does this document say on the ref
 * reviewers are reading it from". Reset asks it about a note in the vault;
 * Restore asks it about a record whose note is gone. Both answer by reading
 * the document's own branch, which is why they share one read.
 *
 * REPLACED `recover.ts` on 2026-09-22, which asked a wider question and
 * carried three things to answer it: a stored-path fast path, a
 * changed-path fallback for records written before that field existed, and
 * a default-branch fallback for a PUBLISHED document whose branch was
 * deleted. Import made the last one redundant — a published document with
 * no local note is a file on the default branch this vault lacks, which is
 * exactly what Discover lists — and with it went the `unrecoverable` state
 * and the whole remote round trip the list needed to be built at all.
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

/**
 * Every tracked document whose note is no longer in the vault and whose
 * content is still reachable — the list the panel offers Restore from.
 *
 * PURELY LOCAL: stored records minus the vault's `doc_id`s, computed from
 * data this process already holds. Nothing here reaches the remote, which
 * is the point — the list this replaced needed one request per record just
 * to decide whether a row could be offered, and dragged its own refresh
 * lifecycle and failure states through the panel to do it.
 *
 * ONLY DOCUMENTS UNDER ACTIVE REVIEW, which is what makes this list empty
 * itself. Every document here leaves on its own: the review ends and it
 * becomes published (Discover covers it — the file is on the default branch
 * and this vault has no note at its path, which is Discover's definition) or
 * not accepted (it drops out entirely).
 *
 * That holds ONLY because refresh reconciles every stored record, not just
 * the vault's notes (correct-stale-records). Before 2026-09-29 it reconciled
 * notes alone, so the records here — by definition the ones with no note —
 * were never re-asked, their state never left `pending`, and the claim above
 * was false for exactly the documents it described (`docs/ce-verification.md`
 * §D0f). Narrow that refresh again and this list stops emptying.
 *
 * `closed` was in this list until 2026-09-22 and was removed for that
 * reason. Nothing in this plugin deletes a stored record — reconciliation
 * deliberately never does — so a not-accepted document whose note the author
 * deleted BECAUSE THEY HAD ABANDONED IT would sit here forever with no way
 * to dismiss it. An author who turns down their own rejected draft and
 * starts again should not be nagged about it for the life of the vault.
 *
 * What that gives up: recovering a rejected note deleted by accident. The
 * escape hatch is the one the closed review already provides — its content
 * is readable in GitLab — and paying for that rare case with a permanent
 * row in everyone else's panel is the wrong trade.
 */
export function restorableDocuments(
	store: SubmissionStore,
	vaultDocIds: ReadonlySet<string>,
	/**
	 * Only records belonging here are offered: a Restore reads content from the
	 * record's merge request, and one from another project names a review this
	 * project does not have (scope-records-to-their-project).
	 */
	project: ProjectRef | null
): ResettableDocument[] {
	return store
		.allRecords()
		.filter(
			(record) =>
				belongsToProject(record, project) &&
				(record.state === 'pending' || record.state === 'changes-requested') &&
				record.mrIid !== undefined &&
				!vaultDocIds.has(record.docId)
		)
		.map((record) => ({ docId: record.docId, mrIid: record.mrIid as number }))
		.sort((a, b) => a.docId.localeCompare(b.docId));
}

export type ResetContentResult =
	| { kind: 'found'; content: string; path: string }
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

	// The path comes back with the content because Restore needs somewhere to
	// CREATE the note, and this read is the only thing that knows where that
	// is. Reset ignores it — it already has the note.
	return onBranch.value.exists
		? { kind: 'found', content: onBranch.value.content, path: path.value }
		: { kind: 'absent' };
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
