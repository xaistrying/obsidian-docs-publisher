import { AUTHOR_MESSAGES } from '../author-messages';
import type { GitFailureKind } from '../git-publishing/failures';

/**
 * What a setup action tells the author when it fails, by kind
 * (platform-config "Setup problems are reported with a message that names what
 * to do next"). One table, so the settings tab and the panel cannot word the
 * same failure differently.
 *
 * A timeout reads as an unreachable server here: for a test, a connect or a
 * refresh the author's next move is the same — check the connection and try
 * again — and a separate "timed out" message would name a cause they cannot
 * act on (design.md D7). Publishing and getting updates word their own
 * timeouts, in their own modules.
 *
 * Kinds that mean nothing for setup (the push-only ones) fall through to the
 * generic line rather than inventing advice.
 */
export function setupMessageFor(kind: GitFailureKind): string {
	switch (kind) {
		case 'git-missing':
			return AUTHOR_MESSAGES.gitMissing;
		case 'identity-missing':
			return AUTHOR_MESSAGES.identityMissing;
		case 'address-invalid':
			return AUTHOR_MESSAGES.addressInvalid;
		case 'ssh-missing':
			return AUTHOR_MESSAGES.sshMissing;
		case 'key-rejected':
			return AUTHOR_MESSAGES.keyRejected;
		case 'key-protected':
			return AUTHOR_MESSAGES.keyProtected;
		case 'key-unreadable':
			return AUTHOR_MESSAGES.keyUnreadable;
		case 'key-exists':
			return AUTHOR_MESSAGES.keyExists;
		case 'address-rewritten':
			return AUTHOR_MESSAGES.addressRewritten;
		case 'host-changed':
			return AUTHOR_MESSAGES.hostChanged;
		case 'server-unreachable':
		case 'timed-out':
			return AUTHOR_MESSAGES.serverUnreachable;
		case 'project-not-found':
			return AUTHOR_MESSAGES.projectNotFound;
		case 'empty-repository':
			return AUTHOR_MESSAGES.emptyProject;
		case 'not-allowed':
		case 'changed-meanwhile':
		case 'unexpected':
			return AUTHOR_MESSAGES.setupUnexpected;
	}
}
