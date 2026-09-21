import type { App, TFile } from 'obsidian';
import type { ConnectionDetails, FailureKind } from '../git-publishing/gitlab-client';
import type { ConnectionState } from '../platform-config/connection-state';
import { grantsDocumentAccess } from '../platform-config/connection-state';
import type { ResolvedDocument } from './reconcile';
import { reconcileDocuments } from './reconcile';
import { readDocId } from './resolve';
import type { SubmissionStore } from './submission-store';

/** One note in the vault that carries a `doc_id`, paired with that `doc_id`. */
export interface VaultDocument {
	file: TFile;
	docId: string;
}

/**
 * What happened the last time states were refreshed from the remote.
 *
 * `never` is distinct from `failed` on purpose: a first refresh that fails
 * has nothing to fall back on, and the author must not be shown a document
 * carrying a state that was never established.
 */
export type RefreshOutcome =
	| { kind: 'never' }
	| { kind: 'refreshing' }
	| { kind: 'succeeded' }
	| { kind: 'failed'; failure: FailureKind; detail?: string };

type Listener = () => void;

/**
 * Holds the last states resolved from the remote, for the running session.
 *
 * This is the cache the panel renders from, and keeping it separate from the
 * refresh that fills it is the point: the panel re-renders on `file-open`, on
 * `active-leaf-change` and on every `metadataCache` change, so if rendering
 * read the remote directly then every keystroke touching front matter would
 * be a request. See design.md decision 5.
 *
 * A failed refresh deliberately leaves the states alone. The author keeps
 * what was last known, told plainly that it may have moved on, rather than
 * watching the list empty itself.
 */
class DocumentStatusHolder {
	private statuses = new Map<string, ResolvedDocument>();
	private outcome: RefreshOutcome = { kind: 'never' };
	private readonly listeners = new Set<Listener>();

	get lastOutcome(): RefreshOutcome {
		return this.outcome;
	}

	/** Null when nothing has resolved this `doc_id` yet — never a guess. */
	statusFor(docId: string): ResolvedDocument | null {
		return this.statuses.get(docId) ?? null;
	}

	beginRefresh(): void {
		this.outcome = { kind: 'refreshing' };
		this.notify();
	}

	/** Replaces the resolved set wholesale: the remote decided all of it. */
	recordSuccess(documents: readonly ResolvedDocument[]): void {
		this.statuses = new Map(documents.map((entry) => [entry.docId, entry]));
		this.outcome = { kind: 'succeeded' };
		this.notify();
	}

	recordFailure(failure: FailureKind, detail?: string): void {
		this.outcome = detail === undefined ? { kind: 'failed', failure } : { kind: 'failed', failure, detail };
		this.notify();
	}

	/**
	 * Throws the resolved set away and returns to never-checked.
	 *
	 * For ONE caller and one reason: the connection details changed. A failed
	 * refresh deliberately keeps what was last known, because the author is
	 * better off with a stale answer about the same project than with an empty
	 * list — but that reasoning ends the moment the project itself changes.
	 * What is held then does not describe the project the panel is now
	 * pointing at, and keeping it shows documents from somewhere else with
	 * live actions beside them (observed 2026-09-20 after a project id edit).
	 *
	 * Back to `never` rather than to an empty success, so the panel says "not
	 * checked yet" rather than asserting an emptiness nobody established.
	 */
	clear(): void {
		this.statuses = new Map();
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

/**
 * Every markdown note in the vault whose front matter carries a `doc_id`,
 * sorted by the name the author sees.
 *
 * Built from the VAULT and not from `data.json`. A note with no stored record
 * is precisely the case reconciliation exists to resolve — a second machine,
 * a restored vault, a reinstalled plugin, or a submission whose remote calls
 * succeeded while its local record did not save — and a list built from
 * records would hide exactly those. See design.md decision 6.
 *
 * Notes with no `doc_id` are left out: they have never been submitted, they
 * are the overwhelming majority of a vault, and listing them would bury the
 * documents the panel is for.
 */
export function listVaultDocuments(app: App): VaultDocument[] {
	const documents: VaultDocument[] = [];
	for (const file of app.vault.getMarkdownFiles()) {
		const docId = readDocId(app, file);
		if (docId !== null) {
			documents.push({ file, docId });
		}
	}

	return documents.sort((a, b) => a.file.basename.localeCompare(b.file.basename));
}

/**
 * The ONE path that refreshes states from the remote. Both triggers — the
 * panel opening and the author pressing Refresh — come through here, so
 * neither can behave differently from the other (tasks.md 4.3).
 *
 * Nothing else may call it. It is not wired to any render, any note event or
 * any timer: the author refreshes, and the plugin does not watch.
 */
export async function refreshDocumentStatuses(
	app: App,
	details: ConnectionDetails,
	connection: ConnectionState,
	store: SubmissionStore,
	holder: DocumentStatusHolder
): Promise<void> {
	// The role gate, the same optimistic one every other surface asks — it
	// removes the common refusal early and proves nothing about whether the
	// call will succeed (`docs/gitlab-roles.md` §1). Below it there is nothing
	// to read, so no request is made and no outcome is recorded: an author
	// who cannot see the project's documents is not told a refresh failed.
	if (!grantsDocumentAccess(connection)) {
		return;
	}

	// An in-flight refresh is left to finish rather than raced. Opening the
	// panel and pressing Refresh in the same breath is one refresh.
	if (holder.lastOutcome.kind === 'refreshing') {
		return;
	}

	const documents = listVaultDocuments(app);
	if (documents.length === 0) {
		// Nothing carries a `doc_id`, so there is nothing to ask about. An
		// empty vault costs no request.
		holder.recordSuccess([]);
		return;
	}

	holder.beginRefresh();
	const result = await reconcileDocuments(
		details,
		store,
		documents.map((entry) => entry.docId)
	);

	if (!result.ok) {
		holder.recordFailure(result.failure, result.detail);
		return;
	}

	holder.recordSuccess(result.documents);
}

export { DocumentStatusHolder };
