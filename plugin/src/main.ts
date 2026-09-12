import { Notice, Plugin, ButtonComponent, ItemView, WorkspaceLeaf } from 'obsidian';
import type { TFile } from 'obsidian';
import type { ConnectionDetails, FailureKind } from './git-publishing/gitlab-client';
import { createEmptyConnectionDetails } from './platform-config/connection';
import { createDocument } from './doc-authoring/create-document';
// Aliased: the plugin also has a same-named private method for the two entry
// points to call. Distinct names here keep that call site from reading like
// (and risking becoming) an accidental self-recursion.
import { submitForReview as submitDocumentForReview } from './doc-authoring/submit-document';
import { NO_DOCUMENT_ACCESS_MESSAGE, readOnlyMessage } from './platform-config/access-messages';
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
import type { OrphanedDocument } from './submission-tracking/recover';
import {
	RecoveryHolder,
	fetchRecoveryContent,
	refreshRecoverableDocuments as refreshRemoteRecoverableDocuments,
} from './submission-tracking/recover';
import { resolveSubmissionRecord } from './submission-tracking/resolve';
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
const DOCUMENTS_HEADING = 'Your documents';
const NO_DOCUMENTS_MESSAGE = 'Nothing submitted yet. Documents you submit will be listed here.';
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
		recoverDocument: (entry: Extract<OrphanedDocument, { recoverable: true }>) => void
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
	}

	/**
	 * The author's documents and where each one stands.
	 *
	 * Renders from the resolved states the holder already has and makes no
	 * remote call of its own — this runs on every note switch and every front
	 * matter edit. The only things that reach the remote are the Refresh
	 * control below and the view opening.
	 */
	private renderDocumentList(container: HTMLElement): void {
		const section = container.createDiv({ cls: 'docs-publisher-documents' });
		const header = section.createDiv({ cls: 'docs-publisher-documents-header' });
		header.createEl('h4', { text: DOCUMENTS_HEADING });

		const outcome = this.statuses.lastOutcome;
		const refresh = new ButtonComponent(header).setButtonText(REFRESH_LABEL).onClick(() => {
			this.refreshStatuses();
		});
		if (outcome.kind === 'refreshing') {
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
		const documents = listVaultDocuments(this.app);
		if (documents.length === 0) {
			section.createEl('p', { text: NO_DOCUMENTS_MESSAGE, cls: 'setting-item-description' });
			return;
		}

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
	 * normal render pass (tasks.md 4.3). Absent entirely when there is
	 * nothing to recover — plugin-shell spec's "Nothing to recover" scenario
	 * — rather than shown with a competing empty-state message.
	 */
	private renderRecoverySection(container: HTMLElement): void {
		const documents = this.recoverable.current;
		if (documents.length === 0) {
			return;
		}

		const section = container.createDiv({ cls: 'docs-publisher-documents' });
		section.createEl('h4', { text: RECOVERABLE_DOCUMENTS_HEADING });

		const outcome = this.recoverable.lastOutcome;
		if (outcome.kind === 'failed') {
			section.createEl('p', {
				text:
					outcome.failure === 'insufficient-permission'
						? recoveryPermissionMessage(outcome.detail)
						: RECOVERY_REFRESH_FAILED_MESSAGE,
				cls: 'setting-item-description',
			});
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
				text: RECOVERY_UNAVAILABLE_MESSAGE,
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

	private viewActivating = false;

	async onload(): Promise<void> {
		console.log('Loading Docs Publisher plugin');

		await this.submissions.load();

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
				fetched.content
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
