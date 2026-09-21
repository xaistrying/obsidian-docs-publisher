import type { App } from 'obsidian';
import type { ConnectionDetails, FailureKind } from '../git-publishing/gitlab-client';
import { getDefaultBranch, getFileContent, listRepositoryFiles } from '../git-publishing/gitlab-client';
import { deriveDocIdFromPath } from '../doc-authoring/doc-id';
import { hasFrontMatter } from '../doc-authoring/front-matter';
import { listVaultDocuments } from './document-status';
import type { SubmissionStore } from './submission-store';
import type { ConnectionState } from '../platform-config/connection-state';
import { grantsAuthoring } from '../platform-config/connection-state';

/**
 * `reconcile.ts` resolves STATE for documents the vault has notes for.
 * `recover.ts` resolves CONTENT for stored records it does not. This
 * resolves the third direction — documents the remote holds that this vault
 * has no trace of AT ALL: no note, no record, no `doc_id` to key off.
 *
 * One file per direction of "what does the remote know", the convention
 * `recover.ts`'s own docstring states and `reset.ts` followed.
 */

/**
 * One remote document this vault has no note for, carrying the content it
 * was resolved from.
 *
 * The content is held rather than re-read at import, and that is the
 * resolution's own cost being paid once instead of twice: the exclusion rule
 * below has to read every candidate to decide whether it is a document at
 * all, so import would otherwise ask for bytes this already has in hand —
 * the same reasoning `checkTargetPathFree` uses when it hands its refusal
 * the content it just read.
 *
 * TRADE-OFF: the content is as fresh as the last resolution, so a document
 * edited on the remote between a refresh and an import arrives one revision
 * behind. Re-importing is safe (the occupied-path refusal, not an
 * overwrite), and a stale import is visible to the author in a way a doubled
 * request bill is not.
 */
export interface DiscoverableDocument {
	path: string;
	content: string;
}

/**
 * What the remote holds that this vault does not, and whether that is the
 * whole story.
 *
 * `incomplete` carries the tree read's `truncated` through unchanged. A
 * document missing from a truncated listing is indistinguishable from one
 * the project does not have, so this is never dropped on the way to the
 * surface that renders it (design.md decision 7).
 *
 * `ref` is the ref every document here was read from, kept so the attachment
 * fetch that follows an import pulls from the same point in history the note
 * came from rather than resolving the default branch a second time.
 */
export interface DiscoveryResolution {
	documents: DiscoverableDocument[];
	incomplete: boolean;
	ref: string;
	/**
	 * Every file the listing reported, documents and attachments alike.
	 *
	 * Kept because the attachment fetch that follows an import resolves a
	 * note's embeds against it (`fetch-attachments.ts`), and reading the tree
	 * again per document would make "import all" pay for the same listing
	 * once per document.
	 */
	paths: string[];
}

export type DiscoveryResult =
	| { ok: true; value: DiscoveryResolution }
	| { ok: false; failure: FailureKind; detail?: string };

/**
 * Which listed remote paths are candidates for import: the markdown ones the
 * vault holds no file at.
 *
 * PURE, and compared BY PATH — the one thing guaranteed comparable under
 * vault-root-is-repo-root (`docs/document-identity.md` §4) — and
 * case-sensitively, for the reason §4 already gives: `Known-errors/` and
 * `known-errors/` are different locations that orphan each other, and no
 * file explorer on Windows or macOS shows the author as different.
 *
 * `vaultPaths` comes from the VAULT's own files, never from stored records.
 * A record is not evidence that a file exists, and the question being asked
 * here is precisely which files do not — the same choice `listVaultDocuments`
 * made, for the same reason.
 *
 * A document the vault holds under a DIFFERENT path therefore appears here.
 * That is correct and deliberate: hiding it would need a `doc_id` comparison
 * this has no content to make, and importing it is refused by the
 * duplicate-`doc_id` check with the colliding note named — a refusal the
 * author can act on, rather than a document silently missing from the list.
 *
 * Anything under a DOT-FOLDER is excluded outright, and that is not tidiness
 * — it is the one case where "the vault does not have this path" does not
 * mean what it says. Obsidian's index contains no dot-folder, so
 * `getMarkdownFiles` can never report a file under one, so such a path can
 * never match a vault path and would be offered as importable on every
 * refresh forever. And importing it could not work regardless: `vault.create`
 * writes into the vault, and a hidden folder is not in it.
 *
 * OBSERVED 2026-09-14, and this is why the rule exists rather than a
 * precaution: the target project's default branch carries `.obsidian/` and
 * `.claudian/`, because the vault is committed whole (see
 * `docs/ce-verification.md` §E4). A plugin's own folder holds no markdown
 * today, which is exactly why this would have gone unnoticed until something
 * dropped a note with front matter into one.
 */
export function discoveryCandidates(
	remotePaths: readonly string[],
	vaultPaths: ReadonlySet<string>,
	/**
	 * `doc_id`s this vault holds a RECORD for but no note — the recovery
	 * list's own membership. A document here is not unknown to this vault: it
	 * was submitted from it, and its note has since gone. That is recovery's
	 * question, answered by recovery's own resolution, and offering it here
	 * as well put one document in two lists with two different answers
	 * (`docs/panel-tracking-scope.md`, 2026-09-20).
	 *
	 * Deliberately the ORPHANED set and not every stored `doc_id`: a record
	 * whose note IS in the vault, moved to another folder, must still leave
	 * the remote document discoverable — that is the submission-tracking
	 * spec's "a document the vault holds at a different path" scenario, and
	 * the import-time duplicate check is what handles it.
	 */
	orphanedDocIds: ReadonlySet<string> = new Set()
): string[] {
	return remotePaths.filter(
		(path) =>
			isMarkdown(path) &&
			!isHidden(path) &&
			!vaultPaths.has(path) &&
			!isOrphaned(path, orphanedDocIds)
	);
}

function isOrphaned(path: string, orphanedDocIds: ReadonlySet<string>): boolean {
	const docId = deriveDocIdFromPath(path);
	return docId !== null && orphanedDocIds.has(docId);
}

/**
 * Whether a candidate's content makes it a document. PURE, and the whole of
 * it is `hasFrontMatter` — see that function for why the rule is neither a
 * filename denylist nor the full front-matter contract.
 */
export function isDiscoverableDocument(content: string): boolean {
	return hasFrontMatter(content);
}

/**
 * Everything the remote's default branch holds that this vault has no note
 * for, with each document's content.
 *
 * Reads the tree once, then one content read per CANDIDATE — never per
 * remote file: a vault that already holds the corpus costs the tree read
 * alone. The exclusion rule is what forces those reads, since "does this
 * file carry front matter" is a question about content and nothing in a tree
 * listing answers it.
 *
 * A failed content read aborts the whole resolution rather than quietly
 * dropping that one candidate — `resolveOrphanedRecords`'s rule, for its
 * reason: a failure is not an answer, and silently omitting a document would
 * tell the author the corpus does not have something it does. A candidate
 * that answers ABSENT is a different thing and is skipped: the file was
 * deleted between the tree read and this one, so it genuinely is not there.
 */
export async function resolveDiscoverableDocuments(
	details: ConnectionDetails,
	vaultPaths: ReadonlySet<string>,
	orphanedDocIds: ReadonlySet<string> = new Set()
): Promise<DiscoveryResult> {
	const ref = await getDefaultBranch(details);
	if (!ref.ok) {
		return failed(ref);
	}

	const listing = await listRepositoryFiles(details, ref.value);
	if (!listing.ok) {
		return failed(listing);
	}

	const documents: DiscoverableDocument[] = [];
	for (const path of discoveryCandidates(listing.value.paths, vaultPaths, orphanedDocIds)) {
		const content = await getFileContent(details, { path, ref: ref.value });
		if (!content.ok) {
			return failed(content);
		}

		if (!content.value.exists || !isDiscoverableDocument(content.value.content)) {
			continue;
		}

		documents.push({ path, content: content.value.content });
	}

	return {
		ok: true,
		value: {
			documents,
			incomplete: listing.value.truncated,
			ref: ref.value,
			paths: listing.value.paths,
		},
	};
}

function failed(result: { failure: FailureKind; detail?: string }): DiscoveryResult {
	return result.detail === undefined
		? { ok: false, failure: result.failure }
		: { ok: false, failure: result.failure, detail: result.detail };
}

function isMarkdown(path: string): boolean {
	return /\.md$/i.test(path);
}

/**
 * Whether any segment of the path starts with a dot — Obsidian's own rule for
 * what is not part of a vault, which covers `.obsidian`, `.trash`, `.git` and
 * anything else a repository keeps beside the documents.
 */
function isHidden(path: string): boolean {
	return path.split('/').some((segment) => segment.startsWith('.'));
}

/** What happened the last time discoverable documents were resolved. */
export type DiscoveryRefreshOutcome =
	| { kind: 'never' }
	| { kind: 'refreshing' }
	| { kind: 'succeeded' }
	| { kind: 'failed'; failure: FailureKind; detail?: string };

type Listener = () => void;

/**
 * Holds the last-resolved discoverable set for the running session, filled
 * by the same two triggers as `DocumentStatusHolder` and `RecoveryHolder` —
 * the panel opening and its Refresh control — and read by render alone, so
 * no keystroke touching front matter ever reaches the network. A failed
 * refresh leaves the previous set alone, for the same reason those two do.
 */
class DiscoveryHolder {
	private documents: DiscoverableDocument[] = [];
	private outcome: DiscoveryRefreshOutcome = { kind: 'never' };
	private incompleteListing = false;
	private sourceRef: string | null = null;
	private remotePaths: string[] = [];
	private refusals = new Map<string, string>();
	private readonly listeners = new Set<Listener>();

	get lastOutcome(): DiscoveryRefreshOutcome {
		return this.outcome;
	}

	get current(): readonly DiscoverableDocument[] {
		return this.documents;
	}

	/** Whether what `current` holds was built from a truncated listing. */
	get incomplete(): boolean {
		return this.incompleteListing;
	}

	/** The ref `current`'s content was read from, or null before any success. */
	get ref(): string | null {
		return this.sourceRef;
	}

	/** Every file the last listing reported — what an import's embeds resolve against. */
	get paths(): readonly string[] {
		return this.remotePaths;
	}

	/**
	 * Why the last import attempt refused this document, or null.
	 *
	 * Held per row rather than announced in one notice, because a batch over a
	 * real corpus refuses several at once for several different reasons — and
	 * a notice carrying eight of them is a wall of text covering the panel it
	 * is talking about. Observed on the first real "import all"
	 * (`docs/ce-verification.md` §E6). The reason belongs beside the document
	 * it is about, where it stays readable and stays put.
	 */
	refusalFor(path: string): string | null {
		return this.refusals.get(path) ?? null;
	}

	/** Records a whole attempt's refusals at once, so a batch costs one render. */
	recordRefusals(refusals: ReadonlyMap<string, string>): void {
		this.refusals = new Map(refusals);
		this.notify();
	}

	beginRefresh(): void {
		this.outcome = { kind: 'refreshing' };
		this.notify();
	}

	recordSuccess(resolution: DiscoveryResolution): void {
		this.documents = [...resolution.documents];
		this.incompleteListing = resolution.incomplete;
		this.sourceRef = resolution.ref;
		this.remotePaths = [...resolution.paths];
		// A fresh resolution answers the question those refusals were about,
		// so carrying them across one would show the author a reason for a
		// document the remote may have renamed since.
		this.refusals = new Map();
		this.outcome = { kind: 'succeeded' };
		this.notify();
	}

	recordFailure(failure: FailureKind, detail?: string): void {
		this.outcome = detail === undefined ? { kind: 'failed', failure } : { kind: 'failed', failure, detail };
		this.notify();
	}

	/**
	 * Throws the resolved set away and returns to never-checked, when the
	 * connection details change. See `DocumentStatusHolder.clear`.
	 *
	 * The held CONTENT is what makes this matter here: each entry carries the
	 * bytes its import would write, read from the project that was configured
	 * at the time. Importing from a stale entry would write another project's
	 * document into the vault under this project's name.
	 */
	clear(): void {
		this.documents = [];
		this.remotePaths = [];
		this.refusals = new Map();
		this.sourceRef = null;
		this.incompleteListing = false;
		this.outcome = { kind: 'never' };
		this.notify();
	}

	/**
	 * Drops one row immediately after it is imported, so it leaves the list
	 * without waiting for the next full refresh — the note now exists
	 * locally, so it belongs in "Your documents" instead. Mirrors
	 * `RecoveryHolder.remove`.
	 */
	remove(path: string): void {
		this.documents = this.documents.filter((entry) => entry.path !== path);
		this.refusals.delete(path);
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
 * The one path that refreshes the discoverable set, mirroring
 * `refreshDocumentStatuses` and `refreshRecoverableDocuments`: the panel
 * opening and its Refresh control both come through here, so neither can
 * behave differently from the other.
 *
 * Gated on AUTHORING rather than on document access, unlike the other two.
 * This resolution costs a content read per candidate, and the only thing the
 * list it produces can be used for is Import, which authoring gates — so
 * spending those requests for an account that will never be offered the
 * action is waste with nothing on the other side of it. The gate is the same
 * optimistic role check every surface asks and proves nothing about whether
 * a later call will succeed (`docs/gitlab-roles.md` §1).
 */
export async function refreshDiscoverableDocuments(
	app: App,
	details: ConnectionDetails,
	connection: ConnectionState,
	store: SubmissionStore,
	holder: DiscoveryHolder
): Promise<void> {
	if (!grantsAuthoring(connection)) {
		return;
	}

	if (holder.lastOutcome.kind === 'refreshing') {
		return;
	}

	// Every markdown file, not only the ones carrying a `doc_id`: the question
	// is whether a path is occupied, and an untracked note occupies its path
	// exactly as a tracked one does.
	const vaultPaths = new Set(app.vault.getMarkdownFiles().map((file) => file.path));

	// The recovery list's membership, computed from the same two inputs
	// `resolveOrphanedRecords` computes it from rather than from its RESULT.
	// That keeps the two resolutions independent — neither waits on the other,
	// and the one-file-per-direction split stands — while still agreeing on
	// which documents belong to which list.
	const vaultDocIds = new Set(listVaultDocuments(app).map((entry) => entry.docId));
	const orphanedDocIds = new Set(
		store
			.allRecords()
			.map((record) => record.docId)
			.filter((docId) => !vaultDocIds.has(docId))
	);

	holder.beginRefresh();
	const result = await resolveDiscoverableDocuments(details, vaultPaths, orphanedDocIds);
	if (!result.ok) {
		holder.recordFailure(result.failure, result.detail);
		return;
	}

	holder.recordSuccess(result.value);
}

export { DiscoveryHolder };
