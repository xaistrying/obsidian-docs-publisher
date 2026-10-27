import { AUTHOR_MESSAGES } from '../author-messages';
import type { GitFailureKind } from '../git-publishing/failures';
import { setupMessageFor } from '../platform-config/setup-messages';
import { stepForFailure } from '../platform-config/setup-state';

/**
 * What a failed update tells the author, and whether it sends them back to a
 * setup step (vault-sync "A failed update says what to do and routes setup
 * problems to the checklist"). A network failure, a timeout and anything
 * unclassified are told the same way, naming no cause; a key GitLab no longer
 * accepts, a missing git and the rest of setup's problems say their own thing,
 * because a retry cannot fix them.
 */
export function updateFailureMessage(failure: GitFailureKind): { message: string; setup: boolean } {
	if (stepForFailure(failure) !== null) {
		return { message: setupMessageFor(failure), setup: true };
	}
	return { message: AUTHOR_MESSAGES.updateFailed, setup: false };
}
