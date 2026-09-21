import { Notice } from 'obsidian';
import type { App, TFile } from 'obsidian';
import type { CommitFileAction, ConnectionDetails, FailureKind } from '../git-publishing/gitlab-client';
import {
	branchExists,
	commitToBranch,
	createBranchWithCommit,
	createMergeRequest,
	deleteBranch,
	findOpenMergeRequest,
	getDefaultBranch,
	getFileContent,
} from '../git-publishing/gitlab-client';
import { EMPTY_REPOSITORY_MESSAGE } from '../platform-config/access-messages';
import type { ConnectionState } from '../platform-config/connection-state';
import { resolveDocumentState } from '../submission-tracking/document-state';
import { listVaultDocuments } from '../submission-tracking/document-status';
import { branchForDocId, readDocId } from '../submission-tracking/resolve';
import type { SubmissionState } from '../submission-tracking/submission-record';
import { SUBMISSION_STATE_LABELS } from '../submission-tracking/submission-record';
import type { SubmissionStore } from '../submission-tracking/submission-store';
import { requireAuthoringGate } from './authoring-gate';
import type { Category } from './categories';
import type { SubmitModalResult } from './submit-modal';
import { SubmitModal } from './submit-modal';
import { deriveDocId } from './doc-id';
import { resolveEmbeddedAttachments } from './embeds';
import {
	hasSubmissionCategory,
	readSubmissionFields,
	withSubmissionFrontMatter,
	writeSubmissionFrontMatter,
} from './front-matter';
import { buildSubmissionFiles } from './submission-files';
import { submissionFileReads, vaultEmbedIndex } from './vault-attachments';

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
 *
 * SCOPED, as of add-resubmission-lifecycle, to the FIRST-SUBMIT path alone
 * (tasks.md 5.1). It used to also fire when a tracked document was
 * resubmitted while under review, which was the dead end that change
 * removed: a resubmit pushes an update now, and cannot reach this. The hedge
 * survives because the case that CAN still reach it genuinely is ambiguous —
 * a note with no `doc_id` yet, whose derived branch name a stranger's
 * document is already holding (`docs/resubmission-lifecycle.md` §5).
 */
export const ALREADY_AWAITING_REVIEW_MESSAGE =
	"A document with this file name is already waiting for review. If that's " +
	"this document, there's nothing more to do. If it's a different one, " +
	'rename the file and submit again.';

/**
 * Shown when a first-time submit's target path already holds a published
 * document — add-document-recovery's path-collision pre-flight
 * (design.md decision 4).
 *
 * IT USED TO CARRY A RECOVER BUTTON, and that button could never work.
 * Corrected 2026-09-20. The path this check is called with is `file.path` —
 * the path of the very note being submitted — so the note is sitting at it by
 * definition, and `recoverDocument` refuses an occupied path first thing.
 * Pressing Recover therefore always answered "a note already exists at this
 * location, so nothing was recovered". The offer was dead from the day it
 * shipped, and the message promising it was telling the author something
 * false.
 *
 * So it now says what the author can ACTUALLY do. Both routes are real: a
 * renamed note targets a free path, and a deleted one frees this path so the
 * published document appears under "Documents you can import" on the next
 * refresh. Vocabulary-checked like everything else here: no "branch",
 * "commit", "merge request", "MR", "conflict", or "main".
 */
export const ALREADY_PUBLISHED_MESSAGE =
	'A document already exists at this location. Rename this note to publish it ' +
	'separately, or delete it and import the existing one instead.';

/**
 * The first of the two checks `docs/document-identity.md` §4 requires from
 * the second submit onward. Duplicating a note in Obsidian copies its front
 * matter, `doc_id` included, so two notes can claim one identity — and
 * submitting either would push one note's content under the other's name.
 *
 * Names the other note, because "somewhere in your vault" is not something
 * an author can act on. Vocabulary-checked: no "branch", "commit", "merge
 * request", "MR", "conflict", or "main".
 */
export function duplicateDocIdMessage(otherPath: string): string {
	return (
		`Another note in this vault is the same document: ${otherPath}. ` +
		'Delete that copy, or clear its document ID, then submit again.'
	);
}

/**
 * The second of the two checks (`docs/document-identity.md` §4). The plugin
 * refuses to follow a move and names the path to restore instead; the
 * comparison is case-sensitive, because `Known-errors/` and `known-errors/`
 * are different locations that orphan each other and that no file explorer
 * on Windows or macOS shows the author as different.
 */
export function pathMismatchMessage(remotePath: string): string {
	return `This document belongs at ${remotePath}. Move the note back there, then submit again.`;
}

/**
 * Shown when a tracked note's `title` or `category` is missing, empty, or —
 * for `category` — not one of the nine deliverables.
 *
 * A refusal and NOT a prompt, which is the whole point. Both fields are the
 * author's own from the first submit onward and the plugin never writes them
 * again (`openspec/config.yaml`'s front matter contract), so asking for a
 * replacement here and saving the answer would be precisely the write that
 * contract forbids. The author restores the field in the note; the plugin
 * reads it.
 *
 * Vocabulary-checked: no "branch", "commit", "merge request", "MR",
 * "conflict", or "main". "Front matter" is the author's own word for it —
 * it is Obsidian's, visible in the note's own Properties panel — and is not
 * platform vocabulary, so it is named plainly rather than talked around.
 */
export const INCOMPLETE_FRONT_MATTER_MESSAGE =
	"This note's title or category is missing or not one of the nine " +
	'categories. Fill it in on the note, then submit again.';

/**
 * The confirmation for a revision pushed to a document already under review.
 *
 * Deliberately NOT `SUBMISSION_STATE_LABELS.pending`. Sending an update does
 * not itself move a document out of "Changes requested" — that state comes
 * from unresolved review threads, which a new revision does not resolve — so
 * claiming a state here would show the author an answer the remote has not
 * agreed to and that the next refresh would take back (design.md decision
 * 6). It reports what happened and points at the control that asks again.
 */
export const UPDATE_SENT_MESSAGE = 'Your update was sent. Refresh to see where the review stands.';

/**
 * Shown when the remote refused a write because the document changed after
 * this plugin read it — the `last_commit_id` guard firing, which is the whole
 * reason that value is sent. Nothing was written.
 *
 * Its own message rather than `SUBMIT_FAILED_MESSAGE`, on that constant's own
 * stated criterion: it stays undifferentiated "because the author's action is
 * the same for all of them", and here it is not. Nothing is wrong with the
 * connection and submitting again would either fail identically or, worse,
 * succeed and discard someone's work.
 *
 * It points at "Open in GitLab" and NOT at Refresh, which would be the
 * plausible-sounding wrong advice: Refresh re-reads what STATE each document
 * is in, and does not bring anyone else's edit into the note. Seeing the
 * change means opening the document where the change is.
 */
export const CONTENT_CHANGED_MESSAGE =
	'Someone else changed this document while you were working on it. Open it in ' +
	'GitLab to see their changes, then submit again.';

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

	// A frozen `doc_id` wins over the live filename: it is the document's
	// identity for the rest of its life and the filename may drift away from
	// it (`docs/document-identity.md` §3). Read HERE, ahead of the modal,
	// because it decides which of the modal's two shapes opens — collect the
	// two fields, or show back the two the note already carries.
	const existingDocId = readDocId(app, file);
	if (existingDocId === null) {
		new SubmitModal(app, file, (result) => {
			void performSubmit(app, details, gate, file, result, store, null);
		}).open();
		return;
	}

	const existing = readSubmissionFields(app, file);
	if (existing === null) {
		// An IMPORTED document: it carries `doc_id`, frozen at import, but has
		// never been submitted from this vault, so the two fields a first
		// submit writes were never written. This IS its first submit, so the
		// modal COLLECTS them — which is not a breach of the front matter
		// contract's "written once, at first submit, never again" but the
		// literal performance of it, at the moment that had not happened yet.
		//
		// Without this, freezing `doc_id` at import only MOVES the refusal
		// that `docs/ce-verification.md` §E3 documented: the first-submit
		// path's collision check is dodged and this one takes its place, and
		// an imported document is still not submittable. Observed in the
		// running plugin 2026-09-14 (§E6).
		if (!hasSubmissionCategory(app, file)) {
			new SubmitModal(app, file, (result) => {
				void performSubmit(app, details, gate, file, result, store, existingDocId, true);
			}).open();
			return;
		}

		// `category` is there, so a first submit did happen and the author has
		// since emptied `title` (or made `category` one of nothing). Refused
		// rather than re-collected: writing those back is the repeat write the
		// contract forbids.
		new Notice(INCOMPLETE_FRONT_MATTER_MESSAGE);
		return;
	}

	new SubmitModal(
		app,
		file,
		(result) => {
			void performSubmit(app, details, gate, file, result, store, existingDocId);
		},
		existing
	).open();
}

/**
 * The write sequence itself: resolve `doc_id`, establish the state of the
 * document on the remote, then write what that state calls for. Front matter
 * and the tracking record are written only after the remote writes succeed —
 * see `front-matter.ts` and design.md's ordering decision.
 *
 * The one fork here is first submit versus resubmit, and it turns on whether
 * a `doc_id` is already frozen in this note's front matter. Everything below
 * that fork is the two paths' own; what they share is `openNewCycle`, and
 * they share it because "commit to a fresh branch, open a submission, record
 * it" is genuinely one sequence and not three that happen to look alike.
 */
async function performSubmit(
	app: App,
	details: ConnectionDetails,
	state: ConnectionState,
	file: TFile,
	result: SubmitModalResult,
	store: SubmissionStore,
	/**
	 * The note's frozen `doc_id`, or null when it has none yet. Passed in
	 * rather than re-read: `submitForReview` already read it to choose the
	 * modal's shape, and reading it twice across an `await` is two chances to
	 * get two answers for one document.
	 *
	 * Load-bearing rather than adjacent — without it, renaming the file
	 * re-derives a different `doc_id`, finds an absent target, and submits the
	 * same document a second time under a second identity, which is the
	 * corruption this whole sequence exists to prevent.
	 */
	existingDocId: string | null,
	/**
	 * Whether the note still needs `title` and `category` written to it —
	 * true only for an imported document taking its first submit, which has a
	 * frozen `doc_id` but has never been through the moment those two are
	 * written. False for every other resubmit, where they are the author's by
	 * hand and are never rewritten.
	 */
	completeFields = false
): Promise<void> {
	const docId = existingDocId ?? deriveDocId(file.basename);
	if (docId === null) {
		new Notice(INVALID_FILENAME_MESSAGE);
		return;
	}

	const branch = branchForDocId(docId);
	if (existingDocId !== null) {
		await performResubmit(app, details, file, result, store, docId, branch, completeFields);
		return;
	}

	// add-document-recovery's path-collision pre-flight, unchanged and still
	// first-submit-only. A document already tracked by this vault owns its
	// own path across every revision and cannot collide with a stranger by
	// definition — asking this question about a document's own second submit
	// would trivially answer yes about itself (that change's design.md
	// decision 5). The resubmit path asks the two questions that ARE right
	// for a second submit instead; see `performResubmit`.
	//
	// Hands back the default branch it had to read to ask the question, which
	// is the ref the write below is cut from and the ref every file's verb is
	// decided against. Read once and passed along rather than read again: two
	// reads are two chances to get two answers for one commit.
	const defaultBranch = await checkTargetPathFree(details, file.path);
	if (defaultBranch === null) {
		return;
	}

	if (!(await clearPreviousAttempt(details, branch))) {
		return;
	}

	// Read AFTER the pre-flight, not before: what reaches the remote must be
	// the note as it stands at the moment of the successful submit, never
	// what an earlier attempt left there.
	const localContent = await app.vault.read(file);

	// On a FIRST submit, `title`/`category`/`doc_id` are written to the LOCAL
	// note only after the remote write below succeeds (`writeSubmissionFrontMatter`
	// has no rollback path for `doc_id`, so it must not run speculatively).
	// Left at that, the content actually committed here would carry none of
	// the three — silently breaking `docs/document-identity.md` §2's "doc_id
	// is committed with the note", which a fresh pull on a second machine (and
	// this project's own recovery) depends on. Merged into the COMMITTED
	// string only, in memory; the note itself stays untouched until success.
	// Not needed on a resubmission: the local content already carries all
	// three, written after this document's own first submit.
	const content = withSubmissionFrontMatter(localContent, {
		title: result.title,
		category: result.category,
		docId,
	});

	const files = await collectSubmissionFiles(app, details, file, content, defaultBranch);
	if (files === null) {
		return;
	}

	await openNewCycle(app, details, file, result, store, {
		docId,
		branch,
		files,
		completeFrontMatter: { title: result.title, category: result.category },
	});
}

/**
 * The note plus the images it embeds, each with the verb that writes it —
 * every write path's single source for what a submission carries, so none of
 * the four can commit the note alone (tasks.md 5.4).
 *
 * `ref` is the ref the commit lands on, and every file's verb is decided
 * against it: the project's default branch for the three paths that cut a
 * fresh branch from it, and the document's own branch for a revision pushed to
 * one already under review.
 *
 * Returns null when something failed, having already told the author. Embed
 * resolution itself cannot fail — an embed that resolves to nothing is
 * skipped, never refused (design.md decision 2) — so a null here is always the
 * remote, never the note.
 */
async function collectSubmissionFiles(
	app: App,
	details: ConnectionDetails,
	file: TFile,
	content: string,
	ref: string
): Promise<CommitFileAction[] | null> {
	const attachmentPaths = resolveEmbeddedAttachments(file.path, vaultEmbedIndex(app));
	const files = await buildSubmissionFiles(
		{ notePath: file.path, noteContent: content, attachmentPaths },
		submissionFileReads(app, details, ref)
	);
	if (!files.ok) {
		reportFailure(files);
		return null;
	}

	return files.value;
}

/**
 * The second submit onward. Asks what state this document is actually in and
 * acts on all four answers, where the old pre-flight asked two narrower
 * questions — does the branch exist, does it have an open submission — and
 * had no way to express two of the four outcomes (`docs/resubmission-
 * lifecycle.md` §1).
 *
 * The two pre-submit checks run FIRST, in the order
 * `docs/document-identity.md` §4 fixes and for the reason it gives: reversed,
 * a duplicated note reads as "moved" and the author is told to move a file
 * that is already exactly where it belongs. Both bind for every resolved
 * state, not for some of them — including the not-accepted path, which
 * acquires them here for the first time.
 */
async function performResubmit(
	app: App,
	details: ConnectionDetails,
	file: TFile,
	result: SubmitModalResult,
	store: SubmissionStore,
	docId: string,
	branch: string,
	/** See `performSubmit`'s parameter of the same name. */
	completeFields: boolean
): Promise<void> {
	// Check one. Purely local, so it costs no round trip and runs before any
	// remote call at all — which is both what §4's ordering requires and,
	// independently, the cheapest question to ask first.
	const duplicate = findDuplicateNote(app, file, docId);
	if (duplicate !== null) {
		new Notice(duplicateDocIdMessage(duplicate.path));
		return;
	}

	const resolved = await resolveDocumentState(details, docId);
	if (!resolved.ok) {
		reportFailure(resolved);
		return;
	}

	const { document, remotePath } = resolved.value;

	// Check two. A null `remotePath` means the path was never ESTABLISHED —
	// no submission to read it from, or a submission that changed something
	// other than exactly one file — and is never read as "no path": refusing
	// on it would mean naming a path to restore that nobody ever read.
	if (remotePath !== null && remotePath !== file.path) {
		new Notice(pathMismatchMessage(remotePath));
		return;
	}

	const localContent = await app.vault.read(file);

	// An imported document's first submit has to merge `title` and `category`
	// into what is COMMITTED, exactly as a first submit does and for the
	// identical reason (see `withSubmissionFrontMatter`): the local note is
	// not written until the remote write has succeeded, so without this the
	// content actually pushed would carry neither. `doc_id` is already in the
	// block, frozen at import, and the merge replaces rather than duplicates
	// it. Every other resubmit passes the note through untouched.
	const content = completeFields
		? withSubmissionFrontMatter(localContent, {
				title: result.title,
				category: result.category,
				docId,
			})
		: localContent;

	// The two fields to write to the NOTE itself once the remote has accepted
	// the write, on the same one-moment rule `performSubmit` follows.
	const completeFrontMatter = completeFields
		? { title: result.title, category: result.category }
		: undefined;

	// A frozen `doc_id` the remote holds nothing for. Not one of the four
	// tracked states and not a first submit either: the note has been through
	// one, and whatever it produced is gone. Cut fresh, exactly as the old
	// pre-flight did for the same case — it is what keeps an interrupted
	// attempt recoverable by pressing the same button again.
	if (document.submission === null) {
		if (!(await clearPreviousAttempt(details, branch))) {
			return;
		}

		const defaultBranch = await getDefaultBranch(details);
		if (!defaultBranch.ok) {
			reportFailure(defaultBranch);
			return;
		}

		// The verb is READ here, where it used to be hardcoded to `create`. The
		// two are the same answer for the ordinary case this path exists for —
		// an attempt that never reached the default branch — and differ for the
		// one it also catches: a document whose record was lost after it was
		// published, whose file IS on the default branch and for which `create`
		// is rejected outright. Reading it costs one request and follows the
		// same rule every other file now follows (design.md decision 3).
		const files = await collectSubmissionFiles(app, details, file, content, defaultBranch.value);
		if (files === null) {
			return;
		}

		await openNewCycle(app, details, file, result, store, {
			docId,
			branch,
			files,
			completeFrontMatter,
		});
		return;
	}


	const submission = document.submission;
	switch (submission.state) {
		case 'pending':
		case 'changes-requested':
			await pushUpdate(app, details, file, store, {
				docId,
				branch,
				content,
				state: submission.state,
				mrIid: submission.mrIid,
				completeFrontMatter,
			});
			return;

		case 'published':
		case 'closed':
			await openFreshCycle(app, details, file, result, store, {
				docId,
				branch,
				content,
				completeFrontMatter,
			});
			return;
	}
}

/**
 * A document already under review, revised. The branch and the submission
 * both exist and are left exactly as they are: this commits to the branch and
 * stops.
 *
 * `last_commit_id` is read HERE rather than carried over from the state
 * resolution above, and the extra request is the point. Resolution reads the
 * submission, not the file's current commit on the branch, and the two can be
 * moments apart — a reviewer editing in the Web IDE between them is precisely
 * the case `last_commit_id` exists to catch, and reusing a stale value would
 * turn the guard into decoration.
 *
 * The same read now covers the attachments too, against this document's OWN
 * branch rather than the default one: an image added to the note since the
 * last revision belongs in this commit, and an image already sitting on this
 * branch from a previous revision is an update to it.
 */
async function pushUpdate(
	app: App,
	details: ConnectionDetails,
	file: TFile,
	store: SubmissionStore,
	params: {
		docId: string;
		branch: string;
		content: string;
		state: SubmissionState;
		mrIid: number;
		/** Present only for an imported document's first submit; see `performSubmit`. */
		completeFrontMatter?: { title: string; category: Category };
	}
): Promise<void> {
	const files = await collectSubmissionFiles(app, details, file, params.content, params.branch);
	if (files === null) {
		return;
	}

	// The note is first by construction, so this is the note's own verb. An
	// image newly embedded since the last revision is legitimately a `create`
	// in this same commit; the NOTE being a create is not — it would mean the
	// file is not on the branch at all.
	if (files[0]?.action !== 'update') {
		// The path check above passed, so either it had no remote path to
		// compare against or the file sits elsewhere on the branch than the
		// submission's own changed path said. Either way there is nothing here
		// to update, and creating a second file under the same identity is the
		// corruption this whole sequence exists to prevent.
		console.error(
			`Docs Publisher: ${file.path} is not on ${params.branch}; refusing to push an update for ${params.docId}.`
		);
		new Notice(SUBMIT_FAILED_MESSAGE);
		return;
	}

	const commit = await commitToBranch(details, { branch: params.branch, files });
	if (!commit.ok) {
		reportFailure(commit);
		return;
	}

	// NOTHING is written to the note here on an ordinary resubmit. `title` and
	// `category` are the author's own from the first submit onward and the
	// plugin never writes them again (`openspec/config.yaml`'s front matter
	// contract); `doc_id` is frozen and already present. Writing them back
	// used to happen on every resubmit, and cost more than the contract
	// breach: the content committed moments ago was read BEFORE that write, so
	// every revision pushed the PREVIOUS revision's `title`. Observed
	// 2026-09-12 — see `docs/resubmission-lifecycle.md`.
	//
	// The ONE exception is an imported document's first submit, which reaches
	// this path when a teammate already has a review open from the same
	// branch. That note has never been through the moment those two fields are
	// written, so this is that moment rather than a repeat of it — the same
	// reasoning `submitForReview` states where it decides to collect them.
	if (params.completeFrontMatter !== undefined) {
		await writeSubmissionFrontMatter(app, file, {
			...params.completeFrontMatter,
			docId: params.docId,
		});
	}

	// The state the REMOTE just reported, carried through unchanged — never
	// set to `pending` here. A revision does not resolve an open review
	// thread, so a document pushed while changes-requested is still
	// changes-requested until the thread is resolved and the next refresh
	// says so (design.md decision 6).
	await store.save({
		docId: params.docId,
		branch: params.branch,
		mrIid: params.mrIid,
		state: params.state,
		path: file.path,
	});
	new Notice(UPDATE_SENT_MESSAGE);
}

/**
 * A new review cycle for a document whose last one is over — published, or
 * turned down. Both cut a fresh branch from the CURRENT default branch under
 * the same frozen identity (`docs/document-identity.md` §5) and open a new
 * submission; what differs is only the commit verb, and that difference is
 * read from the remote rather than inferred from the state:
 *
 * - published → the file IS on the default branch, so the write updates it
 *   and carries its current commit id. Committing `create` over it is the
 *   bug this change exists to fix (`docs/resubmission-lifecycle.md` §2).
 * - not accepted → the file was never merged, so nothing is there and the
 *   write creates it. There is no commit id for a `create` to be stale
 *   relative to.
 *
 * Asking rather than assuming costs one read and covers the cases the state
 * alone gets wrong: a published document whose file a Maintainer has since
 * moved or removed, and a turned-down document whose path someone else has
 * published into meanwhile.
 */
async function openFreshCycle(
	app: App,
	details: ConnectionDetails,
	file: TFile,
	result: SubmitModalResult,
	store: SubmissionStore,
	params: {
		docId: string;
		branch: string;
		content: string;
		/** Present only for an imported document's first submit; see `performSubmit`. */
		completeFrontMatter?: { title: string; category: Category };
	}
): Promise<void> {
	// A merged submission's branch is normally gone — GitLab deletes it — and
	// a turned-down one's is normally still there. Neither is guaranteed, so
	// the branch is cleared if present either way. Safe for both: resolution
	// has just established that nothing is open from this branch, so there is
	// no review for this delete to disturb.
	if (!(await clearAbandonedBranch(details, params.branch))) {
		return;
	}

	const defaultBranch = await getDefaultBranch(details);
	if (!defaultBranch.ok) {
		reportFailure(defaultBranch);
		return;
	}

	const files = await collectSubmissionFiles(app, details, file, params.content, defaultBranch.value);
	if (files === null) {
		return;
	}

	await openNewCycle(app, details, file, result, store, {
		docId: params.docId,
		branch: params.branch,
		files,
		completeFrontMatter: params.completeFrontMatter,
	});
}

/**
 * Cut a branch, commit to it, open a submission, record it. The one sequence
 * every path that starts a review cycle ends in — a first submit, a published
 * document's next cycle, and a turned-down document's — so none of the three
 * can drift from the others in what it writes or in what the author is told.
 *
 * `pending` is not optimistic here, unlike the revision path above: the
 * submission was created moments ago, it is open by construction, and it
 * cannot yet carry a review thread. It is what the remote holds.
 */
async function openNewCycle(
	app: App,
	details: ConnectionDetails,
	file: TFile,
	result: SubmitModalResult,
	store: SubmissionStore,
	params: {
		docId: string;
		branch: string;
		/**
		 * Everything this commit carries — the note first, then the images it
		 * embeds — each already holding its own verb and, where it updates, its
		 * own guard. Built by `collectSubmissionFiles` against the ref this
		 * branch is cut from, so no path here can commit the note alone.
		 */
		files: readonly CommitFileAction[];
		/**
		 * The three fields to complete on the NOTE once the remote has accepted
		 * the write — present only on a FIRST submit, which is the one moment
		 * the plugin may write `title` and `category`. A resubmit passes
		 * nothing: both fields are already there, are the author's by hand from
		 * that moment on, and are never rewritten.
		 */
		completeFrontMatter?: { title: string; category: Category };
	}
): Promise<void> {
	const commit = await createBranchWithCommit(details, {
		branch: params.branch,
		files: params.files,
	});
	if (!commit.ok) {
		reportFailure(commit);
		return;
	}

	const mergeRequest = await createMergeRequest(details, {
		sourceBranch: params.branch,
		title: result.title,
	});
	if (!mergeRequest.ok) {
		reportFailure(mergeRequest);
		return;
	}

	if (params.completeFrontMatter !== undefined) {
		await writeSubmissionFrontMatter(app, file, {
			title: params.completeFrontMatter.title,
			category: params.completeFrontMatter.category,
			docId: params.docId,
		});
	}

	// `path` captured going forward as of add-document-recovery — the fast
	// path every recovery attempt after this one prefers over the
	// merge-request fallback (that change's design.md decision 1).
	await store.save({
		docId: params.docId,
		branch: params.branch,
		mrIid: mergeRequest.value.iid,
		state: 'pending',
		path: file.path,
	});
	new Notice(SUBMISSION_STATE_LABELS.pending);
}

/**
 * Any OTHER note in the vault claiming this note's `doc_id`
 * (`docs/document-identity.md` §3-4). Compared by path rather than by
 * identity so a note is never mistaken for its own duplicate.
 *
 * Reads the same vault-wide front-matter scan the panel's list is built from
 * — Obsidian's metadata cache, already in memory — rather than the store: a
 * duplicate created by copying a note has no record of its own, which is
 * exactly the case this check exists to catch.
 */
function findDuplicateNote(app: App, file: TFile, docId: string): TFile | null {
	for (const entry of listVaultDocuments(app)) {
		if (entry.docId === docId && entry.file.path !== file.path) {
			return entry.file;
		}
	}

	return null;
}

/**
 * The path-collision pre-flight (design.md decision 4): does a file already
 * exist at this exact path on the project's default branch, independent of
 * whether any branch or merge request for it still exists? Complementary to
 * `clearPreviousAttempt` below, not a replacement for it — an open, unmerged
 * submission's content sits on its own branch, not yet on the default one,
 * so this correctly answers "no" for that case and the existing check still
 * catches it. Runs first because it is the stronger signal and because it is
 * what turns a bare refusal into an offer to recover.
 *
 * Exists → refuse and offer recovery, using the content this same read
 * already has in hand — no second request to show what was just read.
 * Absent → the path is free, proceed. Failed → refuse; a failed read is
 * never treated as absence, the same mistake `branchExists`'s own design
 * note warns against (design.md decision 2).
 *
 * Answers with the default branch it read rather than a bare `true`, since
 * the caller needs that same ref to decide every file's verb against and
 * reading it twice would be two answers for one commit. Null is the refusal,
 * and the author has already been told why.
 */
async function checkTargetPathFree(
	details: ConnectionDetails,
	path: string
): Promise<string | null> {
	const defaultBranch = await getDefaultBranch(details);
	if (!defaultBranch.ok) {
		reportFailure(defaultBranch);
		return null;
	}

	const existing = await getFileContent(details, { path, ref: defaultBranch.value });
	if (!existing.ok) {
		reportFailure(existing);
		return null;
	}

	if (!existing.value.exists) {
		return defaultBranch.value;
	}

	// LOGGED, because this refusal is the one the author cannot check.
	// Every other failure here writes its URL, status and classification to
	// the console; this one succeeded — it read a file and found one — so it
	// wrote nothing, and an author told "a document already exists" had no way
	// to see WHICH project, WHICH ref, or WHICH path was meant. Added
	// 2026-09-20, after exactly that question could not be answered from the
	// outside.
	console.error(
		`Docs Publisher: refusing to submit ${path} — a file already exists there ` +
			`on ${defaultBranch.value} of project ${details.projectId}.`
	);

	// Plain text, ordinary duration. This was a DocumentFragment carrying a
	// Recover button held open until dismissed; see `ALREADY_PUBLISHED_MESSAGE`
	// for why that button could never do anything. A notice that only reports
	// behaves like every other notice here.
	new Notice(ALREADY_PUBLISHED_MESSAGE);
	return null;
}

/**
 * The FIRST-SUBMIT pre-flight. Establishes which of three states `branch` is
 * in and acts on the answer, returning whether the caller may proceed to
 * write. Every `false` return has already told the author why, and has
 * written nothing.
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
 *
 * NARROWED as of add-resubmission-lifecycle: this no longer runs for a
 * document that is already tracked. `performResubmit` resolves real state
 * instead, which answers the same two questions and two more besides — and
 * the open-submission refusal below, which used to be a resubmit's dead end,
 * is now only reachable where it is actually ambiguous. The one resubmit case
 * that still comes through here is a `doc_id` the remote holds no submission
 * for, where the questions this asks are again the right ones.
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
 * `clearPreviousAttempt` without the open-submission question, for the one
 * caller that has already had it answered: state resolution has established
 * that this document's last cycle is over, so there is no review a delete
 * here could disturb and no reason to spend a second read asking again.
 *
 * A failed presence lookup still refuses, for the reason stated above — a
 * failure read as absence licenses a delete that must not happen.
 */
async function clearAbandonedBranch(details: ConnectionDetails, branch: string): Promise<boolean> {
	const presence = await branchExists(details, branch);
	if (!presence.ok) {
		reportFailure(presence);
		return false;
	}

	if (!presence.value.exists) {
		return true;
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

	// Takes precedence over the step's own `message` rather than deferring to
	// it, and can do so safely: only a commit can be refused this way, and no
	// step that passes its own message sends one.
	if (result.failure === 'content-changed') {
		new Notice(CONTENT_CHANGED_MESSAGE);
		return;
	}

	// Same precedence and the same reasoning. "The document could not be
	// submitted, try again" is actively wrong here: an empty project does not
	// become non-empty by retrying, and this is the one failure whose fix is
	// a thing the author does on the platform rather than in the plugin.
	if (result.failure === 'empty-repository') {
		new Notice(EMPTY_REPOSITORY_MESSAGE);
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
