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
	effectiveState,
	hasLocalEdits,
	inAnotherProject,
	listVaultDocuments,
	panelSection,
	refreshDocumentStatuses as refreshRemoteDocumentStatuses,
} from './submission-tracking/document-status';
import { requireAuthoringGate } from './doc-authoring/authoring-gate';
import {
	RESET_LABEL,
	RESTORE_LABEL,
	RESET_READ_FAILED_MESSAGE,
	RESET_UNAVAILABLE_MESSAGE,
	restoreDocument,
} from './doc-authoring/reset-document';
import { attachmentReportMessage } from './doc-authoring/fetch-attachments';
import {
	IMPORT_ALL_LABEL,
	IMPORT_FAILED_MESSAGE,
	importDocument as importDocumentWrite,
} from './doc-authoring/import-document';
import type { ImportOutcome } from './doc-authoring/import-document';
import type { DiscoverableDocument } from './submission-tracking/discover';
import {
	DiscoveryHolder,
	refreshDiscoverableDocuments as refreshRemoteDiscoverableDocuments,
} from './submission-tracking/discover';
import type { ResettableDocument } from './submission-tracking/reset';
import { fetchResetContent, resettableDocument, restorableDocuments } from './submission-tracking/reset';
import { branchForDocId, readDocId, resolveSubmissionRecord } from './submission-tracking/resolve';
import type { ProjectRef, SubmissionRecord, SubmissionState } from './submission-tracking/submission-record';
import {
	IN_ANOTHER_PROJECT_LABEL,
	SUBMISSION_STATE_LABELS,
	UNSUBMITTED_LABEL,
	configuredProject,
} from './submission-tracking/submission-record';
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
/**
 * Named for the rule rather than the owner (name-panel-sections-by-next-actor).
 * It was "Your documents", which reads as ALL of them, so a submitted document
 * missing from it read as a failed submit rather than as the rule working.
 */
const DOCUMENTS_HEADING = 'Needs you';

/**
 * What each of the two lists is FOR, beside its heading. The headings name
 * the rule, but only to someone who already knows it: on 2026-09-27 the
 * author read "Needs you" and could not say why a row was in it. Shown
 * whether or not the list has rows, for the reason the restore section's
 * description gives — empty is exactly when a reader asks what a list means.
 * Vocabulary-checked: no "branch", "commit", "merge request", "MR",
 * "conflict", or "main".
 */
const DOCUMENTS_DESCRIPTION =
	'Documents waiting on you: not sent yet, sent back by a reviewer, or changed since you last sent them.';
const WAITING_DOCUMENTS_DESCRIPTION = 'Sent and unchanged. Nothing to do until a reviewer responds.';
const NO_DOCUMENTS_MESSAGE = 'Nothing submitted yet. Documents you submit will be listed here.';

/**
 * "Needs you"'s OTHER empty state, for a vault with tracked documents none of
 * which the author owes anything on. The message above would be a lie there —
 * something has been submitted — and the documents are either under review,
 * listed in the section below, or published and untouched, which the panel
 * deliberately does not list: a read-only roll-call of everything ever
 * published was the one section here that could not be acted on (2026-09-22).
 */
const NO_OWED_DOCUMENTS_MESSAGE = 'Nothing needs you right now.';

/**
 * The second list: documents under review with no unsent edits, where the next
 * move is a reviewer's. It exists so a submit MOVES a document rather than
 * removing it from view; the heading's count going up is the confirmation.
 * Collapsed by default so the author's own work stays the focal list.
 */
const WAITING_DOCUMENTS_HEADING = 'Waiting on reviewers';
const NO_WAITING_DOCUMENTS_MESSAGE = 'Nothing is waiting for review right now.';

/**
 * Why a document with a perfectly good remote state is in the main list
 * anyway. Shown BESIDE the state label, never instead of it — so it is short
 * enough to share a sidebar row with "Changes requested" and still be one
 * unclipped marker (fix-edited-baseline tasks.md 3.2). It replaced
 * "Edited — not sent yet", which was written to be the row's only label.
 * Vocabulary-checked like every other author-facing string: no "branch",
 * "commit", "merge request", "MR", "conflict", or "main".
 */
const EDITED_LABEL = 'Unsent edits';
const OPEN_ON_PLATFORM_LABEL = 'Open in GitLab';

/**
 * add-document-recovery: the second list, for a stored record whose note is
 * gone from the vault. Absent entirely rather than shown empty — the
 * "Nothing to recover" scenario in plugin-shell's spec — so it never
 * competes with the main list for attention on the common case of nothing
 * to recover.
 */
const RESTORABLE_DOCUMENTS_HEADING = 'Documents you can restore';

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
 * "Needs you" and "Waiting on reviewers" need no "not checked yet" case, and
 * the difference is principled rather than an inconsistency: they partition
 * documents ALREADY IN THE VAULT, so their emptiness is a local fact that is
 * never in doubt. There is no unasked question for it to be confused with.
 */
const NO_RESTORABLE_MESSAGE = 'Nothing to restore.';

/**
 * What this section is FOR, which the heading alone does not carry: its one
 * case is a note deleted while its document was still in review, whose
 * content therefore exists nowhere this vault can reach on its own.
 *
 * Shown whether or not the list has rows, unlike the import description
 * beside it. This section is empty almost always — every row leaves on its
 * own as soon as the review ends — and empty is precisely when a reader asks
 * what it means. "Nothing to restore" answers a question they have not been
 * given yet.
 *
 * Vocabulary-checked: no "branch", "commit", "merge request", "MR",
 * "conflict", or "main". Phrased to match the import line's rhythm, since
 * the two sit one under the other.
 */
const RESTORABLE_DOCUMENTS_DESCRIPTION =
	'Documents still in review that this vault no longer has a note for.';
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

/** Keys for the sections whose collapsed state the view remembers. */
const WAITING_SECTION_KEY = 'waiting';
const RESTORE_SECTION_KEY = 'restore';
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
function sectionSuffix(outcome: RefreshOutcomeKind | undefined, count: number): string {
	if (outcome === 'failed') {
		return SECTION_FAILED_SUFFIX;
	}

	// Otherwise the count, ALWAYS — including before a remote-backed list has
	// been read, where it is zero because zero rows are shown. The count
	// describes the list on screen and nothing more; whether the remote has
	// been asked is what the line under the heading says, and a heading that
	// silently dropped its number to avoid implying an answer just read as a
	// missing number instead (2026-09-22, at the author's request).
	//
	// A refresh in flight keeps the last count rather than blanking it: the
	// holder still holds those rows, so they are still what is on screen.
	return String(count);
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
/**
 * The connection check's refused-for-a-permission variant, for the panel.
 *
 * Reachable as of 2026-09-29: the identity read is now classified as scoped,
 * so a token missing `User: Read` is reported as the missing permission it is
 * rather than as a project that could not be found
 * (`docs/ce-verification.md` §D0g). Points at settings rather than at a
 * project ID, like every other message on this surface.
 */
function connectionPermissionMessage(detail: string | undefined): string {
	const missing = detail === undefined ? '' : ` (missing: ${detail})`;
	return (
		`Your access token doesn't have permission to check your connection${missing}. ` +
		'Ask your admin to add it, then check your details in settings.'
	);
}

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
	private readonly restorable: () => ResettableDocument[];
	private readonly restoreDocument: (target: ResettableDocument) => void;
	private readonly resetDocument: (file: TFile, target: ResettableDocument) => void;
	private readonly discoverable: DiscoveryHolder;
	private readonly importAllDocuments: () => void;
	private readonly onSubmissionsChange: (listener: () => void) => () => void;
	/**
	 * Which collapsible sections the author has collapsed, by key.
	 *
	 * On the VIEW and nowhere else, which makes it last the session and no
	 * longer. It cannot live in the DOM — `render` empties `contentEl` and
	 * rebuilds it on every note switch — and it deliberately does not go to
	 * `data.json`, which is documented as a cache of what the remote said
	 * rather than a place for this surface's preferences.
	 *
	 * Seeded with "Waiting on reviewers", which opens collapsed: its count is
	 * the feedback it exists for, and its rows would compete with "Needs you".
	 */
	private readonly collapsed = new Set<string>([WAITING_SECTION_KEY]);
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
		restorable: () => ResettableDocument[],
		restoreDocument: (target: ResettableDocument) => void,
		resetDocument: (file: TFile, target: ResettableDocument) => void,
		discoverable: DiscoveryHolder,
		importAllDocuments: () => void,
		onSubmissionsChange: (listener: () => void) => () => void
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
		this.restorable = restorable;
		this.restoreDocument = restoreDocument;
		this.resetDocument = resetDocument;
		this.onSubmissionsChange = onSubmissionsChange;
		this.discoverable = discoverable;
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


		// And again for the discoverable set (add-discover-and-import). Same
		// rule as the two above: this subscription redraws from a cache and
		// never reaches the remote.
		this.register(
			this.discoverable.onChange(() => {
				this.scheduleRender();
			})
		);

		// And for stored records, which decide a row's section as much as the
		// remote does: a submit's new edit baseline is the only thing that
		// moves the document back to "Waiting on reviewers", and Send update
		// touches no note to trigger a render of its own. Local, like the rest.
		this.register(
			this.onSubmissionsChange(() => {
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

	/** What a stored record must belong to for any surface to act on it. */
	private configuredProject(): ProjectRef | null {
		return configuredProject(this.details, this.state.current);
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
				this.renderRestoreSection(container);
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
			// Named where GitLab named it, for the same reason the refresh and
			// discovery messages do — see `connectionPermissionMessage` in the
			// settings tab and `docs/ce-verification.md` §D0g.
			return state.failure === 'insufficient-permission'
				? connectionPermissionMessage(state.detail)
				: PANEL_FAILURE_MESSAGES[state.failure];
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

		// The SAME answer the row gives, not the record read directly: a record
		// from another project once labelled this button "Send update" while
		// the row said nothing (`docs/ce-verification.md` §D0h). No state means
		// a first submission, which the author can still genuinely make here.
		const docId = readDocId(this.app, file);
		const status = docId === null ? null : this.statuses.statusFor(docId);
		const record = this.resolveSubmission(file) ?? undefined;
		const project = this.configuredProject();
		const state = docId === null ? undefined : effectiveState(status, record, project);
		const text =
			state !== undefined
				? SUBMISSION_STATE_LABELS[state]
				: inAnotherProject(status, record, project)
					? IN_ANOTHER_PROJECT_LABEL
					: null;
		if (text !== null) {
			statusContainer.createEl('p', { text, cls: 'setting-item-description' });
		}

		// One entry point for all five cases, tracked or not: the same method
		// the command palette calls, which resolves what the document actually
		// needs itself. The button chooses only what it is CALLED, never what it
		// does — a panel that decided the action separately would be a second
		// place for the four-way fork to live, and the two would drift.
		new ButtonComponent(actionsContainer)
			.setButtonText(state === undefined ? SUBMIT_FOR_REVIEW_LABEL : RESUBMIT_LABELS[state])
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
	 * The author's documents and where each one stands, across two sections
	 * named for who acts next — "Needs you" and "Waiting on reviewers".
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
		params: { key: string; text: string; count: number; outcome?: RefreshOutcomeKind }
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

		toggle.createSpan({
			cls: 'docs-publisher-section-count',
			text: sectionSuffix(params.outcome, params.count),
		});

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

		// Built from the vault, not from stored records — design.md decision 6.
		const { needsYou, waiting, unlisted } = this.partitionDocuments(listVaultDocuments(this.app));

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

		section.createEl('p', { text: DOCUMENTS_DESCRIPTION, cls: 'setting-item-description' });

		if (outcome.kind === 'failed') {
			section.createEl('p', {
				text:
					outcome.failure === 'insufficient-permission'
						? refreshPermissionMessage(outcome.detail)
						: REFRESH_FAILED_MESSAGE,
				cls: 'setting-item-description',
			});
		}

		if (needsYou.length === 0) {
			section.createEl('p', {
				text: waiting.length + unlisted.length === 0 ? NO_DOCUMENTS_MESSAGE : NO_OWED_DOCUMENTS_MESSAGE,
				cls: 'setting-item-description',
			});
		} else {
			const list = section.createEl('ul', { cls: 'docs-publisher-document-list' });
			for (const entry of needsYou) {
				this.renderDocumentRow(list, entry);
			}
		}

		this.renderWaitingSection(container, waiting, outcome.kind);
	}

	/**
	 * "Waiting on reviewers" — present even at zero, like every other
	 * collapsible section, and reporting "(check failed)" the way they do, so
	 * collapsing it hides the list and never which case applies.
	 */
	private renderWaitingSection(
		container: HTMLElement,
		documents: readonly VaultDocument[],
		outcome: RefreshOutcomeKind
	): void {
		const section = container.createDiv({ cls: 'docs-publisher-documents' });
		const header = section.createDiv({ cls: 'docs-publisher-documents-header' });
		const expanded = this.renderCollapsibleHeader(header, {
			key: WAITING_SECTION_KEY,
			text: WAITING_DOCUMENTS_HEADING,
			count: documents.length,
			outcome,
		});
		if (!expanded) {
			return;
		}

		section.createEl('p', { text: WAITING_DOCUMENTS_DESCRIPTION, cls: 'setting-item-description' });

		if (documents.length === 0) {
			section.createEl('p', { text: NO_WAITING_DOCUMENTS_MESSAGE, cls: 'setting-item-description' });
			return;
		}

		const list = section.createEl('ul', { cls: 'docs-publisher-document-list' });
		for (const entry of documents) {
			this.renderDocumentRow(list, entry);
		}
	}

	/**
	 * Splits tracked documents by who acts next, by way of `panelSection`:
	 * "Needs you", "Waiting on reviewers", and the unlisted rest (published and
	 * untouched), which is kept only to choose "Needs you"'s empty state.
	 *
	 * The case that matters is the unresolved one: a document nothing has
	 * resolved yet (`statusFor` returns null, the first-refresh-failed case)
	 * stays in "Needs you", because moving it would assert a review or a
	 * settled state nothing established — precisely the silent wrongness this
	 * panel's whole status mechanism exists to prevent.
	 */
	private partitionDocuments(documents: readonly VaultDocument[]): {
		needsYou: VaultDocument[];
		waiting: VaultDocument[];
		unlisted: VaultDocument[];
	} {
		const needsYou: VaultDocument[] = [];
		const waiting: VaultDocument[] = [];
		const unlisted: VaultDocument[] = [];
		const project = this.configuredProject();

		for (const entry of documents) {
			const stored = this.resolveSubmission(entry.file) ?? undefined;
			// The stored state is the fallback, not a second opinion: the
			// remote wins whenever it has one. It is consulted only where the
			// remote HAS no answer — an imported document, which is on the
			// default branch but has no merge request, and which without this
			// reads as "never submitted" and lands in the list of work owed.
			// Only a record belonging to this project — see `effectiveState`.
			const state = effectiveState(this.statuses.statusFor(entry.docId), stored, project) ?? null;
			const edited = hasLocalEdits(entry.file, stored);
			const section = panelSection(state, edited);
			(section === 'needs-you' ? needsYou : section === 'waiting-on-reviewers' ? waiting : unlisted).push(entry);
		}

		return { needsYou, waiting, unlisted };
	}


	/**
	 * One document: its name, its state's label, whether it has unsent edits,
	 * and a way out to the platform.
	 *
	 * A document nothing has resolved yet shows its name and NO state label.
	 * That is the first-refresh-failed case, and inventing a state for it —
	 * even "Waiting for review", which would be right most of the time — is
	 * exactly the silent wrongness this whole milestone exists to remove. Its
	 * edited marker still shows: that is read from the note, not the remote.
	 */
	private renderDocumentRow(list: HTMLElement, entry: VaultDocument): void {
		const row = list.createEl('li', { cls: 'docs-publisher-document' });
		row.createSpan({ cls: 'docs-publisher-document-name', text: entry.file.basename });

		const stored = this.resolveSubmission(entry.file) ?? undefined;
		const edited = hasLocalEdits(entry.file, stored);
		const status = this.statuses.statusFor(entry.docId);
		// One unit for the state and the marker, so a narrow panel moves them
		// together rather than wrapping the marker onto the link's line
		// (observed 2026-09-27, tasks.md 3.3).
		const labels = row.createSpan({ cls: 'docs-publisher-document-labels' });
		if (status !== null) {
			// Same fallback as the partition, and for the same reason: an
			// imported document has no merge request for the remote to report,
			// so the store is the only thing that knows it is published. Without
			// this it reads "Not submitted yet" while sitting on the default
			// branch.
			const project = this.configuredProject();
			const state = effectiveState(status, stored, project);
			// A record the fallback refused is never "Not submitted yet". One
			// naming another project says so; one never matched gets no label,
			// since nothing established where it belongs
			// (scope-records-to-their-project).
			const text =
				state !== undefined
					? SUBMISSION_STATE_LABELS[state]
					: stored === undefined
						? UNSUBMITTED_LABEL
						: inAnotherProject(status, stored, project)
							? IN_ANOTHER_PROJECT_LABEL
							: null;
			if (text !== null) {
				labels.createSpan({ cls: 'docs-publisher-document-state', text });
			}
		}

		// ALONGSIDE the state, never instead of it (fix-edited-baseline design.md
		// decision 4). It once replaced the state on the reasoning that edited
		// was rare; it was on every row, so no row could say where it stood.
		// The state is where the review is; this is that local work has not
		// reached it. Either alone is half the sentence.
		if (edited) {
			labels.createSpan({
				cls: 'docs-publisher-document-state docs-publisher-document-edited',
				text: EDITED_LABEL,
			});
		}

		if (status === null || status.submission === null) {
			return;
		}

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
	 * "Documents you can restore" — every tracked document whose note is no
	 * longer in this vault.
	 *
	 * BUILT ENTIRELY FROM LOCAL DATA (2026-09-22): stored records minus the
	 * vault's own `doc_id`s. It replaced a list that needed one request per
	 * record just to decide which rows could be offered, and which therefore
	 * carried its own holder, its own refresh call, its own failure states and
	 * its own "not checked yet" empty case through this file. None of that is
	 * needed to answer a question about data already in memory.
	 *
	 * Published documents are deliberately absent: their file is on the
	 * default branch and this vault has no note at its path, which is
	 * precisely what "Documents you can import" below lists. One surface per
	 * question.
	 */
	private renderRestoreSection(container: HTMLElement): void {
		const documents = this.restorable();

		const section = container.createDiv({ cls: 'docs-publisher-documents' });
		const header = section.createDiv({ cls: 'docs-publisher-documents-header' });
		const expanded = this.renderCollapsibleHeader(header, {
			key: RESTORE_SECTION_KEY,
			text: RESTORABLE_DOCUMENTS_HEADING,
			count: documents.length,
		});
		if (!expanded) {
			return;
		}

		section.createEl('p', {
			text: RESTORABLE_DOCUMENTS_DESCRIPTION,
			cls: 'setting-item-description',
		});

		if (documents.length === 0) {
			section.createEl('p', { text: NO_RESTORABLE_MESSAGE, cls: 'setting-item-description' });
			return;
		}

		const list = section.createEl('ul', { cls: 'docs-publisher-document-list' });
		for (const entry of documents) {
			const row = list.createEl('li', { cls: 'docs-publisher-document' });
			// The `doc_id` is the only name left for it — there is no note to
			// read a filename from.
			row.createSpan({ cls: 'docs-publisher-document-name', text: entry.docId });
			new ButtonComponent(row).setButtonText(RESTORE_LABEL).onClick(() => {
				this.restoreDocument(entry);
			});
		}
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
		// BELOW the heading rather than beside it, unlike Refresh on "Needs
		// you" above. That heading is two short words and leaves room;
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
					() =>
						restorableDocuments(
							this.submissions,
							new Set(listVaultDocuments(this.app).map((d) => d.docId)),
							configuredProject(this.connection, this.connectionState.current)
						),
					(target) => {
						this.restoreDocument(target);
					},
					(file, target) => {
						this.resetDocument(file, target);
					},
					this.discoverableDocuments,
					() => {
						this.importAllDocuments();
					},
					(listener) => this.submissions.onChange(listener)
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
		void (async () => {
			await refreshRemoteDocumentStatuses(
				this.app,
				this.connection,
				this.connectionState.current,
				this.submissions,
				this.documentStatuses
			);
			// And the third question, on the same two triggers and kept separate
			// for the same reason: "what does the remote have that this vault has
			// no trace of" is asked of documents neither of the other two knows
			// about (add-discover-and-import).
			//
			// AFTER reconciliation, not beside it. Discover excludes whatever
			// Restore offers, read from the records reconciliation corrects — run
			// together, it read them first, and a merged document whose note was
			// deleted stayed hidden from import until a second Refresh
			// (correct-stale-records).
			await refreshRemoteDiscoverableDocuments(
				this.app,
				this.connection,
				this.connectionState.current,
				this.submissions,
				this.discoverableDocuments
			);
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
			{ ref, remotePaths: this.discoverableDocuments.paths },
			this.submissions
		);
		if (outcome.ok) {
			this.discoverableDocuments.remove(outcome.path);
		}

		return outcome;
	}

	/**
	 * The one path to restoring a lost note: read what the document carries
	 * on its own branch, then hand it to the write — the SAME write Reset
	 * uses, which creates when the note is absent and confirms when it is
	 * not.
	 */
	private restoreDocument(target: ResettableDocument): void {
		// Gated up front purely to avoid a wasted request when the button is
		// stale; `restoreDocument` gates again regardless, which is the actual
		// enforcement (hiding or disabling a control is never what enforces a
		// gate).
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

			if (fetched.kind === 'absent') {
				new Notice(RESET_UNAVAILABLE_MESSAGE);
				return;
			}

			await restoreDocument(
				this.app,
				this.connection,
				this.connectionState.current,
				this.submissions,
				target.docId,
				fetched.path,
				fetched.content,
				// The ref the content came from, so the document's images are
				// fetched from the same point in history as its text.
				branchForDocId(target.docId)
			);
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
	 * Nothing here changes a document's state, branch or path, or touches the
	 * holder's resolved state: a reset changes what the note says, not where
	 * the review stands (design.md decision 5), so the panel's state labels are
	 * correct unchanged afterwards. Only the note's edit baseline is refreshed,
	 * inside the write.
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

			await restoreDocument(
				this.app,
				this.connection,
				this.connectionState.current,
				this.submissions,
				target.docId,
				file.path,
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
