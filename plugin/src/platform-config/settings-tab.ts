import { App, ButtonComponent, Plugin, PluginSettingTab, Setting } from 'obsidian';
import type { ConnectionDetails, FailureKind } from '../git-publishing/gitlab-client';
import { getCurrentUser, getProjectAccess } from '../git-publishing/gitlab-client';
import { hasConnectionDetails } from './connection';

/** All the settings tab needs from the plugin: somewhere to keep the details. */
export interface ConnectionHolder {
	readonly connection: ConnectionDetails;
}

const CHECKING_MESSAGE = 'Checking…';
const EMPTY_FIELDS_MESSAGE = 'Fill in all three fields before testing the connection.';

const FAILURE_MESSAGES: Record<FailureKind, string> = {
	'rejected-credential': 'Your access has expired or is incorrect. Please ask your admin to set it up again.',
	'not-reachable':
		'That project could not be found, or your access does not include it. Check the project ID above.',
	'server-unreachable':
		'Could not reach GitLab at that address. Check the address above and your connection, then try again.',
	'unexpected': 'The connection check did not succeed. Check the details above and try again.',
};

class ConnectionSettingTab extends PluginSettingTab {
	private readonly holder: ConnectionHolder;
	private statusEl: HTMLElement | null = null;
	private testButton: ButtonComponent | null = null;
	private checking = false;

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

		// The tab can be reopened while a check is still running: rebuild its
		// busy state so the fresh button and status line match reality.
		if (this.checking) {
			this.setBusy(true);
			this.setStatus(CHECKING_MESSAGE);
		}
	}

	/**
	 * Reads identity, then the author's access on the configured project. Kept
	 * sequential so each failure is attributed to the right thing: a rejected
	 * token surfaces from the identity read, an unreachable project from the
	 * project read.
	 */
	private async testConnection(): Promise<void> {
		if (this.checking) {
			return;
		}

		const details = this.holder.connection;
		if (!hasConnectionDetails(details)) {
			this.setStatus(EMPTY_FIELDS_MESSAGE);
			return;
		}

		this.setBusy(true);
		this.setStatus(CHECKING_MESSAGE);
		try {
			const identity = await getCurrentUser(details);
			if (!identity.ok) {
				this.setStatus(FAILURE_MESSAGES[identity.failure]);
				return;
			}

			const access = await getProjectAccess(details);
			if (!access.ok) {
				this.setStatus(FAILURE_MESSAGES[access.failure]);
				return;
			}

			this.setStatus(`Connected as ${identity.value.name} — ${access.value.accessLabel} access`);
		} catch {
			this.setStatus(FAILURE_MESSAGES['unexpected']);
		} finally {
			this.setBusy(false);
		}
	}

	private setBusy(busy: boolean): void {
		this.checking = busy;
		if (this.testButton !== null) {
			this.testButton.setDisabled(busy);
		}
	}

	private setStatus(text: string): void {
		if (this.statusEl !== null) {
			this.statusEl.setText(text);
		}
	}
}

export { ConnectionSettingTab };
