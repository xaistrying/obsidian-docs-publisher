import type { FailureKind, Identity, ProjectAccess } from '../git-publishing/gitlab-client';

/**
 * The outcome of the most recent connection check, for the running session
 * only. Never persisted: it describes details that are themselves
 * session-scoped, so it must not outlive them.
 *
 * "Connected fine, but the role grants nothing" is deliberately not a fifth
 * kind — it is `verified` with an access level below the threshold below.
 * The connection genuinely succeeded, and modelling it as a failure would
 * throw away the identity, which is exactly what tells the author their
 * details were accepted and their role is the problem.
 */
export type ConnectionState =
	| { kind: 'unverified' }
	| { kind: 'checking' }
	| { kind: 'verified'; identity: Identity; access: ProjectAccess }
	| { kind: 'failed'; failure: FailureKind; identity: Identity | null };

/**
 * The lowest access level that can read the project's documents. Planner is
 * the floor: Planner and Reporter can view the repository and the review
 * queue, while Guest and below see nothing at all in a private project. See
 * `docs/gitlab-roles.md` §3.
 */
export const DOCUMENT_ACCESS_LEVEL = 15;

type Listener = (state: ConnectionState) => void;

/**
 * Holds the current state and notifies whoever is displaying it. The settings
 * tab writes; the settings tab and the sidebar panel read. Neither knows the
 * other exists, so each works when the other has never been constructed.
 */
class ConnectionStateHolder {
	private state: ConnectionState = { kind: 'unverified' };
	private readonly listeners = new Set<Listener>();

	get current(): ConnectionState {
		return this.state;
	}

	set(state: ConnectionState): void {
		this.state = state;
		// Copy first: a listener may unsubscribe itself while being notified.
		for (const listener of [...this.listeners]) {
			listener(state);
		}
	}

	/** Subscribes, and returns the function that unsubscribes again. */
	onChange(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
}

/**
 * Whether this state grants access to the configured project's documents.
 * Both surfaces ask through here, so neither reimplements the threshold.
 *
 * A null access level is grouped with Guest rather than treated as an error:
 * it means the project was reachable but carries no role for this account.
 * See `docs/gitlab-roles.md` §2.
 */
function grantsDocumentAccess(state: ConnectionState): boolean {
	return (
		state.kind === 'verified' &&
		state.access.accessLevel !== null &&
		state.access.accessLevel >= DOCUMENT_ACCESS_LEVEL
	);
}

export { ConnectionStateHolder, grantsDocumentAccess };
