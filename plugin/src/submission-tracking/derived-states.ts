import type { GitFailureKind } from '../git-publishing/failures';
import type { ProjectAddress } from '../git-publishing/project-address';
import { fetchProject } from '../git-publishing/repo';
import type { RepoContext } from '../git-publishing/repo';
import { deriveStates } from './derive-state';
import type { DerivedDocument, DerivedStates } from './derive-state';

/**
 * What the last refresh did. `never` is not `failed`: a first refresh that
 * fails has nothing to fall back on, and the author must not be shown a
 * document carrying a state that was never established.
 */
export type RefreshOutcome =
	| { kind: 'never' }
	| { kind: 'refreshing' }
	| { kind: 'succeeded' }
	| { kind: 'failed'; failure: GitFailureKind };

type Listener = () => void;

/**
 * Holds the states last derived, for the running session
 * (replace-rest-with-local-git-ssh task 2.6).
 *
 * The panel draws from this and never from git: it redraws on every note switch
 * and every front-matter change, so reading from here is what keeps a keystroke
 * from being a process. A refresh that fails leaves the states as they were, so
 * the author keeps what was last known, told plainly it may have moved on,
 * instead of watching the list empty itself.
 *
 * Nothing here is written to disk. The fetched copy in `.git` is the
 * persistence; a restart derives again from it.
 */
export class DerivedStatesHolder {
	private states: DerivedStates | null = null;
	private outcome: RefreshOutcome = { kind: 'never' };
	private readonly listeners = new Set<Listener>();

	get current(): DerivedStates | null {
		return this.states;
	}

	get lastOutcome(): RefreshOutcome {
		return this.outcome;
	}

	/** Null when nothing has derived this document — never a guess. */
	statusFor(docId: string): DerivedDocument | null {
		return this.states?.documents.get(docId) ?? null;
	}

	/** How many files the project has changed since the vault last synced; null when not derived. */
	get updatesAvailable(): number | null {
		return this.states === null ? null : this.states.updatesAvailable;
	}

	beginRefresh(): void {
		this.outcome = { kind: 'refreshing' };
		this.notify();
	}

	/** Replaces everything wholesale: the fetched copy decided all of it. */
	recordSuccess(states: DerivedStates | null): void {
		this.states = states;
		this.outcome = { kind: 'succeeded' };
		this.notify();
	}

	/**
	 * States read from the fetched copy already on disk, before anything has
	 * been fetched this session. They stand in for "nothing is known" and say
	 * nothing about how a refresh went, so the outcome is left alone.
	 */
	recordLocal(states: DerivedStates | null): void {
		this.states = states;
		this.notify();
	}

	recordFailure(failure: GitFailureKind): void {
		this.outcome = { kind: 'failed', failure };
		this.notify();
	}

	/**
	 * One document, replaced: for the caller that has just made it true, a send
	 * that opened or advanced a review. The refresh that follows replaces it with
	 * everything else.
	 */
	recordDocument(document: DerivedDocument): void {
		if (this.states === null) {
			return;
		}
		const documents = new Map(this.states.documents);
		documents.set(document.docId, document);
		this.states = { ...this.states, documents };
		this.notify();
	}

	/** Back to never-checked: the project the states describe is no longer the one the vault is on. */
	clear(): void {
		this.states = null;
		this.outcome = { kind: 'never' };
		this.notify();
	}

	/** Subscribes, and returns the function that unsubscribes again. */
	onChange(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	private notify(): void {
		// Copy first: a listener may unsubscribe itself while being notified.
		for (const listener of [...this.listeners]) {
			listener();
		}
	}
}

export interface RefreshDeps {
	holder: DerivedStatesHolder;
	/** Reads and writes the vault's repository locally; carries no key. */
	local: () => RepoContext;
	/**
	 * The context that can reach the project, with the chosen key, and the
	 * project's address; null while no key has been chosen.
	 */
	network: () => Promise<{ ctx: RepoContext; address: ProjectAddress } | null> | { ctx: RepoContext; address: ProjectAddress } | null;
	/** The `doc_id` of every note in the vault that carries one. */
	docIds: () => string[];
	/** Told of a failure that is about setup (the key, the address), so the checklist can reopen at that step. */
	onSetupFailure: (failure: GitFailureKind) => void | Promise<void>;
}

/** Failures that mean something the author set up is wrong, not that the moment is bad. */
const SETUP_FAILURES: ReadonlyArray<GitFailureKind> = [
	'git-missing',
	'ssh-missing',
	'key-rejected',
	'key-protected',
	'key-unreadable',
	'host-changed',
	'project-not-found',
	'address-rewritten',
];

/**
 * Derives states from the fetched copy that is already on disk, without
 * touching the network. For the moment the panel opens, so it has something to
 * show while the fetch runs.
 */
export async function deriveFromFetchedCopy(deps: RefreshDeps): Promise<void> {
	const derived = await deriveStates(deps.local(), deps.docIds());
	if (derived.ok) {
		deps.holder.recordLocal(derived.value);
	}
}

/**
 * The one path that refreshes states: one fetch, then every document derived
 * from the fetched copy. The panel opening and the Refresh control both come
 * through here, and nothing else does — no timer, no note event, no render.
 *
 * A fetch that fails, or a derivation that fails part-way, leaves the held
 * states as they were and records the failure.
 */
export async function refreshStates(deps: RefreshDeps): Promise<void> {
	const { holder } = deps;
	// An in-flight refresh is left to finish rather than raced.
	if (holder.lastOutcome.kind === 'refreshing') {
		return;
	}
	holder.beginRefresh();

	const network = await deps.network();
	if (network === null) {
		holder.recordFailure('unexpected');
		return;
	}
	const fetched = await fetchProject(network.ctx, network.address);
	if (!fetched.ok) {
		holder.recordFailure(fetched.failure);
		if (SETUP_FAILURES.indexOf(fetched.failure) !== -1) {
			await deps.onSetupFailure(fetched.failure);
		}
		return;
	}

	const derived = await deriveStates(deps.local(), deps.docIds());
	if (!derived.ok) {
		holder.recordFailure(derived.failure);
		return;
	}
	holder.recordSuccess(derived.value);
}
