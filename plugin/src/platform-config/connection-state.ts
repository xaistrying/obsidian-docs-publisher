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

/**
 * The lowest access level that can add to the project's documents. Developer
 * is the floor: submitting is create-branch + commit + create-merge-request,
 * which needs push to a non-protected branch, and Planner and Reporter have
 * none of it. See `docs/gitlab-roles.md` §3.
 *
 * Kept beside the level above so the two bands are read from one place and no
 * surface writes its own comparison.
 */
export const AUTHOR_ACCESS_LEVEL = 30;

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
	return grants(state, DOCUMENT_ACCESS_LEVEL);
}

/**
 * Whether this state grants adding to the configured project's documents.
 *
 * Optimistic, and never proof: it answers the account's role, which is only
 * the first of three independent gates. A Developer whose token was granted
 * read-only scopes passes here and still fails at submit, and gate 2 has no
 * API to introspect. See `docs/gitlab-roles.md` §1. This removes the common
 * refusal early; nothing may read it as evidence a later call will succeed.
 */
function grantsAuthoring(state: ConnectionState): boolean {
	return grants(state, AUTHOR_ACCESS_LEVEL);
}

/**
 * The middle band: can read the project's documents, cannot add to them.
 *
 * Derived from the pair rather than declared with a range of its own, so the
 * two thresholds cannot drift into an ordering that leaves this band
 * unreachable or overlapping the one above it.
 */
function grantsReadOnly(state: ConnectionState): boolean {
	return grantsDocumentAccess(state) && !grantsAuthoring(state);
}

function grants(state: ConnectionState, threshold: number): boolean {
	return (
		state.kind === 'verified' &&
		state.access.accessLevel !== null &&
		state.access.accessLevel >= threshold
	);
}

export { ConnectionStateHolder, grantsAuthoring, grantsDocumentAccess, grantsReadOnly };
