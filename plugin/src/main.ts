import { Notice, Plugin, ButtonComponent, ItemView, WorkspaceLeaf } from 'obsidian';
import type { TFile } from 'obsidian';
import type { ConnectionDetails, FailureKind } from './git-publishing/gitlab-client';
import { createEmptyConnectionDetails } from './platform-config/connection';
import { createDocument } from './doc-authoring/create-document';
// Aliased: the plugin also has a same-named private method for the two entry
// points to call. Distinct names here keep that call site from reading like
// (and risking becoming) an accidental self-recursion.
import { submitForReview as submitDocumentForReview } from './doc-authoring/submit-document';
import {
	EMPTY_REPOSITORY_MESSAGE,
	NO_DOCUMENT_ACCESS_MESSAGE,
	readOnlyMessage,
} from './platform-config/access-messages';
import type { ConnectionState } from './platform-config/connection-state';
import { ConnectionStateHolder, grantsAuthoring, grantsReadOnly } from './platform-config/connection-state';
import { openSettingsTab } from './platform-config/open-settings';
import { ConnectionSettingTab } from './platform-config/settings-tab';
import type { VaultDocument } from './submission-tracking/document-status';
// Aliased for the same reason as `submitForReview` above: the plugin has a
// same-named private method wrapping this, and two identical names one scope
// apart is how a call turns into an accidental self-recursion.
import {
	DocumentStatusHolder,
	listVaultDocuments,
	refreshDocumentStatuses as refreshRemoteDocumentStatuses,
} from './submission-tracking/document-status';
import { requireAuthoringGate } from './doc-authoring/authoring-gate';
import { RECOVER_LABEL, recoverDocument as recoverDocumentWrite } from './doc-authoring/recover-document';
import {
	RESET_LABEL,
	RESET_READ_FAILED_MESSAGE,
	RESET_UNAVAILABLE_MESSAGE,
	resetDocument as resetDocumentWrite,
} from './doc-authoring/reset-document';
import { attachmentReportMessage } from './doc-authoring/fetch-attachments';
import {
	IMPORT_ALL_LABEL,
	IMPORT_FAILED_MESSAGE,
	IMPORT_LABEL,
	importDocument as importDocumentWrite,
} from './doc-authoring/import-document';
import type { ImportOutcome } from './doc-authoring/import-document';
import type { DiscoverableDocument } from './submission-tracking/discover';
import {
	DiscoveryHolder,
	refreshDiscoverableDocuments as refreshRemoteDiscoverableDocuments,
} from './submission-tracking/discover';
import type { OrphanedDocument } from './submission-tracking/recover';
import {
	RecoveryHolder,
	fetchRecoveryContent,
	refreshRecoverableDocuments as refreshRemoteRecoverableDocuments,
} from './submission-tracking/recover';
import type { ResettableDocument } from './submission-tracking/reset';
import { fetchResetContent, resettableDocument } from './submission-tracking/reset';
import { readDocId, resolveSubmissionRecord } from './submission-tracking/resolve';
import type { SubmissionRecord, SubmissionState } from './submission-tracking/submission-record';
import { SUBMISSION_STATE_LABELS, UNSUBMITTED_LABEL } from './submission-tracking/submission-record';
import { SubmissionStore } from './submission-tracking/submission-store';

const VIEW_TYPE = 'docs-publisher-view';

const OPEN_SETTINGS_LABEL = 'Open settings';
const NEW_DOCUMENT_LABEL = 'New Document';
const SUBMIT_FOR_REVIEW_LABEL = 'Submit for review';

/**
 * What the submit button is called for a document that is already tracked,
 * per state. Two actions, not four: a document still under review takes a
 * revision on the review it already has, and a document whose review is over
 * — published or turned down — starts a new one.
 *
 * Author vocabulary throughout, like `SUBMISSION_STATE_LABELS` beside it: no
 * "branch", "commit", "merge request" or "MR". "Send update" says what
 * reaches the reviewer without claiming the state moves, which sending a
 * revision does not do on its own — see `UPDATE_SENT_MESSAGE`.
 */
const RESUBMIT_LABELS: Record<SubmissionState, string> = {
	pending: 'Send update',
	'changes-requested': 'Send update',
	published: 'Submit a new version',
	closed: 'Submit again',
};
const REFRESH_LABEL = 'Refresh';

/**
 * What the Refresh control says while it is working.
 *
 * The control that STARTS the work is where the work is reported, rather
 * than in a separate spinner somewhere else — there is exactly one thing to
 * look at, and it is the thing you just pressed. It covers all three lists,
 * because one press refreshes all three and the slowest of them (discovery,
 * which reads a file per candidate) is the one an author would otherwise sit
 * through with no sign anything was happening.
 */
const CHECKING_LABEL = 'Checking…';
const DOCUMENTS_HEADING = 'Your documents';
const NO_DOCUMENTS_MESSAGE = 'Nothing submitted yet. Documents you submit will be listed here.';

/**
 * The primary list's OTHER empty state, for a vault whose every document
 * has finished its review. The message above would be a lie there —
 * something has been submitted, it just isn't waiting on anyone — and the
 * documents it is talking about are visible in the second section below.
 */
const NO_OPEN_DOCUMENTS_MESSAGE = 'Nothing is waiting for review right now.';

/**
 * The second section, for documents whose review cycle is over.
 *
 * "Other documents" was carried over from design.md as a working name, with
 * the objection recorded that it reads as a leftovers bin. Kept as shipped
 * copy anyway, and the description below is what answers the objection: the
 * heading stays true as states are added (a heading naming today's two
 * would be wrong the moment a third lands here), and the line under it says
 * plainly which documents those are, so nothing is a mystery bin.
 */
const OTHER_DOCUMENTS_HEADING = 'Other documents';
const OTHER_DOCUMENTS_DESCRIPTION = "Published documents, and documents that weren't accepted.";

const OPEN_ON_PLATFORM_LABEL = 'Open in GitLab';

/**
 * add-document-recovery: the second list, for a stored record whose note is
 * gone from the vault. Absent entirely rather than shown empty — the
 * "Nothing to recover" scenario in plugin-shell's spec — so it never
 * competes with the main list for attention on the common case of nothing
 * to recover.
 */
const RECOVERABLE_DOCUMENTS_HEADING = 'Documents you can recover';

/**
 * Shown on a row whose content could not be located at all — the record has
 * no stored path and no open review left to ask (design.md's "genuine dead
 * end", proposal "Deferred, deliberately"). "Open in GitLab" is the
 * sanctioned escape hatch and is offered instead.
 */
const RECOVERY_UNAVAILABLE_MESSAGE = "This document's content can no longer be found automatically.";

/**
 * The per-ROW form of the message above, and the reason there are two.
 *
 * A vault with six unrecoverable records rendered that whole sentence six
 * times, which is most of the section's height saying one thing — and, until
 * 2026-09-20, saying it clipped, because the row's state span does not wrap.
 * The row now carries a short marker and the section carries the explanation
 * once, which is the same information in a fraction of the space.
 */
const RECOVERY_UNAVAILABLE_LABEL = 'Not available';

/**
 * The empty states for the two REMOTE-BACKED lists, which are present
 * whenever the panel is (2026-09-20).
 *
 * These sections used to vanish when empty, on the reasoning that an
 * empty-state message would compete with the main list for attention. That
 * traded one ambiguity for another and picked the worse one: an ABSENT
 * section is indistinguishable between "nothing to recover", "not asked yet"
 * and "the check failed", and the first is the only one of the three that
 * needs nothing from the author. This plugin refuses to let a truncated
 * listing read as complete or a failed read as absence; letting an unasked
 * question read as an empty answer was the same mistake on the surface the
 * author actually looks at.
 *
 * "Other documents" keeps the old behaviour deliberately, and the difference
 * is principled rather than an inconsistency: it partitions documents ALREADY
 * IN THE VAULT, so its emptiness is a local fact that is never in doubt.
 * There is no unasked question for it to be confused with.
 */
const NO_RECOVERABLE_MESSAGE = 'Nothing to recover.';
const NO_DISCOVERABLE_MESSAGE = 'Nothing to import.';

/** Before the first refresh has answered — distinct from both of the above. */
const NOT_CHECKED_MESSAGE = 'Not checked yet.';

/**
 * Shown beside a section's heading when its last check failed.
 *
 * A collapsed section shows its heading and nothing else, so without this the
 * three empty cases would become indistinguishable again the moment anyone
 * collapsed one — which is the distinction the messages above exist to draw.
 * A resolved section shows its count instead; a running one shows nothing,
 * because the Refresh control already reads "Checking…".
 */
const SECTION_FAILED_SUFFIX = '(check failed)';

/** Keys for the two sections whose collapsed state the view remembers. */
const RECOVERY_SECTION_KEY = 'recover';
const DISCOVERY_SECTION_KEY = 'discover';

/** The outcome kinds a section heading distinguishes. */
type RefreshOutcomeKind = 'never' | 'refreshing' | 'succeeded' | 'failed';

/**
 * What a section's heading says beside its title, or null for nothing.
 *
 * A COUNT ONLY WHEN ONE WAS ESTABLISHED, zero included — zero is an answer
 * the remote gave. A check that has not run, or is running, shows nothing
 * rather than a "(0)" nobody established; the Refresh control already reads
 * "Checking…" for the second of those.
 */
function sectionSuffix(outcome: RefreshOutcomeKind, count: number): string | null {
	if (outcome === 'failed') {
		return SECTION_FAILED_SUFFIX;
	}

	return outcome === 'succeeded' ? `(${count})` : null;
}

const RECOVERY_REFRESH_FAILED_MESSAGE =
	'Could not check which documents can be recovered just now. Try again later.';

function recoveryPermissionMessage(detail: string | undefined): string {
	const missing = detail === undefined ? '' : ` (missing: ${detail})`;
	return (
		`Your access token doesn't have permission to check which documents can be recovered${missing}. ` +
		'Ask your admin to add it.'
	);
}

/**
 * add-discover-and-import: the third list, for a document the remote holds
 * that this vault has no note for. Absent entirely rather than shown empty,
 * like the two conditional sections above it — the common case for a vault
 * that is already current is nothing to import, and a standing empty-state
 * message for it would be one more thing competing with the list the author
 * actually checks.
 */
const DISCOVERABLE_DOCUMENTS_HEADING = 'Documents you can import';
const DISCOVERABLE_DOCUMENTS_DESCRIPTION = 'Documents on the platform that this vault has no copy of.';

/**
 * Shown when the listing this section was built from hit its cap. Says
 * plainly that the list is partial rather than letting a partial list read
 * as everything available — a document missing from a truncated listing is
 * indistinguishable from one that does not exist (design.md decision 7).
 */
const DISCOVERY_INCOMPLETE_MESSAGE =
	'There are more documents than could be listed at once, so this list is incomplete.';

const DISCOVERY_REFRESH_FAILED_MESSAGE =
	'Could not check which documents are available to import just now. Try again later.';

function discoveryPermissionMessage(detail: string | undefined): string {
	const missing = detail === undefined ? '' : ` (missing: ${detail})`;
	return (
		`Your access token doesn't have permission to list the project's documents${missing}. ` +
		'Ask your admin to add it.'
	);
}

/**
 * One line per outcome, so a batch reports what happened to EVERY document
 * rather than only to the last one — the refusals are the whole reason the
 * batch continues past them (tasks.md 5.4).
 *
 * A refusal with no reason is the authoring gate having already said what to
 * do next; repeating it once per document would bury its own advice.
 */
function importBatchMessage(imported: number, refused: number, incomplete: readonly string[]): string {
	const lines = [`Imported ${imported} ${imported === 1 ? 'document' : 'documents'}.`];

	// A COUNT, and the reasons on the rows themselves. The first real batch
	// over the corpus refused eight documents for three different reasons, and
	// putting all eight in here produced a notice that covered the panel it
	// was describing (`docs/ce-verification.md` §E6). Each refused row now
	// carries its own reason, which is where the author is already looking.
	if (refused > 0) {
		lines.push(
			`${refused} could not be imported — each one below says why.`
		);
	}

	// Attachments are the exception and stay here: those documents DID import,
	// so they leave the list and have no row left to carry the news.
	for (const path of incomplete) {
		lines.push(path);
	}
	if (incomplete.length > 0) {
		lines.push('Some images did not come with the documents above.');
	}

	return lines.join('\n');
}

function resetPermissionMessage(detail: string | undefined): string {
	const missing = detail === undefined ? '' : ` (missing: ${detail})`;
	return (
		`Your access token doesn't have permission to read the version under review${missing}. ` +
		'Ask your admin to add it.'
	);
}

/**
 * Builds a merge request's web link directly from the connection details and
 * a stored `mrIid`, rather than fetching `web_url` — an orphaned record's
 * "Open in GitLab" link must cost no request (plugin-shell spec: "Listing
 * which orphaned records exist SHALL make no remote request"). Mirrors
 * `gitlab-client.ts`'s own host/project normalization exactly enough for a
 * link; if `GL_PROJECT` is ever a numeric id rather than the namespace path
 * `docs/access-tokens.md` §3 recommends, this link will not resolve — a
 * cosmetic gap, not a functional one, since nothing else here depends on it.
 */
function mergeRequestUrl(details: ConnectionDetails, mrIid: number): string {
	const host = details.host.trim().replace(/\/+$/, '');
	const normalizedHost = /^https?:\/\//i.test(host) ? host : `https://${host}`;
	const project = details.projectId.trim().replace(/^\/+/, '').replace(/\/+$/, '');
	return `${normalizedHost}/${project}/-/merge_requests/${mrIid}`;
}

/**
 * Shown when a refresh did not succeed. Says the states on screen may have
 * moved on WITHOUT claiming to know how, and never blanks the list — the
 * author keeps what was last known rather than losing it to a failed check.
 *
 * Vocabulary-checked, like everything else on this surface: no "branch",
 * "commit", "merge request", "MR", "conflict" or "main". "Open in GitLab"
 * above is the sanctioned escape-hatch wording and is the one exception.
 */
const REFRESH_FAILED_MESSAGE =
	"Could not check your documents' status just now. They may have changed " +
	'since this was last updated.';

/**
 * The refused-for-a-permission variant, which names the permission rather
 * than sending the author to check their connection — the classification
 * built by the interrupted-submit change already carries GitLab's own name
 * for it. The parenthetical is dropped entirely when no name came back: an
 * invented one would send someone to tick the wrong box.
 */
function refreshPermissionMessage(detail: string | undefined): string {
	const missing = detail === undefined ? '' : ` (missing: ${detail})`;
	return (
		`Your access token doesn't have permission to check your documents' status${missing}. ` +
		'Ask your admin to add it.'
	);
}

/**
 * The panel's own copy for each failure. Deliberately not shared with the
 * settings tab's table: that one says "check the project ID above", which
 * means nothing in a sidebar with no fields above it.
 */
const PANEL_FAILURE_MESSAGES: Record<FailureKind, string> = {
	'rejected-credential': 'Your access has expired or is incorrect. Ask your admin to set it up again.',
	'not-reachable':
		'That project could not be found, or your access does not include it. Check your details in settings.',
	'server-unreachable':
		'Could not reach GitLab at that address. Check the address and your connection, then try again.',
	// Unreachable via the connection check this table describes — see the
	// matching note in settings-tab.ts. Present for exhaustiveness only.
	'insufficient-permission': "Your access token doesn't have permission to do that. Ask your admin to add it.",
	// Unreachable here for the same reason: this table describes a refresh,
	// which only reads, and content-changed is produced solely by a refused
	// write. Present for exhaustiveness only.
	'content-changed': 'Someone else changed this document. Open it in GitLab to see their changes.',
	// REACHABLE here, unlike the two above: every list the panel shows needs a
	// ref to read from, so a project with no commits fails all of them at once
	// — and "try again later" would be useless advice for a state that does
	// not change on its own.
	'empty-repository': EMPTY_REPOSITORY_MESSAGE,
	'unexpected': 'The connection check did not succeed. Check your details in settings and try again.',
};

class DocsPublisherView extends ItemView {
	private readonly state: ConnectionStateHolder;
	private readonly pluginId: string;
	private readonly details: ConnectionDetails;
	private readonly newDocument: () => void;
	private readonly submitForReview: () => void;
	private readonly resolveSubmission: (file: TFile) => SubmissionRecord | null;
	private readonly statuses: DocumentStatusHolder;
	private readonly refreshStatuses: () => void;
	private readonly recoverable: RecoveryHolder;
	private readonly recoverDocument: (entry: Extract<OrphanedDocument, { recoverable: true }>) => void;
	private readonly resetDocument: (file: TFile, target: ResettableDocument) => void;
	private readonly discoverable: DiscoveryHolder;
	private readonly importDocument: (entry: DiscoverableDocument) => void;
	private readonly importAllDocuments: () => void;
	/**
	 * Which collapsible sections the author has collapsed, by key.
	 *
	 * On the VIEW and nowhere else, which makes it last the session and no
	 * longer. It cannot live in the DOM — `render` empties `contentEl` and
	 * rebuilds it on every note switch — and it deliberately does not go to
	 * `data.json`, which is documented as a cache of what the remote said
	 * rather than a place for this surface's preferences.
	 */
	private readonly collapsed = new Set<string>();
	// The pending `setTimeout` id for a scheduled-but-not-yet-run render, or
	// null when none is pending. See `scheduleRender`.
	private renderTimer: number | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		state: ConnectionStateHolder,
		pluginId: string,
		details: ConnectionDetails,
		newDocument: () => void,
		submitForReview: () => void,
		resolveSubmission: (file: TFile) => SubmissionRecord | null,
		statuses: DocumentStatusHolder,
		refreshStatuses: () => void,
		recoverable: RecoveryHolder,
		recoverDocument: (entry: Extract<OrphanedDocument, { recoverable: true }>) => void,
		resetDocument: (file: TFile, target: ResettableDocument) => void,
		discoverable: DiscoveryHolder,
		importDocument: (entry: DiscoverableDocument) => void,
		importAllDocuments: () => void
	) {
		super(leaf);
		this.state = state;
		this.pluginId = pluginId;
		// Read-only here: this view never writes to the connection, it only
		// needs the host/project to build an orphaned record's "Open in
		// GitLab" link without a request (see `mergeRequestUrl`).
		this.details = details;
		// Handed in rather than built here, so the control and the command
		// palette entry are literally the same path and cannot drift apart.
		this.newDocument = newDocument;
		this.submitForReview = submitForReview;
		this.resolveSubmission = resolveSubmission;
		this.statuses = statuses;
		// The single refresh path, for the same reason. Opening this view and
		// pressing Refresh must not be two different code paths (tasks.md 4.3).
		this.refreshStatuses = refreshStatuses;
		this.recoverable = recoverable;
		this.recoverDocument = recoverDocument;
		this.resetDocument = resetDocument;
		this.discoverable = discoverable;
		this.importDocument = importDocument;
		this.importAllDocuments = importAllDocuments;
	}

	getViewType(): string {
		return VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Docs Publisher';
	}

	getIcon(): string {
		return 'git-branch';
	}

	async onOpen(): Promise<void> {
		// Teardown goes through the view's own component lifecycle, so a check
		// that finishes after the view closes cannot render into a detached
		// container.
		this.register(
			this.state.onChange(() => {
				this.scheduleRender();
			})
		);

		// The submit section depends on which note is open and its front
		// matter, neither of which the connection state above tracks — so the
		// panel also re-renders when the active note or its metadata changes.
		//
		// Confirmed via diagnostic logging: clicking a button in this view
		// while it is NOT the active leaf makes Obsidian activate this leaf as
		// part of handling `mousedown` — synchronously, tens of milliseconds
		// before `mouseup`/`click` fire (real wall-clock time, not a
		// microtask/macrotask boundary, so no deferral trick dodges it). That
		// fires `active-leaf-change` for THIS view's own leaf, which used to
		// schedule a rebuild that tore out the very button being pressed
		// before its `click` could land. The actual fix is narrower than any
		// timing trick: this view's own leaf becoming active changes nothing
		// it displays (not which note is open, not its submission state), so
		// that specific transition is skipped rather than raced.
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', (leaf) => {
				if (leaf === this.leaf) {
					return;
				}
				this.scheduleRender();
			})
		);
		this.registerEvent(this.app.workspace.on('file-open', () => this.scheduleRender()));
		this.registerEvent(this.app.metadataCache.on('changed', () => this.scheduleRender()));

		// NOTE for anyone extending the three subscriptions above: none of them
		// may reach the remote. They fire on every note switch and on every
		// keystroke that touches front matter, so a request wired into the render
		// path would be a request per keystroke. Rendering reads the resolved
		// states this holder already has; refreshing is the two triggers below
		// and nothing else. See design.md decision 5.
		this.register(
			this.statuses.onChange(() => {
				this.scheduleRender();
			})
		);

		// Same reasoning as the subscription above, for the orphaned-record
		// list's own cache (add-document-recovery).
		this.register(
			this.recoverable.onChange(() => {
				this.scheduleRender();
			})
		);

		// And again for the discoverable set (add-discover-and-import). Same
		// rule as the two above: this subscription redraws from a cache and
		// never reaches the remote.
		this.register(
			this.discoverable.onChange(() => {
				this.scheduleRender();
			})
		);

		this.render();

		// Trigger one of two. The other is the Refresh control, and both go
		// through the same handed-in path.
		this.refreshStatuses();
	}

	async onClose(): Promise<void> {
		// A render scheduled just before close would otherwise fire after —
		// harmless (the container is simply off-screen), but pointless work
		// on a view nobody can see, so it's cancelled outright.
		if (this.renderTimer !== null) {
			window.clearTimeout(this.renderTimer);
			this.renderTimer = null;
		}
	}

	/**
	 * Coalesces same-burst render requests into one rebuild — `file-open` and
	 * a metadata-cache `changed` event commonly both fire for what is, to the
	 * author, one note switch. `setTimeout` rather than a bare `render()`
	 * call, so a run of several events in the same tick costs one rebuild,
	 * not several.
	 *
	 * NOT a defence against rebuilding mid-click: `mousedown` and `mouseup`
	 * are separated by real wall-clock time (however long the button stays
	 * physically pressed), not by a queue boundary, so no deferral length
	 * reliably outruns it — confirmed by logging the actual event sequence
	 * during the swallowed-click investigation. The fix for that was to stop
	 * scheduling a render at all for the specific event that fired mid-click
	 * (this view's own leaf becoming active) — see `onOpen`.
	 */
	private scheduleRender(): void {
		if (this.renderTimer !== null) {
			return;
		}

		this.renderTimer = window.setTimeout(() => {
			this.renderTimer = null;
			this.render();
		}, 0);
	}

	private render(): void {
		const container = this.contentEl;
		container.empty();

		const state = this.state.current;
		this.renderHeader(container, state);
		this.renderBody(container, state);
	}

	/**
	 * The header is decided independently of the body: the person is named
	 * whenever an identity is known, which is what tells an author their
	 * details were accepted even when their role is the obstacle.
	 */
	private renderHeader(container: HTMLElement, state: ConnectionState): void {
		const identity = state.kind === 'verified' || state.kind === 'failed' ? state.identity : null;
		if (identity === null) {
			return;
		}

		container.createEl('h4', { text: `Connected as ${identity.name}` });

		// Only when an access level was actually read. Role names are shown
		// literally — see docs/gitlab-roles.md §7.
		if (state.kind === 'verified' && state.access.accessLevel !== null) {
			container.createEl('p', {
				text: `${state.access.accessLabel} access`,
				cls: 'setting-item-description',
			});
		}
	}

	private renderBody(container: HTMLElement, state: ConnectionState): void {
		if (state.kind === 'checking') {
			container.createEl('p', { text: 'Checking…' });
			return;
		}

		if (state.kind === 'unverified') {
			container.createEl('h4', { text: 'Not connected yet' });
			container.createEl('p', { text: 'Add your GitLab details to start publishing documents.' });
			this.addSettingsButton(container);
			container.createEl('p', {
				text: 'You enter these once each time you start Obsidian.',
				cls: 'setting-item-description',
			});
			return;
		}

		// The three connected states, in descending capability. "Ready to
		// publish" belongs to this first one alone: below Developer the author
		// can publish nothing, so telling them they are ready would contradict
		// the panel's own refusal. See docs/gitlab-roles.md §3.
		if (state.kind === 'verified') {
			if (grantsAuthoring(state)) {
				container.createEl('p', { text: 'Ready to publish your documentation.' });
				const actions = container.createDiv({ cls: 'docs-publisher-actions' });
				this.addNewDocumentButton(actions);
				this.renderSubmitSection(container, actions);
				this.renderDocumentList(container);
				// Recovering creates a new local note exactly as "New Document"
				// does, so it is gated the same way and shown only here.
				this.renderRecoverySection(container);
				// Importing does too, so the same applies — and it sits last
				// because it is about documents the author has not worked on,
				// below both lists of documents they have.
				this.renderDiscoverySection(container);
				return;
			}

			// The list shows for this band too: Planner and Reporter can read the
			// project's documents and its review queue, so they can see where a
			// document stands even though they cannot add to it
			// (`docs/gitlab-roles.md` §3). Nothing in the list is an action.
			if (grantsReadOnly(state)) {
				container.createEl('p', { text: readOnlyMessage(state.access.accessLabel) });
				this.addSettingsButton(container);
				this.renderDocumentList(container);
				return;
			}
		}

		// Everything else is blocked: the same layout either way, differing only
		// in the message and in how much of the header was available above.
		container.createEl('p', { text: this.blockedMessage(state) });
		this.addSettingsButton(container);
	}

	private blockedMessage(state: ConnectionState): string {
		if (state.kind === 'failed') {
			return PANEL_FAILURE_MESSAGES[state.failure];
		}

		return NO_DOCUMENT_ACCESS_MESSAGE;
	}

	/**
	 * The currently open document's own action — per the "New Document"
	 * section above, this whole branch already requires Developer access.
	 * Shows nothing when no markdown note is open: submitting is an action on
	 * the active note, not a standing panel feature.
	 *
	 * Every state offers one, as of add-resubmission-lifecycle. This used to
	 * render the state label and return for any tracked document, which left
	 * the command palette as the only way to resubmit anything and said
	 * nothing about what resubmitting would even do
	 * (`docs/resubmission-lifecycle.md` §4). What the action MEANS differs by
	 * state and the label says which: a document under review takes a
	 * revision, a finished one starts a new round.
	 */
	private renderSubmitSection(statusContainer: HTMLElement, actionsContainer: HTMLElement): void {
		const file = this.app.workspace.getActiveFile();
		if (file === null || file.extension !== 'md') {
			return;
		}

		const record = this.resolveSubmission(file);
		if (record !== null) {
			statusContainer.createEl('p', {
				text: SUBMISSION_STATE_LABELS[record.state],
				cls: 'setting-item-description',
			});
		}

		// One entry point for all five cases, tracked or not: the same method
		// the command palette calls, which resolves what the document actually
		// needs itself. The button chooses only what it is CALLED, never what it
		// does — a panel that decided the action separately would be a second
		// place for the four-way fork to live, and the two would drift.
		new ButtonComponent(actionsContainer)
			.setButtonText(record === null ? SUBMIT_FOR_REVIEW_LABEL : RESUBMIT_LABELS[record.state])
			.setCta()
			.onClick(() => {
				this.submitForReview();
			});

		this.renderResetAction(actionsContainer, file);
	}

	/**
	 * Reset, for the open note only and only while its review is open.
	 *
	 * Beside the resubmit action above rather than on every row of the list,
	 * and that is a safety property, not a layout preference: Reset destroys
	 * local work, and requiring the note to be open means the author is
	 * looking at what they are about to discard. A row of Reset buttons in a
	 * list makes a misclick cheap and the thing destroyed invisible — the
	 * confirmation would then be the ONLY thing between a slip and lost work
	 * rather than the second thing (design.md decision 2).
	 *
	 * Eligibility is read from the RESOLVED state, not from the stored
	 * record the section above labels with. A stored state can be left over
	 * from a previous session, and offering a destructive action off one
	 * would act on an answer the remote was never asked for. A document
	 * nothing has resolved yet gets no Reset at all, for the same reason its
	 * row shows no label.
	 */
	private renderResetAction(container: HTMLElement, file: TFile): void {
		const docId = readDocId(this.app, file);
		if (docId === null) {
			return;
		}

		const target = resettableDocument(this.statuses.statusFor(docId));
		if (target === null) {
			return;
		}

		new ButtonComponent(container)
			.setButtonText(RESET_LABEL)
			.setWarning()
			.onClick(() => {
				this.resetDocument(file, target);
			});
	}

	/**
	 * The author's documents and where each one stands, across two sections.
	 *
	 * Renders from the resolved states the holder already has and makes no
	 * remote call of its own — this runs on every note switch and every front
	 * matter edit. The only things that reach the remote are the Refresh
	 * control below and the view opening. The split costs no request either:
	 * it is a partition of data this method already holds.
	 */
	/**
	 * Whether any of the panel's three remote-backed lists is mid-refresh.
	 *
	 * All three are filled by one press and one panel-open, so "is the plugin
	 * working right now" is a question about the set rather than about any one
	 * of them.
	 */
	private isChecking(): boolean {
		return (
			this.statuses.lastOutcome.kind === 'refreshing' ||
			this.recoverable.lastOutcome.kind === 'refreshing' ||
			this.discoverable.lastOutcome.kind === 'refreshing'
		);
	}

	/**
	 * A section heading that collapses what is under it, the way Obsidian's
	 * own "Linked mentions" / "Unlinked mentions" headings do.
	 *
	 * Returns whether the body should be built at all, so a collapsed section
	 * costs its heading and nothing else — which is the point, on the two
	 * sections that grow.
	 *
	 * The chevron and the heading are the click target, and the rest of the
	 * header row is NOT: "Import all" sits there too, and pressing it must not
	 * collapse the section out from under the press.
	 */
	private renderCollapsibleHeader(
		header: HTMLElement,
		params: { key: string; text: string; count: number; outcome: RefreshOutcomeKind }
	): boolean {
		const expanded = !this.collapsed.has(params.key);

		// NO CHEVRON, deliberately. The headings this is modelled on show none
		// either, and an arrow here indented the title out of line with the
		// panel's other headings for the sake of an affordance the pointer
		// cursor and the hover colour already carry. Which state a section is
		// in stays readable without one: the suffix reports the count or the
		// failure, and a heading with a count and nothing under it is folded.
		const toggle = header.createDiv({ cls: 'docs-publisher-section-toggle' });
		toggle.createEl('h4', { text: params.text });

		const suffix = sectionSuffix(params.outcome, params.count);
		if (suffix !== null) {
			toggle.createSpan({ cls: 'docs-publisher-section-count', text: suffix });
		}

		toggle.addEventListener('click', () => {
			if (expanded) {
				this.collapsed.add(params.key);
			} else {
				this.collapsed.delete(params.key);
			}
			this.render();
		});

		return expanded;
	}

	private renderDocumentList(container: HTMLElement): void {
		const section = container.createDiv({ cls: 'docs-publisher-documents' });
		const header = section.createDiv({ cls: 'docs-publisher-documents-header' });
		header.createEl('h4', { text: DOCUMENTS_HEADING });

		const outcome = this.statuses.lastOutcome;
		// One press refreshes all three lists, so the control reports all
		// three. Reading only this list's outcome left the button idle and
		// enabled while discovery — much the slowest, a file read per
		// candidate — was still running, which is the state an author reads as
		// "nothing is happening".
		const checking = this.isChecking();
		const refresh = new ButtonComponent(header)
			.setButtonText(checking ? CHECKING_LABEL : REFRESH_LABEL)
			.onClick(() => {
				this.refreshStatuses();
			});
		if (checking) {
			refresh.setDisabled(true);
		}

		if (outcome.kind === 'failed') {
			section.createEl('p', {
				text:
					outcome.failure === 'insufficient-permission'
						? refreshPermissionMessage(outcome.detail)
						: REFRESH_FAILED_MESSAGE,
				cls: 'setting-item-description',
			});
		}

		// Built from the vault, not from stored records — design.md decision 6.
		const { open, finished } = this.partitionDocuments(listVaultDocuments(this.app));

		if (open.length === 0) {
			section.createEl('p', {
				text: finished.length === 0 ? NO_DOCUMENTS_MESSAGE : NO_OPEN_DOCUMENTS_MESSAGE,
				cls: 'setting-item-description',
			});
		} else {
			const list = section.createEl('ul', { cls: 'docs-publisher-document-list' });
			for (const entry of open) {
				this.renderDocumentRow(list, entry);
			}
		}

		// Rendered from here rather than from `renderBody`, so the two
		// sections cannot be wired to different sets of callers: every band
		// that sees one sees the other, including the read-only one, where
		// neither section is an action.
		this.renderOtherDocuments(container, finished);
	}

	/**
	 * Splits tracked documents into the one list an author checks for work
	 * and the one that holds everything else.
	 *
	 * Only published and not-accepted move. EVERYTHING else stays in the
	 * primary section, and the case that matters is the unresolved one: a
	 * document nothing has resolved yet (`statusFor` returns null, the
	 * first-refresh-failed case) stays put, because moving it would assert
	 * that its cycle is over — a settled state nothing established, which is
	 * precisely the silent wrongness this panel's whole status mechanism
	 * exists to prevent (design.md decision 4).
	 */
	private partitionDocuments(documents: readonly VaultDocument[]): {
		open: VaultDocument[];
		finished: VaultDocument[];
	} {
		const open: VaultDocument[] = [];
		const finished: VaultDocument[] = [];

		for (const entry of documents) {
			const state = this.statuses.statusFor(entry.docId)?.submission?.state ?? null;
			if (state === 'published' || state === 'closed') {
				finished.push(entry);
			} else {
				open.push(entry);
			}
		}

		return { open, finished };
	}

	/**
	 * "Other documents" — published and not-accepted documents still in the
	 * vault, at lower prominence.
	 *
	 * Absent entirely when it holds nothing, the same way "Documents you can
	 * recover" already is, rather than competing with the primary list for
	 * attention on the common case of having nothing to say.
	 *
	 * Rows are the same rows: name, state label, and the "Open in GitLab"
	 * escape hatch. This section exists to preserve VISIBILITY that
	 * narrowing the primary list would otherwise cost — the resubmit action
	 * for these documents renders in the submit section for whichever note
	 * is open, and never on a row here.
	 */
	private renderOtherDocuments(container: HTMLElement, documents: readonly VaultDocument[]): void {
		if (documents.length === 0) {
			return;
		}

		const section = container.createDiv({
			cls: 'docs-publisher-documents docs-publisher-documents-secondary',
		});
		section.createEl('h4', { text: OTHER_DOCUMENTS_HEADING });
		section.createEl('p', {
			text: OTHER_DOCUMENTS_DESCRIPTION,
			cls: 'setting-item-description',
		});

		const list = section.createEl('ul', { cls: 'docs-publisher-document-list' });
		for (const entry of documents) {
			this.renderDocumentRow(list, entry);
		}
	}

	/**
	 * One document: its name, its state's label, and a way out to the platform.
	 *
	 * A document nothing has resolved yet shows its name and NO label. That is
	 * the first-refresh-failed case, and inventing a state for it — even
	 * "Waiting for review", which would be right most of the time — is exactly
	 * the silent wrongness this whole milestone exists to remove.
	 */
	private renderDocumentRow(list: HTMLElement, entry: VaultDocument): void {
		const row = list.createEl('li', { cls: 'docs-publisher-document' });
		row.createSpan({ cls: 'docs-publisher-document-name', text: entry.file.basename });

		const status = this.statuses.statusFor(entry.docId);
		if (status === null) {
			return;
		}

		if (status.submission === null) {
			row.createSpan({ cls: 'docs-publisher-document-state', text: UNSUBMITTED_LABEL });
			return;
		}

		row.createSpan({
			cls: 'docs-publisher-document-state',
			text: SUBMISSION_STATE_LABELS[status.submission.state],
		});

		// Offered only for a document that has been submitted and came back with
		// a link. "Open in GitLab" is the sanctioned escape-hatch wording and the
		// one place the platform is named on this surface.
		if (status.submission.webUrl !== null) {
			const link = row.createEl('a', {
				cls: 'docs-publisher-document-link',
				text: OPEN_ON_PLATFORM_LABEL,
				href: status.submission.webUrl,
			});
			link.setAttr('target', '_blank');
			link.setAttr('rel', 'noopener noreferrer');
		}
	}

	/**
	 * "Documents you can recover" — every stored record whose `doc_id` has no
	 * matching note in the vault, add-document-recovery. Renders from the
	 * holder's cache alone, filled by the same refresh this view already
	 * triggers for the main list, so this costs no request of its own on a
	 * normal render pass (tasks.md 4.3). Absent when there is nothing to
	 * recover — plugin-shell spec's "Nothing to recover" scenario — rather
	 * than shown with a competing empty-state message.
	 *
	 * ALWAYS PRESENT, empty or not (2026-09-20) — see `NO_RECOVERABLE_MESSAGE`
	 * for why the section stopped vanishing. It also used to return on an
	 * empty list BEFORE reaching the failure block below, which made both
	 * messages there unreachable in the case that matters most: a first
	 * refresh that failed has nothing previously resolved, so the author was
	 * told nothing at all.
	 */
	private renderRecoverySection(container: HTMLElement): void {
		const documents = this.recoverable.current;
		const outcome = this.recoverable.lastOutcome;

		const section = container.createDiv({ cls: 'docs-publisher-documents' });
		const header = section.createDiv({ cls: 'docs-publisher-documents-header' });
		const expanded = this.renderCollapsibleHeader(header, {
			key: RECOVERY_SECTION_KEY,
			text: RECOVERABLE_DOCUMENTS_HEADING,
			count: documents.length,
			outcome: outcome.kind,
		});
		if (!expanded) {
			return;
		}

		// Said ONCE, for however many rows are marked "Not available", instead
		// of once per row.
		if (documents.some((entry) => !entry.recoverable)) {
			section.createEl('p', {
				text: RECOVERY_UNAVAILABLE_MESSAGE,
				cls: 'setting-item-description',
			});
		}

		if (outcome.kind === 'failed') {
			section.createEl('p', {
				text:
					outcome.failure === 'insufficient-permission'
						? recoveryPermissionMessage(outcome.detail)
						: RECOVERY_REFRESH_FAILED_MESSAGE,
				cls: 'setting-item-description',
			});
		}

		if (documents.length === 0) {
			// The three empty cases say three different things. A failure has
			// already spoken for itself just above; the other two have not.
			if (outcome.kind !== 'failed') {
				section.createEl('p', {
					text: outcome.kind === 'succeeded' ? NO_RECOVERABLE_MESSAGE : NOT_CHECKED_MESSAGE,
					cls: 'setting-item-description',
				});
			}
			return;
		}

		const list = section.createEl('ul', { cls: 'docs-publisher-document-list' });
		for (const entry of documents) {
			this.renderRecoverableRow(list, entry);
		}
	}

	/**
	 * One orphaned record: its `doc_id` (the only name left for it — there is
	 * no note to read a filename from), and either a Recover button or the
	 * explanation plus the existing "Open in GitLab" escape hatch.
	 */
	private renderRecoverableRow(list: HTMLElement, entry: OrphanedDocument): void {
		const row = list.createEl('li', { cls: 'docs-publisher-document' });
		row.createSpan({ cls: 'docs-publisher-document-name', text: entry.docId });

		if (!entry.recoverable) {
			row.createSpan({
				cls: 'docs-publisher-document-state',
				text: RECOVERY_UNAVAILABLE_LABEL,
			});
			const link = row.createEl('a', {
				cls: 'docs-publisher-document-link',
				text: OPEN_ON_PLATFORM_LABEL,
				href: mergeRequestUrl(this.details, entry.record.mrIid),
			});
			link.setAttr('target', '_blank');
			link.setAttr('rel', 'noopener noreferrer');
			return;
		}

		new ButtonComponent(row).setButtonText(RECOVER_LABEL).onClick(() => {
			this.recoverDocument(entry);
		});
	}

	/**
	 * "Documents you can import" — every markdown document the remote's
	 * default branch holds that this vault has no note at that path for
	 * (add-discover-and-import). Renders from the holder's cache alone,
	 * filled by the same refresh this view already triggers for the two lists
	 * above it, so a render pass costs no request (tasks.md 5.6).
	 *
	 * Absent when there is nothing to import — the plugin-shell spec's "the
	 * vault already has everything" scenario — rather than shown with a
	 * competing empty-state message.
	 *
	 * ALWAYS PRESENT, empty or not (2026-09-20) — see
	 * `NO_DISCOVERABLE_MESSAGE`. It also used to return on an empty list
	 * before reaching the failure block, and the comment here used to claim
	 * that was harmless because "a refresh that failed with nothing previously
	 * resolved says so through the main list's own failure line". THAT WAS
	 * WRONG, and wrong in the way that matters: the main list reads MERGE
	 * REQUESTS and this reads the REPOSITORY TREE, which are different
	 * permissions on a fine-grained token. A token granted `Merge Request:
	 * Read` and not repository read makes the main list succeed and this one
	 * fail — silently, on every refresh, with the author never told which
	 * permission to ask for.
	 */
	private renderDiscoverySection(container: HTMLElement): void {
		const documents = this.discoverable.current;
		const outcome = this.discoverable.lastOutcome;

		const section = container.createDiv({
			cls: 'docs-publisher-documents docs-publisher-documents-discover',
		});
		const header = section.createDiv({ cls: 'docs-publisher-documents-header' });
		const expanded = this.renderCollapsibleHeader(header, {
			key: DISCOVERY_SECTION_KEY,
			text: DISCOVERABLE_DOCUMENTS_HEADING,
			count: documents.length,
			outcome: outcome.kind,
		});

		// No "Import all" over nothing, and no description of a list that is
		// not there — the section is carrying a failure, not an offer. Nor
		// either while collapsed: the heading is the whole section then, and
		// an action beside it would act on a list nobody can see.
		//
		// BELOW the heading rather than beside it, unlike Refresh on "Your
		// documents" above. That heading is two short words and leaves room;
		// this one is four and wrapped around the button, breaking the title
		// across two lines to make space for it. The button sits under the
		// description instead, directly above the list it acts on.
		if (expanded && documents.length > 0) {
			section.createEl('p', {
				text: DISCOVERABLE_DOCUMENTS_DESCRIPTION,
				cls: 'setting-item-description',
			});
			const actions = section.createDiv({ cls: 'docs-publisher-section-actions' });
			new ButtonComponent(actions).setButtonText(IMPORT_ALL_LABEL).onClick(() => {
				this.importAllDocuments();
			});
		}

		if (!expanded) {
			return;
		}

		if (outcome.kind === 'failed') {
			section.createEl('p', {
				text:
					outcome.failure === 'insufficient-permission'
						? discoveryPermissionMessage(outcome.detail)
						: DISCOVERY_REFRESH_FAILED_MESSAGE,
				cls: 'setting-item-description',
			});
		}

		// Said plainly, and said next to the list it qualifies rather than in
		// a notice that has already gone by the time the author reads the rows.
		if (this.discoverable.incomplete) {
			section.createEl('p', {
				text: DISCOVERY_INCOMPLETE_MESSAGE,
				cls: 'setting-item-description',
			});
		}

		if (documents.length === 0) {
			if (outcome.kind !== 'failed') {
				section.createEl('p', {
					text: outcome.kind === 'succeeded' ? NO_DISCOVERABLE_MESSAGE : NOT_CHECKED_MESSAGE,
					cls: 'setting-item-description',
				});
			}
			return;
		}

		const list = section.createEl('ul', { cls: 'docs-publisher-document-list' });
		for (const entry of documents) {
			this.renderDiscoverableRow(list, entry);
		}
	}

	/**
	 * One discoverable document: its REMOTE PATH, and the action that brings
	 * it in.
	 *
	 * The path rather than a filename, unlike every other row on this
	 * surface, and that is what the row is for: the author is choosing
	 * between documents they have never seen, filed in a hierarchy they may
	 * not know, where two folders commonly hold similarly-named documents.
	 * The path is also exactly where the note will land.
	 */
	private renderDiscoverableRow(list: HTMLElement, entry: DiscoverableDocument): void {
		const row = list.createEl('li', { cls: 'docs-publisher-document' });
		row.createSpan({ cls: 'docs-publisher-document-name', text: entry.path });

		new ButtonComponent(row).setButtonText(IMPORT_LABEL).onClick(() => {
			this.importDocument(entry);
		});

		// Beneath the row it belongs to, rather than in a notice that covers
		// the list. A refused document stays here, so its reason can stay with
		// it — and a batch refusing several for several reasons stays readable.
		const refusal = this.discoverable.refusalFor(entry.path);
		if (refusal !== null) {
			row.createEl('p', {
				text: refusal,
				cls: 'setting-item-description docs-publisher-document-refusal',
			});
		}
	}

	/**
	 * Rendered only in the state where creating would succeed, never disabled
	 * or greyed elsewhere: a visible button that refuses when pressed is worse
	 * than no button, and the panel already re-renders when the state changes.
	 */
	private addNewDocumentButton(container: HTMLElement): void {
		new ButtonComponent(container).setButtonText(NEW_DOCUMENT_LABEL).onClick(() => {
			this.newDocument();
		});
	}

	/**
	 * Every state that shows this button shows nothing else actionable
	 * alongside it — CTA styling and the shared actions-row spacing give it
	 * the same visual weight as "Submit for review" gets when it's the one
	 * thing to press.
	 */
	private addSettingsButton(container: HTMLElement): void {
		const actions = container.createDiv({ cls: 'docs-publisher-actions' });
		new ButtonComponent(actions)
			.setButtonText(OPEN_SETTINGS_LABEL)
			.setCta()
			.onClick(() => {
				openSettingsTab(this.app, this.pluginId);
			});
	}
}

class DocsPublisherPlugin extends Plugin {
	// Session-scoped connection details. Deliberately never persisted: no
	// saveData call goes anywhere near these, so they are empty again on the
	// next launch and no token ever lands in a synced file.
	readonly connection: ConnectionDetails = createEmptyConnectionDetails();

	// The outcome of the last check, held beside the details it describes and
	// with the same lifetime — memory only, gone on reload.
	readonly connectionState = new ConnectionStateHolder();

	// Unlike the connection details above, this DOES persist to `data.json` —
	// plaintext by default per `openspec/config.yaml`'s storage decision. It
	// holds no credential, so that decision's objections don't apply here.
	readonly submissions = new SubmissionStore(this);

	// The states last resolved from the remote, plus how that went. Memory
	// only, like the connection state beside it: `data.json` is the durable
	// cache of what the remote said, and this is the session's view of it.
	readonly documentStatuses = new DocumentStatusHolder();

	// The last-resolved recoverability of every orphaned record, filled by
	// the same refresh as the above (add-document-recovery). Memory only,
	// for the same reason.
	readonly recoverableDocuments = new RecoveryHolder();

	// The last-resolved set of documents the remote has and this vault does
	// not (add-discover-and-import). Memory only, like the two above.
	readonly discoverableDocuments = new DiscoveryHolder();

	private viewActivating = false;

	async onload(): Promise<void> {
		console.log('Loading Docs Publisher plugin');

		await this.submissions.load();

		// Editing any connection detail discards the verified result, and the
		// three resolved lists have to go with it: they describe the project
		// that WAS configured, and nothing about them survives pointing the
		// plugin somewhere else.
		//
		// The settings tab already refuses to report a verified person
		// alongside details they were not verified against; this is the same
		// rule applied to the thing that actually carries actions. Without it,
		// changing the project id left "Documents you can recover" listing the
		// old project's documents with live Recover buttons beside them, while
		// both checks against the new one reported failure — observed
		// 2026-09-20.
		//
		// Only on `unverified`, which is precisely the details-were-edited
		// signal. A FAILED check keeps what was last known on purpose: the
		// project has not changed, and a stale answer beats an empty list.
		this.register(
			this.connectionState.onChange((state) => {
				if (state.kind !== 'unverified') {
					return;
				}

				this.documentStatuses.clear();
				this.recoverableDocuments.clear();
				this.discoverableDocuments.clear();
			})
		);

		// Register the custom view
		this.registerView(
			VIEW_TYPE,
			(leaf: WorkspaceLeaf) =>
				new DocsPublisherView(
					leaf,
					this.connectionState,
					this.manifest.id,
					this.connection,
					() => {
						this.newDocument();
					},
					() => {
						this.submitForReview();
					},
					(file) => resolveSubmissionRecord(this.app, this.submissions, file),
					this.documentStatuses,
					() => {
						this.refreshDocumentStatuses();
					},
					this.recoverableDocuments,
					(entry) => {
						this.recoverDocument(entry);
					},
					(file, target) => {
						this.resetDocument(file, target);
					},
					this.discoverableDocuments,
					(entry) => {
						this.importDocument(entry);
					},
					() => {
						this.importAllDocuments();
					}
				)
		);

		// Add the settings tab for the GitLab connection details
		this.addSettingTab(new ConnectionSettingTab(this.app, this));

		// Add ribbon icon
		this.addRibbonIcon('git-branch', 'Open Docs Publisher', () => {
			this.activateView();
		});

		// Register command
		this.addCommand({
			id: 'open-docs-publisher',
			name: 'Open Docs Publisher',
			callback: () => {
				this.activateView();
			}
		});

		// A plain `callback`, not `checkCallback`. `checkCallback` would drop the
		// entry from the palette when the author cannot use it, and would also
		// make a bound hotkey do nothing at all, silently — the failure mode
		// `openSettingsTab` already goes out of its way to avoid. The gate lives
		// inside the path instead and says what to do next.
		this.addCommand({
			id: 'new-document',
			name: 'New Document',
			callback: () => {
				this.newDocument();
			}
		});

		// Same plain-`callback` reasoning as "New Document" above: the gate
		// lives inside `submitForReview` itself, not in whether this entry is
		// offered.
		this.addCommand({
			id: 'submit-for-review',
			name: 'Submit for review',
			callback: () => {
				this.submitForReview();
			}
		});
	}

	onunload(): void {
		console.log('Unloading Docs Publisher plugin');
		// Note: We deliberately do NOT call detachLeavesOfType here.
		// Detaching would destroy the user's layout every time the plugin updates.
	}

	/**
	 * The one path to creating a document. Both entry points call this, so the
	 * gate is enforced wherever the action is triggered rather than by which
	 * controls happen to be on screen.
	 */
	private newDocument(): void {
		void createDocument(this.app, this.connection, this.connectionState.current);
	}

	/**
	 * The one path to submitting a document. Both entry points call this, for
	 * the same reason as `newDocument` above.
	 */
	private submitForReview(): void {
		submitDocumentForReview(this.app, this.connection, this.connectionState.current, this.submissions);
	}

	/**
	 * The one path to refreshing document states, for the same reason as the
	 * two above: the panel opening and the panel's Refresh control both come
	 * through here, so neither can drift from the other.
	 *
	 * Nothing else calls it. No timer, no note event, no render — the author
	 * refreshes and the plugin does not watch (design.md decision 5).
	 */
	private refreshDocumentStatuses(): void {
		void refreshRemoteDocumentStatuses(
			this.app,
			this.connection,
			this.connectionState.current,
			this.submissions,
			this.documentStatuses
		);
		// Same two triggers, same reasoning, for the orphaned-record list
		// (add-document-recovery, tasks.md 4.3) — kept as its own call rather
		// than folded into the one above, since state-reconciliation and
		// recoverability resolution are different questions asked of
		// different documents (design.md decision 6).
		void refreshRemoteRecoverableDocuments(
			this.app,
			this.connection,
			this.connectionState.current,
			this.submissions,
			this.recoverableDocuments
		);
		// And the third question, on the same two triggers and kept separate
		// for the same reason: "what does the remote have that this vault has
		// no trace of" is asked of documents neither of the other two knows
		// about (add-discover-and-import).
		void refreshRemoteDiscoverableDocuments(
			this.app,
			this.connection,
			this.connectionState.current,
			this.submissions,
			this.discoverableDocuments
		);
	}

	/**
	 * The one path to importing a discovered document. Writes the note from
	 * the content the refresh already read — no second request for bytes
	 * already in hand — and drops the row from the holder on success rather
	 * than waiting for the next refresh, since the note now exists locally.
	 */
	private importDocument(entry: DiscoverableDocument): void {
		void (async () => {
			const outcome = await this.runImport(entry);
			if (!outcome.ok) {
				// Onto the row, not into a notice: the document is still in the
				// list, so the reason belongs beside it where it stays put. A
				// refusal with no reason is the authoring gate, which has
				// already said what to do next.
				this.discoverableDocuments.recordRefusals(
					outcome.reason === '' ? new Map() : new Map([[outcome.path, outcome.reason]])
				);
				return;
			}

			// Said only when something is missing. A document whose images all
			// arrived says nothing, which is what keeps this worth reading.
			const attachments = attachmentReportMessage(outcome.attachments);
			if (attachments !== null) {
				new Notice(attachments);
			}
		})();
	}

	/**
	 * "Import all", which CONTINUES PAST A REFUSAL and reports every outcome
	 * (tasks.md 5.4). One duplicate `doc_id` must not block importing thirty
	 * unrelated documents, and the author needs to know which one it was.
	 *
	 * Gated once here rather than per document: the gate is a property of the
	 * connection, not of any one document, so a batch that cannot run at all
	 * should say so once. `importDocument` gates again regardless, which is
	 * the actual enforcement.
	 *
	 * Sequential rather than concurrent. Each import is a vault write, the
	 * refusals are decided against the vault's own current contents, and two
	 * imports racing on the same folder creation is the kind of bug that only
	 * appears on somebody else's machine.
	 */
	private importAllDocuments(): void {
		if (requireAuthoringGate(this.connection, this.connectionState.current) === null) {
			return;
		}

		void (async () => {
			// Copied first: each success removes a row from the holder, and
			// iterating a list while the thing it comes from is being edited
			// is how a batch silently skips half its work.
			const documents = [...this.discoverableDocuments.current];
			const refusals = new Map<string, string>();
			const incomplete: string[] = [];
			let imported = 0;

			for (const entry of documents) {
				const outcome = await this.runImport(entry);
				if (!outcome.ok) {
					if (outcome.reason !== '') {
						refusals.set(outcome.path, outcome.reason);
					}
					continue;
				}

				imported++;
				// An import that succeeded still has something to say when its
				// images did not all come with it. It has left the list by now,
				// so unlike a refusal it has no row left to say it on.
				if (attachmentReportMessage(outcome.attachments) !== null) {
					incomplete.push(outcome.path);
				}
			}

			this.discoverableDocuments.recordRefusals(refusals);

			// ORDINARY DURATION, deliberately, and this used to be 0 — a notice
			// that never went away until clicked. That was defensible while the
			// notice CARRIED the refusal reasons and was the only place to read
			// them; it stopped being so the moment those moved onto the rows,
			// where they stay put and outlive any notice. What is left here is
			// a count and a heads-up, neither of which the author acts on from
			// the notice itself, so it behaves like every other notice this
			// plugin shows.
			//
			// The exception that proves the rule is `offerRecovery` in
			// `submit-document.ts`, which is still 0: it holds a BUTTON, and
			// timing out would take an action away mid-reach.
			new Notice(importBatchMessage(imported, refusals.size, incomplete));

			// The documents that arrived without all their images have left the
			// list, so no row is left to carry this and the notice is the only
			// surface it had. Logged so it survives the notice rather than
			// being the one thing an author cannot look up again.
			if (incomplete.length > 0) {
				console.error(
					`Docs Publisher: imported with images missing — ${incomplete.join(', ')}`
				);
			}
		})();
	}

	/**
	 * One import, plus the bookkeeping both entry points share. Kept in one
	 * place so a single import and a batch cannot drift into doing different
	 * things — the same reason every other action here has one path.
	 */
	private async runImport(entry: DiscoverableDocument): Promise<ImportOutcome> {
		const ref = this.discoverableDocuments.ref;
		if (ref === null) {
			// Unreachable from the panel — a row only exists because a
			// resolution succeeded, and a success always records its ref. Here
			// because the alternative is defaulting to a ref nobody read, and
			// fetching a document's images from the wrong point in history is
			// the kind of wrong that looks right.
			return { ok: false, path: entry.path, reason: IMPORT_FAILED_MESSAGE };
		}

		const outcome = await importDocumentWrite(
			this.app,
			this.connection,
			this.connectionState.current,
			entry,
			{ ref, remotePaths: this.discoverableDocuments.paths }
		);
		if (outcome.ok) {
			this.discoverableDocuments.remove(outcome.path);
		}

		return outcome;
	}

	/**
	 * The one path to recovering an orphaned record. Reads the content for
	 * THAT record only, writes the note, and — only for a record recovered
	 * via the merge-request fallback, i.e. one with no stored path — backfills
	 * that path so a second accidental deletion of the same note recovers via
	 * the fast path next time (design.md's open question, resolved here per
	 * tasks.md 2.5: it costs nothing and the information is already in hand).
	 * Drops the row from the holder on success rather than waiting for the
	 * next refresh, since the note now exists locally.
	 */
	private recoverDocument(entry: Extract<OrphanedDocument, { recoverable: true }>): void {
		// Gated up front, before the content fetch below, purely to avoid a
		// wasted request when the button is stale — `recoverDocumentWrite`
		// itself gates again regardless, which is the actual enforcement
		// (hiding or disabling a control is never what enforces a gate).
		if (requireAuthoringGate(this.connection, this.connectionState.current) === null) {
			return;
		}

		void (async () => {
			const fetched = await fetchRecoveryContent(this.connection, entry);
			if (fetched.kind === 'failed') {
				new Notice(
					fetched.failure === 'insufficient-permission'
						? recoveryPermissionMessage(fetched.detail)
						: RECOVERY_REFRESH_FAILED_MESSAGE
				);
				return;
			}

			if (fetched.kind === 'absent') {
				new Notice(RECOVERY_UNAVAILABLE_MESSAGE);
				return;
			}

			const recovered = await recoverDocumentWrite(
				this.app,
				this.connection,
				this.connectionState.current,
				entry.path,
				fetched.content,
				// The ref the content actually came from, so the document's
				// images are fetched from the same point in history as its
				// text (milestone 9a).
				fetched.ref
			);
			if (!recovered) {
				return;
			}

			if (entry.record.path === undefined) {
				await this.submissions.save({ ...entry.record, path: entry.path });
			}

			this.recoverableDocuments.remove(entry.docId);
		})();
	}

	/**
	 * The one path to resetting a document: read what the document carries on
	 * its own tracked branch, then hand it to the write, which confirms
	 * before it replaces anything.
	 *
	 * There is no second entry point — no command palette entry, deliberately.
	 * A hotkey-bound destructive action on whatever note happens to be open
	 * is the misclick case the panel control is shaped to avoid, and the
	 * confirmation would be the only thing left guarding it.
	 *
	 * Nothing here writes a tracking record or touches the holder's resolved
	 * state: a reset changes what the note says, not where the review stands
	 * (design.md decision 5), so the panel's state labels are correct
	 * unchanged afterwards.
	 */
	private resetDocument(file: TFile, target: ResettableDocument): void {
		// Gated up front purely to avoid a wasted request when the control is
		// stale — `resetDocumentWrite` gates again regardless, which is the
		// actual enforcement, for the same reason `recoverDocument` does.
		if (requireAuthoringGate(this.connection, this.connectionState.current) === null) {
			return;
		}

		void (async () => {
			const fetched = await fetchResetContent(this.connection, target);
			if (fetched.kind === 'failed') {
				new Notice(
					fetched.failure === 'insufficient-permission'
						? resetPermissionMessage(fetched.detail)
						: RESET_READ_FAILED_MESSAGE
				);
				return;
			}

			// The review ended between the last refresh and this press. Refused
			// rather than fetched from anywhere else: the default branch holds
			// content from a different cycle, which is not what was asked for
			// and would be written over local work (design.md decision 1).
			if (fetched.kind === 'absent') {
				new Notice(RESET_UNAVAILABLE_MESSAGE);
				return;
			}

			await resetDocumentWrite(
				this.app,
				this.connection,
				this.connectionState.current,
				file,
				fetched.content
			);
		})();
	}

	private async activateView(): Promise<void> {
		// In-flight guard: prevent race condition where two rapid triggers
		// both pass the getLeavesOfType check before either awaits setViewState
		if (this.viewActivating) {
			return;
		}

		this.viewActivating = true;
		try {
			const { workspace } = this.app;

			// Check if a leaf of this view type already exists
			const leaves = workspace.getLeavesOfType(VIEW_TYPE);
			if (leaves.length > 0) {
				// View already exists, reveal it
				workspace.revealLeaf(leaves[0]);
				return;
			}

			// Get or create a right sidebar leaf
			const rightLeaf = workspace.getRightLeaf(false);
			if (rightLeaf === null) {
				console.error('Failed to create or get right sidebar leaf');
				return;
			}

			// Set the view state to our custom view type and reveal it
			await rightLeaf.setViewState({ type: VIEW_TYPE });
			workspace.revealLeaf(rightLeaf);
		} finally {
			this.viewActivating = false;
		}
	}
}

export { DocsPublisherPlugin as default };
