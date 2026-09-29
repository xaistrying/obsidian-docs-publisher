import type { App, TFile } from 'obsidian';
import type { EditBaseline, ProjectRef, SubmissionRecord, SubmissionState } from './submission-record';
import { belongsToProject, configuredProject } from './submission-record';
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
	const project = configuredProject(details, connection);
	if (!grantsDocumentAccess(connection) || project === null) {
		return;
	}

	// An in-flight refresh is left to finish rather than raced. Opening the
	// panel and pressing Refresh in the same breath is one refresh.
	if (holder.lastOutcome.kind === 'refreshing') {
		return;
	}

	// The vault's `doc_id`s AND every stored record's. A record whose note was
	// deleted is the one nothing else in the vault describes, and leaving it out
	// froze its state at whatever the last submit wrote — a merged document then
	// sat on the restore list forever and was hidden from import
	// (`docs/ce-verification.md` §D0f). Same single listing either way.
	const docIds = [
		...new Set([
			...listVaultDocuments(app).map((entry) => entry.docId),
			...store.allRecords().map((record) => record.docId),
		]),
	];
	if (docIds.length === 0) {
		// No note carries a `doc_id` and no record exists, so there is nothing
		// to ask about. That costs no request.
		holder.recordSuccess([]);
		return;
	}

	holder.beginRefresh();
	const result = await reconcileDocuments(details, store, docIds, project);

	if (!result.ok) {
		holder.recordFailure(result.failure, result.detail);
		return;
	}

	holder.recordSuccess(result.documents);
}

export { DocumentStatusHolder };

/**
 * The edit baseline for the note at `path`, as it stands on disk NOW. Call
 * it after the plugin's own write has completed; it is the only producer of
 * an `EditBaseline`.
 *
 * Read from the adapter — the filesystem — and deliberately not from
 * `TFile.stat`. That is Obsidian's cached stat, and immediately after a write
 * it can still hold the pre-write mtime, which recorded every submitted
 * document as edited the moment it was sent (fix-edited-baseline).
 *
 * Undefined when the read fails or nothing is at the path: no baseline is
 * read as not edited, which is safer than guessing one.
 */
export async function captureEditBaseline(app: App, path: string): Promise<EditBaseline | undefined> {
	try {
		const stat = await app.vault.adapter.stat(path);
		return stat === null ? undefined : (stat.mtime as EditBaseline);
	} catch {
		return undefined;
	}
}

/**
 * The state a document is shown in: the remote's answer when it has one, and
 * otherwise the stored record's — but ONLY a record belonging to `project`.
 *
 * The fallback exists for an imported document, which has no merge request and
 * so nothing for the remote to report. "No merge request here" is the same
 * observation for a record written against another project, and falling back
 * for that one resurrected its old state after every refresh
 * (`docs/ce-verification.md` §D0h). Undefined is no state: the row shows no
 * label and the panel offers only a first submission.
 *
 * The one rule the row, the partition and the submit action all read, so the
 * label and the action cannot come from two answers again.
 */
export function effectiveState(
	status: ResolvedDocument | null,
	record: SubmissionRecord | undefined,
	project: ProjectRef | null
): SubmissionState | undefined {
	return status?.submission?.state ?? (belongsToProject(record, project) ? record.state : undefined);
}

/**
 * Whether to mark a document as belonging to another project: its record names
 * one, that is not the configured project, and a refresh has found nothing for
 * it here. A live answer wins as everywhere else, and before a refresh there is
 * nothing to say.
 *
 * An UNSTAMPED record is never marked. Nothing established where it belongs,
 * and "another project" would assert exactly that.
 */
export function inAnotherProject(
	status: ResolvedDocument | null,
	record: SubmissionRecord | undefined,
	project: ProjectRef | null
): boolean {
	return (
		status !== null &&
		status.submission === null &&
		record?.project !== undefined &&
		project !== null &&
		!belongsToProject(record, project)
	);
}

/**
 * Whether the note has been changed since the plugin last wrote it — a
 * submit, an import or a reset, each of which records a baseline.
 *
 * FALSE when no baseline exists, which is the load-bearing half. A record
 * written before `mtime` was captured has nothing to compare against, and
 * answering "edited" for those would light up every document the author has
 * ever published the moment this shipped. They earn a baseline on their next
 * submit and behave normally from then on.
 */
export function hasLocalEdits(file: TFile, record: SubmissionRecord | undefined): boolean {
	return record?.mtime !== undefined && file.stat.mtime > record.mtime;
}

/**
 * Whether this document is waiting on the AUTHOR rather than on a reviewer.
 *
 * The rule the panel's main list is built from, in one place so the list and
 * its labels cannot disagree about what belongs in it:
 *
 * - never submitted — nothing is in the knowledge base yet
 * - changes requested — a reviewer asked for something, which is the
 *   definition of needing the author, edited or not
 * - not accepted — needs a decision, resubmit or abandon, and no other
 *   surface would raise it
 * - pending or published AND edited since the last submit — there is work
 *   here that the remote has not seen
 *
 * Everything else is waiting on somebody else or on nothing: a pending
 * document nobody has commented on, and a published document the author has
 * not touched. Those are reference, not work.
 */
export function needsAuthor(
	state: SubmissionState | null,
	edited: boolean
): boolean {
	if (state === null || state === 'changes-requested' || state === 'closed') {
		return true;
	}

	return edited;
}

/** The panel section a listed document belongs in, named for who acts next. */
export type PanelSection = 'needs-you' | 'waiting-on-reviewers';

/**
 * Which section a document is listed in, or null for not listed at all.
 *
 * Built FROM `needsAuthor`, not beside it, so "Needs you" holds exactly what
 * that rule says and nothing else can drift from it. Of what is left, only a
 * pending document has a next actor — a reviewer. A published, untouched one
 * has none and stays off the panel (2026-09-22).
 *
 * An unresolved state goes to "Needs you" by way of `needsAuthor`: putting it
 * under "Waiting on reviewers" would assert a review nothing established.
 */
export function panelSection(state: SubmissionState | null, edited: boolean): PanelSection | null {
	if (needsAuthor(state, edited)) {
		return 'needs-you';
	}

	return state === 'pending' ? 'waiting-on-reviewers' : null;
}
