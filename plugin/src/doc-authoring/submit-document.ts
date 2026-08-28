import { Notice } from 'obsidian';
import type { App, TFile } from 'obsidian';
import type { ConnectionDetails, FailureKind } from '../git-publishing/gitlab-client';
import { createBranchWithCommit, createMergeRequest } from '../git-publishing/gitlab-client';
import type { ConnectionState } from '../platform-config/connection-state';
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
 * The undifferentiated failure message per design.md's punt decision: a
 * remote rejection (the branch already exists) and a failure of unknown
 * outcome (a dropped connection) are told to the author identically. The
 * fix is the same either way — rename the file, submit again — because
 * `doc_id` never froze on a failed attempt. Vocabulary-checked: no
 * "branch", "commit", "merge request", "MR", "conflict", or "main".
 */
export const SUBMIT_FAILED_MESSAGE =
	"Submit didn't go through. This can happen from a dropped connection, or " +
	'because another document is already using this file name. Rename the ' +
	'file to get a new ID, then submit again.';

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
 * The write sequence itself: derive and validate `doc_id`, create the
 * branch and commit, then the merge request. Front matter and the tracking
 * record are written only after both remote calls succeed — see
 * `front-matter.ts` and design.md's ordering decision.
 */
async function performSubmit(
	app: App,
	details: ConnectionDetails,
	file: TFile,
	result: SubmitModalResult,
	store: SubmissionStore
): Promise<void> {
	const docId = deriveDocId(file.basename);
	if (docId === null) {
		new Notice(INVALID_FILENAME_MESSAGE);
		return;
	}

	const branch = `doc/${docId}`;
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
 * One undifferentiated failure, per design.md's punt decision — except the
 * permission-scoped kind, which names what's missing when GitLab reported
 * it. Neither branch inspects *why* beyond that one classification.
 */
function reportFailure(result: { failure: FailureKind; detail?: string }): void {
	if (result.failure === 'insufficient-permission') {
		new Notice(insufficientPermissionMessage(result.detail));
		return;
	}

	new Notice(SUBMIT_FAILED_MESSAGE);
}

function insufficientPermissionMessage(detail: string | undefined): string {
	if (detail === undefined) {
		return SUBMIT_FAILED_MESSAGE;
	}

	return (
		`Your access token doesn't have permission to submit documents ` +
		`(missing: ${detail}). Ask your admin to add it.`
	);
}
