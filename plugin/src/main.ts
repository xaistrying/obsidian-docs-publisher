import { Plugin, ButtonComponent, ItemView, WorkspaceLeaf } from 'obsidian';
import type { ConnectionDetails, FailureKind } from './git-publishing/gitlab-client';
import { createEmptyConnectionDetails } from './platform-config/connection';
import type { ConnectionState } from './platform-config/connection-state';
import { ConnectionStateHolder, grantsDocumentAccess } from './platform-config/connection-state';
import { openSettingsTab } from './platform-config/open-settings';
import { ConnectionSettingTab } from './platform-config/settings-tab';

const VIEW_TYPE = 'docs-publisher-view';

const OPEN_SETTINGS_LABEL = 'Open settings';

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
	'unexpected': 'The connection check did not succeed. Check your details in settings and try again.',
};

class DocsPublisherView extends ItemView {
	private readonly state: ConnectionStateHolder;
	private readonly pluginId: string;

	constructor(leaf: WorkspaceLeaf, state: ConnectionStateHolder, pluginId: string) {
		super(leaf);
		this.state = state;
		this.pluginId = pluginId;
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
				this.render();
			})
		);
		this.render();
	}

	async onClose(): Promise<void> {
		// Nothing to do: the subscription is unregistered by the component
		// lifecycle above.
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

		if (grantsDocumentAccess(state)) {
			container.createEl('p', { text: 'Ready to publish your documentation.' });
			return;
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

		return (
			"Your GitLab account does not have access to this project's documents. " +
			'Ask your admin for access.'
		);
	}

	private addSettingsButton(container: HTMLElement): void {
		new ButtonComponent(container).setButtonText(OPEN_SETTINGS_LABEL).onClick(() => {
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

	private viewActivating = false;

	async onload(): Promise<void> {
		console.log('Loading Docs Publisher plugin');

		// Register the custom view
		this.registerView(
			VIEW_TYPE,
			(leaf: WorkspaceLeaf) => new DocsPublisherView(leaf, this.connectionState, this.manifest.id)
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
	}

	onunload(): void {
		console.log('Unloading Docs Publisher plugin');
		// Note: We deliberately do NOT call detachLeavesOfType here.
		// Detaching would destroy the user's layout every time the plugin updates.
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
