/**
 * What a submission actually carries: the note, and every attachment it
 * embeds, each with the verb that writes it.
 *
 * Structured the same way `embeds.ts` is and for the same reason — the two
 * effects it needs are behind an interface, so the rule this file exists to
 * express (verbs, encodings, ordering, and what is skipped) is testable
 * without a vault or a server. `vault-attachments.ts` supplies the real one.
 */

import type { ClientResult, CommitFileAction, FileCommitId } from '../git-publishing/gitlab-client';

export interface SubmissionFileReads {
	/**
	 * The attachment's bytes, base64-encoded, or null when it cannot be read.
	 *
	 * Null is an ordinary answer rather than an error: a file deleted between
	 * the moment its embed resolved and the moment it was read is the author's
	 * own note being out of date, which `embeds.ts` already refuses to fail a
	 * submission over. Skipping it here keeps that promise on this side of the
	 * seam too.
	 */
	readAttachment(path: string): Promise<string | null>;
	/**
	 * Whether this path already exists on the ref being committed to, and at
	 * which commit — `getFileCommitId`, bound to that ref. A failed read is a
	 * failure and never absence; see `decideAction`.
	 */
	commitIdAt(path: string): Promise<ClientResult<FileCommitId>>;
}

/**
 * Builds the whole actions list for one submission: the note first, then its
 * attachments in the order the note embeds them.
 *
 * THE NOTE IS FIRST BY CONSTRUCTION, and one thing depends on it —
 * `commitMessage` in `gitlab-client.ts` names the first file, and the commit
 * is about the document rather than about the pictures in it. GitLab itself is
 * not documented to care about the order, so nothing else does (design.md's
 * open question, settled here).
 *
 * A failure to establish any one file's verb aborts the whole build and
 * nothing is written. That is the same refusal `getFileCommitId`'s own
 * docstring argues for: a failed read taken as absence would send a `create`
 * at a path that already holds a file, or an update with no staleness guard
 * at all.
 */
export async function buildSubmissionFiles(
	params: { notePath: string; noteContent: string; attachmentPaths: readonly string[] },
	reads: SubmissionFileReads
): Promise<ClientResult<CommitFileAction[]>> {
	const note = await decideAction(params.notePath, params.noteContent, reads);
	if (!note.ok) {
		return note;
	}

	const files: CommitFileAction[] = [note.value];

	for (const path of params.attachmentPaths) {
		// Read the bytes BEFORE asking about the verb: an attachment that has
		// since vanished is skipped, and spending a round trip establishing the
		// verb of a file that is not going to be committed would be waste.
		const content = await reads.readAttachment(path);
		if (content === null) {
			console.error(`Docs Publisher: ${path} could not be read; submitting without it.`);
			continue;
		}

		const attachment = await decideAction(path, content, reads);
		if (!attachment.ok) {
			return attachment;
		}

		files.push({ ...attachment.value, encoding: 'base64' });
	}

	return { ok: true, value: files };
}

/**
 * One file's verb, READ from the ref rather than assumed from anything about
 * the document's state — the rule `add-resubmission-lifecycle` established for
 * the note, applied to every file without exception (design.md decision 3).
 *
 * Present → `update`, carrying that file's own `last_commit_id` so the write
 * fails rather than silently overwriting a file that moved on since it was
 * read. Absent → `create`, which has nothing to be stale relative to.
 *
 * No case distinguishes a note from an attachment. A logo shared by twenty
 * documents is already on the default branch and is an update; a screenshot
 * nobody has published is a create. Costs one read per file per submit,
 * accepted because a document embeds a handful of images and the alternative
 * is guessing the verb — precisely the bug `add-resubmission-lifecycle`
 * existed to fix.
 */
async function decideAction(
	path: string,
	content: string,
	reads: SubmissionFileReads
): Promise<ClientResult<CommitFileAction>> {
	const current = await reads.commitIdAt(path);
	if (!current.ok) {
		return current;
	}

	return {
		ok: true,
		value: current.value.exists
			? { filePath: path, content, action: 'update', lastCommitId: current.value.commitId }
			: { filePath: path, content, action: 'create' },
	};
}
