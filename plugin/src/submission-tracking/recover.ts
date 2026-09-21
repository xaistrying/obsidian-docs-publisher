import type { App } from 'obsidian';
import type { ClientResult, ConnectionDetails, FailureKind } from '../git-publishing/gitlab-client';
import {
	findOpenMergeRequest,
	getDefaultBranch,
	getFileContent,
	getMergeRequestChangedPath,
	listRepositoryFiles,
} from '../git-publishing/gitlab-client';
import { deriveDocIdFromPath } from '../doc-authoring/doc-id';
import type { ConnectionState } from '../platform-config/connection-state';
import { grantsDocumentAccess } from '../platform-config/connection-state';
import { listVaultDocuments } from './document-status';
import type { SubmissionRecord } from './submission-record';
import type { SubmissionStore } from './submission-store';

/**
 * `reconcile.ts` resolves STATE for `doc_id`s the vault already has notes
 * for. This resolves CONTENT for `doc_id`s it does NOT — a stored record
 * with no matching note. Different question, different remote calls,
 * different failure modes, kept in its own file for the same reason
 * `reconcile.ts`'s own docstring gives: one file per direction of "what does
 * the remote know" (add-document-recovery design.md decision 6).
 */

/**
 * One stored record whose `doc_id` matches no note currently in the vault,
 * resolved to whether its content can actually be located on the remote and,
 * when it can, the exact path to read it from. Never a guess — a record
 * that resolves to neither source is reported unrecoverable rather than
 * offered a constructed path (design.md decisions 1 and 2).
 */
export type OrphanedDocument =
	| { recoverable: true; docId: string; record: SubmissionRecord; path: string }
	| { recoverable: false; docId: string; record: SubmissionRecord };

export type OrphanResolutionResult =
	| { ok: true; documents: OrphanedDocument[] }
	| { ok: false; failure: FailureKind; detail?: string };

/**
 * Resolves every stored record with no matching vault note to whether it can
 * be recovered, and from where. Makes no content request of its own — see
 * `fetchRecoveryContent`, called only once the author asks to recover one
 * specific document (design.md decision 7).
 *
 * A failed lookup for any one record aborts the whole resolution rather than
 * quietly marking that record unrecoverable — the same reasoning
 * `reconcileDocuments` follows: a failure is not an answer, and reporting one
 * as "cannot be recovered" would tell the author something false.
 */
export async function resolveOrphanedRecords(
	details: ConnectionDetails,
	store: SubmissionStore,
	vaultDocIds: ReadonlySet<string>
): Promise<OrphanResolutionResult> {
	const documents: OrphanedDocument[] = [];
	const lookup = defaultBranchLookup(details);

	for (const record of store.allRecords()) {
		if (vaultDocIds.has(record.docId)) {
			continue;
		}

		const resolved = await resolveOne(details, record, lookup);
		if (!resolved.ok) {
			return resolved.detail === undefined
				? { ok: false, failure: resolved.failure }
				: { ok: false, failure: resolved.failure, detail: resolved.detail };
		}

		documents.push(resolved.value);
	}

	return { ok: true, documents };
}

type ResolveOneResult =
	| { ok: true; value: OrphanedDocument }
	| { ok: false; failure: FailureKind; detail?: string };

/**
 * A record's own stored path wins outright — the fast path added by
 * add-document-recovery, needing no remote call at all. Only a record with
 * no stored path (every record persisted before that change shipped) falls
 * to the merge-request fallback: its still-open merge request's own commit,
 * when it changed exactly one file. Anything else — no open merge request,
 * or one that changed more than one file — resolves as unrecoverable rather
 * than a guess (design.md decision 1).
 */
async function resolveOne(
	details: ConnectionDetails,
	record: SubmissionRecord,
	lookup: DefaultBranchLookup
): Promise<ResolveOneResult> {
	if (record.path !== undefined) {
		return { ok: true, value: { recoverable: true, docId: record.docId, record, path: record.path } };
	}

	const open = await findOpenMergeRequest(details, record.branch);
	if (!open.ok) {
		return open;
	}

	if (open.value !== null) {
		const changedPath = await getMergeRequestChangedPath(details, open.value.iid);
		if (!changedPath.ok) {
			return changedPath;
		}

		if (changedPath.value !== null) {
			return {
				ok: true,
				value: { recoverable: true, docId: record.docId, record, path: changedPath.value },
			};
		}
	}

	return onDefaultBranch(record, lookup);
}

/**
 * THE THIRD FALLBACK, added 2026-09-20: the document's own file, found on the
 * default branch by matching this record's `doc_id` against what the
 * repository actually holds.
 *
 * Added because the two fallbacks above are weaker than the question deserves.
 * Both need a MERGE REQUEST to read a path from, so a document whose review
 * was merged or closed — the ordinary end state of a published document —
 * resolved as "content can no longer be found automatically" while its file
 * sat on the default branch the whole time. Discover, arriving later, listed
 * that same file and offered to Import it: two lists, one document, opposite
 * answers, observed together for the first time on 2026-09-20 (see
 * `docs/panel-tracking-scope.md`). This is the stronger answer, so it is the
 * one that wins, and the two lists stop disagreeing.
 *
 * Matched by DERIVED `doc_id`, through the same derivation import uses, and
 * never by a constructed path. `docs/document-identity.md` §4 forbids
 * guessing where a document lives, and this does not guess: it reads what is
 * there and asks which file, if any, IS this document.
 *
 * EXACTLY ONE match is an answer. Several means two remote files derive one
 * `doc_id` — the `README.md` case `docs/document-naming.md` documents — and
 * the record could belong to either, so this declines rather than picking.
 * Unrecoverable is still the honest answer there, and now it is the honest
 * answer for a much smaller set of records.
 */
async function onDefaultBranch(
	record: SubmissionRecord,
	lookup: DefaultBranchLookup
): Promise<ResolveOneResult> {
	const paths = await lookup();
	if (!paths.ok) {
		return paths;
	}

	const matches = paths.value.filter((path) => deriveDocIdFromPath(path) === record.docId);
	return {
		ok: true,
		value:
			matches.length === 1
				? { recoverable: true, docId: record.docId, record, path: matches[0] }
				: { recoverable: false, docId: record.docId, record },
	};
}

type DefaultBranchLookup = () => Promise<ClientResult<readonly string[]>>;

/**
 * The default branch's file listing, read AT MOST ONCE per resolution and
 * only if some record actually needs it.
 *
 * Lazy because the fast path must stay free: a store whose every record
 * carries its own path — which is every record written since
 * add-document-recovery — resolves with no remote call at all, and making
 * this eager would spend a listing on every refresh to answer nothing.
 * Memoized because a store with twenty such records must not read the same
 * listing twenty times.
 */
function defaultBranchLookup(details: ConnectionDetails): DefaultBranchLookup {
	let cached: ClientResult<readonly string[]> | null = null;

	return async () => {
		if (cached !== null) {
			return cached;
		}

		const ref = await getDefaultBranch(details);
		if (!ref.ok) {
			cached = ref;
			return cached;
		}

		const listing = await listRepositoryFiles(details, ref.value);
		// A TRUNCATED listing is not usable here and is deliberately not
		// softened: "no file derives this `doc_id`" read off a partial listing
		// would report a document unrecoverable that is merely unlisted, which
		// is the exact wrongness `truncated` exists to prevent.
		cached = listing.ok
			? listing.value.truncated
				? { ok: false, failure: 'unexpected' }
				: { ok: true, value: listing.value.paths }
			: listing;
		return cached;
	};
}

/**
 * `ref` names WHICH ref the content was actually found on — the record's own
 * branch or the default one. Carried because the attachment fetch that
 * follows a recovery must pull a document's images from the same point in
 * history as its text, and the two refs hold different content by
 * construction for a document still under review.
 */
export type RecoveryContentResult =
	| { kind: 'found'; content: string; ref: string }
	| { kind: 'absent' }
	| { kind: 'failed'; failure: FailureKind; detail?: string };

/**
 * Reads a recoverable document's actual content. Called only when the
 * author asks to recover that one record — never as part of resolving which
 * records are recoverable (design.md decision 7; tasks.md 2.4).
 *
 * Tries the record's own branch first: the ref every recoverable record is
 * confirmed live on, whether by the fast path (freshly captured at submit)
 * or the merge-request fallback (confirmed open in `resolveOne`). Falls
 * back to the project's default branch only when that ref answers absent,
 * which is what a document that has since reached Published looks like —
 * its branch auto-deleted, its content merged onto the default one. Never
 * falls back on any other outcome: a failed read must not be read as
 * absence (design.md decision 2), so it is reported as failed and nothing
 * further is tried.
 */
export async function fetchRecoveryContent(
	details: ConnectionDetails,
	document: Extract<OrphanedDocument, { recoverable: true }>
): Promise<RecoveryContentResult> {
	const onBranch = await getFileContent(details, { path: document.path, ref: document.record.branch });
	if (!onBranch.ok) {
		return failed(onBranch);
	}
	if (onBranch.value.exists) {
		return { kind: 'found', content: onBranch.value.content, ref: document.record.branch };
	}

	const defaultBranch = await getDefaultBranch(details);
	if (!defaultBranch.ok) {
		return failed(defaultBranch);
	}

	const onDefault = await getFileContent(details, { path: document.path, ref: defaultBranch.value });
	if (!onDefault.ok) {
		return failed(onDefault);
	}

	return onDefault.value.exists
		? { kind: 'found', content: onDefault.value.content, ref: defaultBranch.value }
		: { kind: 'absent' };
}

function failed(result: { failure: FailureKind; detail?: string }): RecoveryContentResult {
	return result.detail === undefined
		? { kind: 'failed', failure: result.failure }
		: { kind: 'failed', failure: result.failure, detail: result.detail };
}

/** What happened the last time orphaned records were resolved from the remote. */
export type RecoveryRefreshOutcome =
	| { kind: 'never' }
	| { kind: 'refreshing' }
	| { kind: 'succeeded' }
	| { kind: 'failed'; failure: FailureKind; detail?: string };

type Listener = () => void;

/**
 * Holds the last-resolved recoverability of every orphaned record, for the
 * running session. Filled by the same two triggers as `DocumentStatusHolder`
 * in `document-status.ts` — the panel opening and its Refresh control — and
 * read by render alone, so a keystroke touching front matter never reaches
 * the network (tasks.md 4.3). A failed refresh leaves the previous set
 * alone, for the same reason `DocumentStatusHolder` does.
 */
class RecoveryHolder {
	private documents: OrphanedDocument[] = [];
	private outcome: RecoveryRefreshOutcome = { kind: 'never' };
	private readonly listeners = new Set<Listener>();

	get lastOutcome(): RecoveryRefreshOutcome {
		return this.outcome;
	}

	get current(): readonly OrphanedDocument[] {
		return this.documents;
	}

	beginRefresh(): void {
		this.outcome = { kind: 'refreshing' };
		this.notify();
	}

	recordSuccess(documents: readonly OrphanedDocument[]): void {
		this.documents = [...documents];
		this.outcome = { kind: 'succeeded' };
		this.notify();
	}

	recordFailure(failure: FailureKind, detail?: string): void {
		this.outcome = detail === undefined ? { kind: 'failed', failure } : { kind: 'failed', failure, detail };
		this.notify();
	}

	/**
	 * Throws the resolved set away and returns to never-checked, when the
	 * connection details change. See `DocumentStatusHolder.clear` for the
	 * reasoning; it bites hardest here, because every row in this list carries
	 * a RECOVER BUTTON — so a stale list does not merely misinform, it offers
	 * to write a note from a project the author has stopped pointing at.
	 */
	clear(): void {
		this.documents = [];
		this.outcome = { kind: 'never' };
		this.notify();
	}

	/**
	 * Drops one row immediately after it is recovered, so it disappears from
	 * this list without waiting for the next full refresh — the recovered
	 * note now exists locally, so it belongs in "Your documents" instead.
	 */
	remove(docId: string): void {
		this.documents = this.documents.filter((entry) => entry.docId !== docId);
		this.notify();
	}

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
 * The one path that refreshes orphan recoverability from the remote,
 * mirroring `refreshDocumentStatuses`'s role for the main list: the panel
 * opening and its Refresh control both come through here, so neither can
 * behave differently from the other (tasks.md 4.3).
 */
export async function refreshRecoverableDocuments(
	app: App,
	details: ConnectionDetails,
	connection: ConnectionState,
	store: SubmissionStore,
	holder: RecoveryHolder
): Promise<void> {
	if (!grantsDocumentAccess(connection)) {
		return;
	}

	if (holder.lastOutcome.kind === 'refreshing') {
		return;
	}

	const vaultDocIds = new Set(listVaultDocuments(app).map((entry) => entry.docId));

	holder.beginRefresh();
	const result = await resolveOrphanedRecords(details, store, vaultDocIds);
	if (!result.ok) {
		holder.recordFailure(result.failure, result.detail);
		return;
	}

	holder.recordSuccess(result.documents);
}

export { RecoveryHolder };
