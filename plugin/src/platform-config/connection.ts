import type { ConnectionDetails } from '../git-publishing/gitlab-client';

export const MISSING_DETAILS_MESSAGE = "Add your GitLab details in the plugin's settings first.";

/**
 * A fresh, empty set of details, held on the plugin instance.
 *
 * AMENDED 2026-09-30 (persist-connection-settings): the address and project
 * ID are remembered once tested, through `SubmissionStore.saveConnection`,
 * which copies only those two. The token alone is never persisted, so
 * quitting Obsidian or reloading the plugin discards it rather than leaving
 * it in a file that vault sync would replicate.
 */
export function createEmptyConnectionDetails(): ConnectionDetails {
	return { host: '', projectId: '', token: '' };
}

export function hasConnectionDetails(details: ConnectionDetails): boolean {
	return (
		details.host.trim() !== '' &&
		details.projectId.trim() !== '' &&
		details.token.trim() !== ''
	);
}
