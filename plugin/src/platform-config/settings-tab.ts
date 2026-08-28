import { App, ButtonComponent, Plugin, PluginSettingTab, Setting } from 'obsidian';
import type { ConnectionDetails, FailureKind } from '../git-publishing/gitlab-client';
import { getCurrentUser, getProjectAccess } from '../git-publishing/gitlab-client';
import { hasConnectionDetails } from './connection';
import type { ConnectionState, ConnectionStateHolder } from './connection-state';

/** All the settings tab needs from the plugin: the details, and the outcome. */
export interface ConnectionHolder {
	readonly connection: ConnectionDetails;
	readonly connectionState: ConnectionStateHolder;
}

const CHECKING_MESSAGE = 'Checking…';
const EMPTY_FIELDS_MESSAGE = 'Fill in all three fields before testing the connection.';

const FAILURE_MESSAGES: Record<FailureKind, string> = {
	'rejected-credential': 'Your access has expired or is incorrect. Please ask your admin to set it up again.',
	'not-reachable':
		'That project could not be found, or your access does not include it. Check the project ID above.',
	'server-unreachable':
		'Could not reach GitLab at that address. Check the address above and your connection, then try again.',
	// Unreachable from "Test connection" itself — this check only reads, and
	// insufficient-permission is produced solely by git-publishing's write
	// methods. Present for the table's exhaustiveness, not for display here.
	'insufficient-permission': "Your access token doesn't have permission to do that. Ask your admin to add it.",
	'unexpected': 'The connection check did not succeed. Check the details above and try again.',
};

class ConnectionSettingTab extends PluginSettingTab {
	private readonly holder: ConnectionHolder;
	private statusEl: HTMLElement | null = null;
	private testButton: ButtonComponent | null = null;
	private unsubscribe: (() => void) | null = null;

	constructor(app: App, plugin: Plugin & ConnectionHolder) {
		super(app, plugin);
		this.holder = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// No section heading: the settings sidebar already names this tab, and a
		// heading row here would carry a full setting-item's padding for one
		// line of text.
		containerEl.createEl('p', {
			text:
				'These details are kept for this Obsidian session only. Nothing is written to disk, ' +
				'so you enter them again after a restart.',
			cls: 'setting-item-description',
		});

		new Setting(containerEl)
			.setName('GitLab address')
			.setDesc('The address of your GitLab server, for example https://gitlab.example.com.')
			.addText((text) =>
				text
					.setPlaceholder('https://gitlab.example.com')
					.setValue(this.holder.connection.host)
					.onChange((value) => {
						this.holder.connection.host = value;
						this.discardResult();
					})
			);

		new Setting(containerEl)
			.setName('Project ID')
			.setDesc(
				'The numeric ID of the project, shown on its overview page in GitLab. ' +
					'A namespace path like my-group/my-docs also works.'
			)
			.addText((text) =>
				text
					.setPlaceholder('12345678')
					.setValue(this.holder.connection.projectId)
					.onChange((value) => {
						this.holder.connection.projectId = value;
						this.discardResult();
					})
			);

		new Setting(containerEl)
			.setName('Access token')
			.setDesc(
				'Create a fine-grained access token in GitLab, under User settings → Access tokens. ' +
					'The exact permissions it needs are assigned by your admin.'
			)
			.addText((text) => {
				text.inputEl.type = 'password';
				text
					.setPlaceholder('Paste your token')
					.setValue(this.holder.connection.token)
					.onChange((value) => {
						this.holder.connection.token = value;
						this.discardResult();
					});
			});

		new Setting(containerEl)
			.setName('Test connection')
			.setDesc('Checks the details above and reports who the plugin connected as.')
			.addButton((button) => {
				this.testButton = button;
				button.setButtonText('Test connection').onClick(() => {
					void this.testConnection();
				});
			});

		this.statusEl = containerEl.createDiv({ cls: 'setting-item-description' });

		// The tab renders the retained result rather than one it keeps privately,
		// so reopening it mid-check needs no reconstruction: the shared state
		// already says the check is running.
		this.render(this.holder.connectionState.current);
		this.unsubscribe = this.holder.connectionState.onChange((state) => {
			this.render(state);
		});
	}

	hide(): void {
		if (this.unsubscribe !== null) {
			this.unsubscribe();
			this.unsubscribe = null;
		}
	}

	/**
	 * Reads identity, then the author's access on the configured project. Kept
	 * sequential so each failure is attributed to the right thing: a rejected
	 * token surfaces from the identity read, an unreachable project from the
	 * project read.
	 *
	 * Publishes each step into the shared state rather than rendering it here,
	 * so every surface showing the connection follows along.
	 */
	private async testConnection(): Promise<void> {
		const state = this.holder.connectionState;
		if (state.current.kind === 'checking') {
			return;
		}

		const details = this.holder.connection;
		if (!hasConnectionDetails(details)) {
			this.setStatus(EMPTY_FIELDS_MESSAGE);
			return;
		}

		state.set({ kind: 'checking' });
		try {
			const identity = await getCurrentUser(details);
			if (!identity.ok) {
				state.set({ kind: 'failed', failure: identity.failure, identity: null });
				return;
			}

			const access = await getProjectAccess(details);
			if (!access.ok) {
				state.set({ kind: 'failed', failure: access.failure, identity: identity.value });
				return;
			}

			state.set({ kind: 'verified', identity: identity.value, access: access.value });
		} catch {
			state.set({ kind: 'failed', failure: 'unexpected', identity: null });
		}
	}

	/**
	 * Editing any of the three values discards the retained result, so a
	 * verified person is never reported alongside details they were not
	 * verified against. Deliberately does not start a new check.
	 */
	private discardResult(): void {
		this.holder.connectionState.set({ kind: 'unverified' });
	}

	private render(state: ConnectionState): void {
		if (this.testButton !== null) {
			this.testButton.setDisabled(state.kind === 'checking');
		}
		this.setStatus(this.statusText(state));
	}

	private statusText(state: ConnectionState): string {
		switch (state.kind) {
			case 'unverified':
				return '';
			case 'checking':
				return CHECKING_MESSAGE;
			case 'verified':
				return `Connected as ${state.identity.name} — ${state.access.accessLabel} access`;
			case 'failed':
				return FAILURE_MESSAGES[state.failure];
		}
	}

	private setStatus(text: string): void {
		if (this.statusEl !== null) {
			this.statusEl.setText(text);
		}
	}
}

export { ConnectionSettingTab };
