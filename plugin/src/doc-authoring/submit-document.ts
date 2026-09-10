import { Notice } from 'obsidian';
import type { App, TFile } from 'obsidian';
import type { ConnectionDetails, FailureKind } from '../git-publishing/gitlab-client';
import {
	branchExists,
	createBranchWithCommit,
	createMergeRequest,
	deleteBranch,
	findOpenMergeRequest,
} from '../git-publishing/gitlab-client';
import type { ConnectionState } from '../platform-config/connection-state';
import { readDocId } from '../submission-tracking/resolve';
import { SUBMISSION_STATE_LABELS } from '../submission-tracking/submission-record';
import type { SubmissionStore } from '../submission-tracking/submission-store';
import { requireAuthoringGate } from './authoring-gate';
import type { SubmitModalResult } from './submit-modal';
import { SubmitModal } from './submit-modal';
import { deriveDocId } from './doc-id';
import { writeSubmissionFrontMatter } from './front-matter';

export const NO_ACTIVE_NOTE_MESSAGE = 'Open the note you want to submit first.';

export const INVALID_FILENAME_MESSAGE =
	"This file's name can't be used as a document ID. Rename it — no spaces " +
	'and none of ~^:?*[\\ — then submit again.';

/**
 * What every remaining submit failure is told as: a failure of unknown
 * outcome, a rejected write, an unexpected response, or a pre-flight lookup
 * that did not answer. It names no cause, because the author's action is the
 * same for all of them, and it no longer advises renaming the file.
 *
 * Renaming was removed rather than reworded. It used to be the advice for
 * the already-exists case, and it was the one action that made that case
 * unrecoverable: renaming re-derives a different permanent `doc_id`, so the
 * document acquires a second identity and the first attempt is orphaned. The
 * pre-flight in `performSubmit` now handles that case by completing the
 * submission, so the advice is not just safer here — it is unnecessary.
 *
 * Renaming survives in exactly two narrower places, each with its own
 * message: `INVALID_FILENAME_MESSAGE` for a filename that is not ref-legal,
 * and `ALREADY_AWAITING_REVIEW_MESSAGE` for a name a different document may
 * genuinely be holding. Vocabulary-checked: no "branch", "commit", "merge
 * request", "MR", "conflict", or "main".
 */
export const SUBMIT_FAILED_MESSAGE =
	"Submit didn't go through. Check your connection and submit again.";

/**
 * Its own outcome rather than a variant of the above: the author needs to
 * know the submission stopped while tidying an earlier attempt, not that it
 * reached nothing at all. Nothing was written when this is shown.
 */
export const CLEAR_PREVIOUS_ATTEMPT_FAILED_MESSAGE =
	"Submit didn't go through while clearing up an earlier attempt. Check " +
	'your connection and submit again.';

/**
 * Shown when something is already awaiting review for this document's
 * target, in which case the plugin writes and deletes nothing.
 *
 * Both readings are addressed because the plugin cannot always tell them
 * apart and must not claim to. Renaming IS the right advice here — for a
 * genuinely different document it is how that document gets its own identity
 * — which is exactly why it was removed from the interrupted case above,
 * where the same sentence was destructive.
 */
export const ALREADY_AWAITING_REVIEW_MESSAGE =
	"A document with this file name is already waiting for review. If that's " +
	"this document, there's nothing more to do. If it's a different one, " +
	'rename the file and submit again.';

/**
 * Entry point for both the command and the panel control, so neither can
 * behave differently from the other. Gates identically to document
 * creation, then opens the modal; the remote sequence itself runs only
 * after the author confirms.
 */
export function submitForReview(
	app: App,
	details: ConnectionDetails,
	state: ConnectionState,
	store: SubmissionStore
): void {
	const gate = requireAuthoringGate(details, state);
	if (gate === null) {
		return;
	}

	const file = app.workspace.getActiveFile();
	if (file === null || file.extension !== 'md') {
		new Notice(NO_ACTIVE_NOTE_MESSAGE);
		return;
	}

	new SubmitModal(app, file, (result) => {
		void performSubmit(app, details, file, result, store);
	}).open();
}

/**
 * The write sequence itself: resolve `doc_id`, establish the state of the
 * target on the remote, then create the branch and commit and open the
 * merge request. Front matter and the tracking record are written only
 * after both remote writes succeed — see `front-matter.ts` and design.md's
 * ordering decision.
 *
 * The pre-flight ahead of the first write is what makes an interrupted
 * submit recoverable by pressing the same button again. The choice of what
 * to do with each of its three answers stays HERE, in the file that owns
 * the sequence; `git-publishing` supplies the three calls and knows nothing
 * about when any of them is appropriate (design.md decision 8).
 */
async function performSubmit(
	app: App,
	details: ConnectionDetails,
	file: TFile,
	result: SubmitModalResult,
	store: SubmissionStore
): Promise<void> {
	// A frozen `doc_id` wins over the live filename: it is the document's
	// identity for the rest of its life and the filename may drift away from
	// it (`docs/document-identity.md` §3). Load-bearing here rather than
	// adjacent — without it, renaming the file re-derives a different
	// `doc_id`, finds an absent target, and submits the same document a
	// second time under a second identity, which is the corruption this
	// whole sequence exists to prevent.
	const docId = readDocId(app, file) ?? deriveDocId(file.basename);
	if (docId === null) {
		new Notice(INVALID_FILENAME_MESSAGE);
		return;
	}

	const branch = `doc/${docId}`;
	if (!(await clearPreviousAttempt(details, branch))) {
		return;
	}

	// Read AFTER the pre-flight, not before: what reaches the remote must be
	// the note as it stands at the moment of the successful submit, never
	// what an earlier attempt left there.
	const content = await app.vault.read(file);

	const commit = await createBranchWithCommit(details, { branch, filePath: file.path, content });
	if (!commit.ok) {
		reportFailure(commit);
		return;
	}

	const mergeRequest = await createMergeRequest(details, { sourceBranch: branch, title: result.title });
	if (!mergeRequest.ok) {
		reportFailure(mergeRequest);
		return;
	}

	await writeSubmissionFrontMatter(app, file, { title: result.title, category: result.category, docId });
	await store.save({ docId, branch, mrIid: mergeRequest.value.iid, state: 'pending' });
	new Notice(SUBMISSION_STATE_LABELS.pending);
}

/**
 * The pre-flight. Establishes which of three states `branch` is in and acts
 * on the answer, returning whether the caller may proceed to write. Every
 * `false` return has already told the author why, and has written nothing.
 *
 * - Absent: proceed with nothing cleared. The ordinary first submit.
 * - Present with an open submission: write and delete NOTHING. Something is
 *   under review and is never ours to replace.
 * - Present with nothing open: delete it, then let the caller cut fresh.
 *
 * Delete first and create second, never the reverse — that ordering is the
 * safety property, not an implementation detail (design.md decision 4). If
 * the delete succeeds and the create then fails, nothing is in the way and
 * the next attempt is an ordinary first submit; if the delete fails, the
 * submit stops before any write. Every failure leaves the remote in a state
 * a plain retry can complete.
 *
 * A lookup that did not succeed is never read as absence. That is the one
 * mistake that would reintroduce the dead end this change removes: a token
 * that cannot read the target would license both the create that cannot
 * succeed and the delete that must not happen.
 */
async function clearPreviousAttempt(details: ConnectionDetails, branch: string): Promise<boolean> {
	const presence = await branchExists(details, branch);
	if (!presence.ok) {
		reportFailure(presence);
		return false;
	}

	if (!presence.value.exists) {
		return true;
	}

	const open = await findOpenMergeRequest(details, branch);
	if (!open.ok) {
		reportFailure(open);
		return false;
	}

	if (open.value !== null) {
		new Notice(ALREADY_AWAITING_REVIEW_MESSAGE);
		return false;
	}

	const cleared = await deleteBranch(details, branch);
	if (!cleared.ok) {
		reportFailure(cleared, CLEAR_PREVIOUS_ATTEMPT_FAILED_MESSAGE);
		return false;
	}

	return true;
}

/**
 * One undifferentiated failure per step — except the permission-scoped kind,
 * which names what's missing when GitLab reported it and which this change
 * leaves alone. No branch inspects *why* beyond that one classification.
 *
 * `message` is the step's own outcome, defaulting to the general one.
 * Clearing a previous attempt passes its own, because the author's situation
 * genuinely differs there; the lookups pass none, because a failed lookup
 * and a failed write leave the author with the same next action.
 */
function reportFailure(
	result: { failure: FailureKind; detail?: string },
	message: string = SUBMIT_FAILED_MESSAGE
): void {
	if (result.failure === 'insufficient-permission') {
		new Notice(insufficientPermissionMessage(result.detail, message));
		return;
	}

	new Notice(message);
}

function insufficientPermissionMessage(detail: string | undefined, fallback: string): string {
	if (detail === undefined) {
		return fallback;
	}

	return (
		`Your access token doesn't have permission to submit documents ` +
		`(missing: ${detail}). Ask your admin to add it.`
	);
}
