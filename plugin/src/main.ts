import { Plugin, ButtonComponent, ItemView, WorkspaceLeaf } from 'obsidian';
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
import { resolveSubmissionRecord } from './submission-tracking/resolve';
import type { SubmissionRecord } from './submission-tracking/submission-record';
import { SUBMISSION_STATE_LABELS } from './submission-tracking/submission-record';
import { SubmissionStore } from './submission-tracking/submission-store';

const VIEW_TYPE = 'docs-publisher-view';

const OPEN_SETTINGS_LABEL = 'Open settings';
const NEW_DOCUMENT_LABEL = 'New Document';
const SUBMIT_FOR_REVIEW_LABEL = 'Submit for review';

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
	'unexpected': 'The connection check did not succeed. Check your details in settings and try again.',
};

class DocsPublisherView extends ItemView {
	private readonly state: ConnectionStateHolder;
	private readonly pluginId: string;
	private readonly newDocument: () => void;
	private readonly submitForReview: () => void;
	private readonly resolveSubmission: (file: TFile) => SubmissionRecord | null;
	// The pending `setTimeout` id for a scheduled-but-not-yet-run render, or
	// null when none is pending. See `scheduleRender`.
	private renderTimer: number | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		state: ConnectionStateHolder,
		pluginId: string,
		newDocument: () => void,
		submitForReview: () => void,
		resolveSubmission: (file: TFile) => SubmissionRecord | null
	) {
		super(leaf);
		this.state = state;
		this.pluginId = pluginId;
		// Handed in rather than built here, so the control and the command
		// palette entry are literally the same path and cannot drift apart.
		this.newDocument = newDocument;
		this.submitForReview = submitForReview;
		this.resolveSubmission = resolveSubmission;
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

		this.render();
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
				return;
			}

			if (grantsReadOnly(state)) {
				container.createEl('p', { text: readOnlyMessage(state.access.accessLabel) });
				this.addSettingsButton(container);
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
	 * Only for the currently open, unsubmitted document — per the "New
	 * Document" section above, this whole branch already requires Developer
	 * access. Shows nothing when no markdown note is open: submitting is an
	 * action on the active note, not a standing panel feature.
	 *
	 * `state` is this milestone's only reachable one, so the label rendered
	 * here always reads "Waiting for review" — later milestones' states
	 * (published, changes-requested, closed) are reachable only once
	 * milestone 5's reconciliation call exists to ever move a record off
	 * `pending`; nothing here transitions it on its own.
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
			return;
		}

		// CTA: once ready, this is the action the panel most wants pressed —
		// matches the modal's own Submit button.
		new ButtonComponent(actionsContainer)
			.setButtonText(SUBMIT_FOR_REVIEW_LABEL)
			.setCta()
			.onClick(() => {
				this.submitForReview();
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
					() => {
						this.newDocument();
					},
					() => {
						this.submitForReview();
					},
					(file) => resolveSubmissionRecord(this.app, this.submissions, file)
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
