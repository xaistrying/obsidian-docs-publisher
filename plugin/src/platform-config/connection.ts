import type { ConnectionDetails } from '../git-publishing/gitlab-client';

export const MISSING_DETAILS_MESSAGE = "Add your GitLab details in the plugin's settings first.";

/**
 * A fresh, empty set of details. Held on the plugin instance for the running
 * session only — deliberately never passed to `saveData`, so quitting Obsidian
 * or reloading the plugin discards the token rather than leaving it in a file
 * that vault sync would replicate.
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
