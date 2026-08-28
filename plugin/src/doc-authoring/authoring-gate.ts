import { Notice } from 'obsidian';
import type { ConnectionDetails } from '../git-publishing/gitlab-client';
import { NO_DOCUMENT_ACCESS_MESSAGE, readOnlyMessage } from '../platform-config/access-messages';
import { MISSING_DETAILS_MESSAGE, hasConnectionDetails } from '../platform-config/connection';
import type { ConnectionState } from '../platform-config/connection-state';
import { grantsAuthoring, grantsReadOnly } from '../platform-config/connection-state';

export const UNCHECKED_CONNECTION_MESSAGE =
	"Test your connection in the plugin's settings before creating a document.";

/**
 * The gate shared by every authoring action — document creation and submit
 * alike — in the order the author's next action changes: details they never
 * entered, a check they never ran, then a role that cannot author.
 *
 * Returns the verified state (identity and access included) when all three
 * pass, and otherwise says what to do next and returns null so the caller
 * stops before touching the vault or the network.
 */
export function requireAuthoringGate(
	details: ConnectionDetails,
	state: ConnectionState
): Extract<ConnectionState, { kind: 'verified' }> | null {
	if (!hasConnectionDetails(details)) {
		new Notice(MISSING_DETAILS_MESSAGE);
		return null;
	}

	// Anything that is not a succeeded check: never run, still running, failed,
	// or discarded because a detail was edited. The author's next step is the
	// same in each, and no check is started on their behalf here.
	if (state.kind !== 'verified') {
		new Notice(UNCHECKED_CONNECTION_MESSAGE);
		return null;
	}

	if (!grantsAuthoring(state)) {
		new Notice(
			grantsReadOnly(state) ? readOnlyMessage(state.access.accessLabel) : NO_DOCUMENT_ACCESS_MESSAGE
		);
		return null;
	}

	return state;
}
