import { AUTHOR_MESSAGES } from '../author-messages';
import { fetchedBranchRef } from '../git-publishing/ref-names';
import { readFileAt, readRef, writeSent } from '../git-publishing/repo';
import type { RepoContext } from '../git-publishing/repo';
import { deriveDocument, loadSnapshot } from '../submission-tracking/derive-state';

/**
 * Reading the version a document has under review, for Reset
 * (replace-rest-with-local-git-ssh task 3.7; doc-authoring "Reset replaces a
 * note's content with the version under review").
 *
 * Reads only the fetched copy and makes no request. The answer is three-way and
 * is never softened: a review that has ended, and a path the branch does not
 * hold, are refusals, not a reason to read the default branch instead — that
 * holds a different round's text, which the author did not ask for and which
 * would be written over their work. A read that failed is a failure, not an
 * absence.
 */
export type ResetPlan =
	| {
			kind: 'ready';
			docId: string;
			/** Written verbatim into the note, front matter included. */
			content: string;
			/** The branch tip the content is from, to be recorded as seen. */
			tip: string;
	  }
	| { kind: 'refused'; message: string };

export async function readVersionUnderReview(local: RepoContext, docId: string): Promise<ResetPlan> {
	const snapshot = await loadSnapshot(local);
	if (!snapshot.ok) {
		return { kind: 'refused', message: AUTHOR_MESSAGES.resetReadFailed };
	}
	if (snapshot.value === null) {
		// Nothing has been fetched, so nothing is known to be under review.
		return { kind: 'refused', message: AUTHOR_MESSAGES.resetFinished };
	}
	const derived = await deriveDocument(local, snapshot.value, docId);
	if (!derived.ok) {
		return { kind: 'refused', message: AUTHOR_MESSAGES.resetReadFailed };
	}
	// Only a document with a live review can be reset: one that has finished
	// since the last look, or was never derived, is told so.
	if (derived.value.state !== 'pending' || derived.value.remotePath === null) {
		return { kind: 'refused', message: AUTHOR_MESSAGES.resetFinished };
	}

	const ref = fetchedBranchRef(docId);
	const tip = await readRef(local, ref);
	if (!tip.ok || tip.value === null) {
		return { kind: 'refused', message: AUTHOR_MESSAGES.resetReadFailed };
	}
	const file = await readFileAt(local, ref, derived.value.remotePath);
	if (file.kind === 'failed') {
		return { kind: 'refused', message: AUTHOR_MESSAGES.resetReadFailed };
	}
	if (file.kind === 'absent') {
		// The caller's understanding of the state is stale. Never the default branch.
		return { kind: 'refused', message: AUTHOR_MESSAGES.resetFinished };
	}
	return { kind: 'ready', docId, content: file.bytes.toString('utf8'), tip: tip.value };
}

/**
 * Records the branch tip the note now matches as the last commit this vault has
 * seen for the document, so the commits that came in with it stop counting as
 * someone else's and a later update is not refused for them. Returns whether it
 * was recorded; a note that was reset but not recorded still sends, after the
 * author resets once more.
 */
export async function recordSeen(local: RepoContext, docId: string, tip: string): Promise<boolean> {
	const written = await writeSent(local, docId, tip);
	return written.ok;
}
