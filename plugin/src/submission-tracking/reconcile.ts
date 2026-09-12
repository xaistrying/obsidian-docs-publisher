import type { ConnectionDetails, FailureKind, MergeRequestSummary } from '../git-publishing/gitlab-client';
import { hasUnresolvedThreads, listMergeRequests } from '../git-publishing/gitlab-client';
import { branchForDocId } from './resolve';
import type { SubmissionRecord, SubmissionState } from './submission-record';
import type { SubmissionStore } from './submission-store';

/**
 * What the remote says about one document.
 *
 * `submission` is null when the remote holds no merge request for the
 * document at all — never submitted. That is deliberately not a
 * `SubmissionState`: it is the ABSENCE of a submission, and modelling it as a
 * state would be something to persist, which would make the store able to
 * remember that a document has never been submitted.
 */
export interface ResolvedDocument {
	docId: string;
	submission: {
		state: SubmissionState;
		mrIid: number;
		/** Null when the listing carried no usable link for it. */
		webUrl: string | null;
	} | null;
}

export type ReconcileResult =
	| { ok: true; documents: ResolvedDocument[] }
	// `detail` carries the permission name when a read was refused for one.
	| { ok: false; failure: FailureKind; detail?: string };

/**
 * Resolves every supplied `doc_id` against the remote and corrects the store
 * to match.
 *
 * THE REMOTE DECIDES. A stored state that disagrees is replaced rather than
 * merged into some third answer, and a document with no stored record gains
 * one — which is what makes this self-healing, including for the narrow case
 * the interrupted-submit change left open, where a submission's remote calls
 * succeeded but its local record failed to save. See design.md decision 7.
 *
 * ALL OR NOTHING. A listing that fails, a listing that was truncated, or a
 * threads check that fails aborts the whole pass with no store write at all.
 * Resolving from partial data is the one outcome worth avoiding above every
 * other: it leaves some documents fresh and others stale with nothing on
 * screen distinguishing them, so the author cannot tell which answers to
 * trust. One refresh is one outcome.
 *
 * Records whose `doc_id` is not in `docIds` are never touched — not read, not
 * rewritten, not deleted. A note may be temporarily absent from the vault
 * (not yet synced, moved outside it) and discarding the only local trace of a
 * real submission to save a few bytes is not a trade worth making.
 */
export async function reconcileDocuments(
	details: ConnectionDetails,
	store: SubmissionStore,
	docIds: readonly string[]
): Promise<ReconcileResult> {
	// ONE listing for every document, matched in memory — `docs/document-
	// identity.md` §2 and design.md decision 1. Not one query per document:
	// that multiplies the failure surface by the size of the corpus.
	const listing = await listMergeRequests(details);
	if (!listing.ok) {
		return listing.detail === undefined
			? { ok: false, failure: listing.failure }
			: { ok: false, failure: listing.failure, detail: listing.detail };
	}

	// A `doc_id` missing from a truncated listing looks exactly like one that
	// was never submitted, and that second answer sends the author to submit a
	// document that already exists. Refuse rather than guess — design.md
	// decision 2. `listMergeRequests` has already logged the cap it hit.
	if (listing.value.truncated) {
		return { ok: false, failure: 'unexpected' };
	}

	const documents: ResolvedDocument[] = [];
	for (const docId of docIds) {
		const resolved = await resolveMergeRequestState(details, docId, listing.value.entries);
		if (!resolved.ok) {
			return resolved.detail === undefined
				? { ok: false, failure: resolved.failure }
				: { ok: false, failure: resolved.failure, detail: resolved.detail };
		}
		documents.push(resolved.document);
	}

	await writeBack(store, documents);
	return { ok: true, documents };
}

/**
 * Exported as of add-resubmission-lifecycle: submit resolves ONE document's
 * state before it writes, and does so from its own branch-filtered listing
 * rather than this pass's project-wide one. The precedence below is shared
 * rather than re-derived there — two independently maintained answers to
 * "what state is this document in" is the drift `docs/resubmission-
 * lifecycle.md` §3 flagged, and it is what the old `clearPreviousAttempt`
 * pre-flight actually was.
 */
export type ResolveOneResult =
	| { ok: true; document: ResolvedDocument }
	| { ok: false; failure: FailureKind; detail?: string };

/**
 * The precedence, exactly as `docs/document-identity.md` §2 and design.md
 * decision 3 fix it:
 *
 *   1. An open merge request wins if one exists. At most one can.
 *   2. Otherwise the most recent decides: merged is published, closed
 *      without merging is not accepted.
 *   3. No merge request at all is never submitted.
 *
 * Plus decision 3's one addition: an open merge request carrying unresolved
 * review threads is changes-requested rather than awaiting review, and
 * resolving those threads returns it to awaiting review on the next refresh.
 *
 * Matching is by `doc/<doc_id>` against the source branch — never by the
 * note's file path and never by a stored record, so a renamed note and a note
 * on a machine that has never seen this document both resolve identically.
 *
 * `entries` is whatever listing the caller fetched: this pass hands it the
 * project-wide one it shares across every document, and `resolveDocumentState`
 * hands it a listing already narrowed to this one branch server-side. The
 * filter below is therefore redundant for the second caller and kept anyway
 * — it costs one pass over a one-element array, and it means the precedence
 * cannot silently start resolving from an entry that is not this document's.
 */
export async function resolveMergeRequestState(
	details: ConnectionDetails,
	docId: string,
	entries: readonly MergeRequestSummary[]
): Promise<ResolveOneResult> {
	const branch = branchForDocId(docId);
	// The listing arrives ordered `updated_at` descending, so the first match
	// is the most recent one and no sort is needed here.
	const matches = entries.filter((entry) => entry.sourceBranch === branch);
	if (matches.length === 0) {
		return { ok: true, document: { docId, submission: null } };
	}

	const open = matches.find(isOpen);
	if (open !== undefined) {
		const threads = await hasUnresolvedThreads(details, open);
		if (!threads.ok) {
			// Never fall through to `pending` here. "No unresolved threads" for
			// a check that did not happen would silently move a document out of
			// the one state this whole mechanism exists to find.
			return threads.detail === undefined
				? { ok: false, failure: threads.failure }
				: { ok: false, failure: threads.failure, detail: threads.detail };
		}

		return {
			ok: true,
			document: {
				docId,
				submission: {
					state: threads.value ? 'changes-requested' : 'pending',
					mrIid: open.iid,
					webUrl: open.webUrl,
				},
			},
		};
	}

	const decisive = matches[0];
	const state = settledState(decisive.state);
	if (state === null) {
		// GitLab defines exactly four states and `isOpen` has taken two of
		// them, so reaching here means the API returned something this code has
		// never seen. A canary, not a routine path: guessing which of published
		// or not-accepted it meant would be a coin flip printed as fact.
		console.error(
			`Docs Publisher: merge request ${decisive.iid} reported the unrecognized state ` +
				`"${decisive.state}"; refusing to resolve ${docId} from it.`
		);
		return { ok: false, failure: 'unexpected' };
	}

	return {
		ok: true,
		document: { docId, submission: { state, mrIid: decisive.iid, webUrl: decisive.webUrl } },
	};
}

/**
 * `locked` counts as open alongside `opened`: it is the transient state while
 * a merge is being processed, so the document is neither published nor turned
 * down, and reading it as either would flash a wrong final answer at the
 * author mid-merge.
 */
function isOpen(entry: MergeRequestSummary): boolean {
	return entry.state === 'opened' || entry.state === 'locked';
}

/** Null for any state this code does not recognize — see the caller. */
function settledState(state: string): SubmissionState | null {
	if (state === 'merged') {
		return 'published';
	}
	if (state === 'closed') {
		return 'closed';
	}
	return null;
}

/**
 * Corrects the store to the remote's answer in one write.
 *
 * Only records that actually changed are written, so an unchanged refresh
 * touches `data.json` not at all. Documents that resolved as never submitted
 * write nothing: there is no state to store for the absence of a submission,
 * and a record left over from an earlier one is kept rather than deleted, for
 * the same reason the untouched records above are.
 */
async function writeBack(store: SubmissionStore, documents: readonly ResolvedDocument[]): Promise<void> {
	const changed: SubmissionRecord[] = [];
	for (const entry of documents) {
		if (entry.submission === null) {
			continue;
		}

		const stored = store.get(entry.docId);
		const record: SubmissionRecord = {
			docId: entry.docId,
			branch: branchForDocId(entry.docId),
			mrIid: entry.submission.mrIid,
			state: entry.submission.state,
			// Carried forward, not recomputed: reconciliation corrects
			// state/mrIid/branch from the remote listing, but has no opinion on
			// path — only a successful submit captures that
			// (add-document-recovery). Rebuilding this record without it would
			// silently erase a previously-captured path the next time this
			// document's state changes.
			path: stored?.path,
		};

		if (
			stored === undefined ||
			stored.state !== record.state ||
			stored.mrIid !== record.mrIid ||
			stored.branch !== record.branch
		) {
			changed.push(record);
		}
	}

	await store.saveMany(changed);
}
