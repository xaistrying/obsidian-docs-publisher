import { Notice } from 'obsidian';
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

/**
 * Guard for any action that needs the connection details. Returns them when
 * all three are present; otherwise tells the author where to enter them and
 * returns null so the caller stops without attempting anything.
 */
export function requireConnectionDetails(details: ConnectionDetails): ConnectionDetails | null {
	if (!hasConnectionDetails(details)) {
		new Notice(MISSING_DETAILS_MESSAGE);
		return null;
	}

	return details;
}
