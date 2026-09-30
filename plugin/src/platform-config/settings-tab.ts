import { App, ButtonComponent, Plugin, PluginSettingTab, Setting } from 'obsidian';
import type { ConnectionDetails, FailureKind } from '../git-publishing/gitlab-client';
import { getCurrentUser, getProjectAccess } from '../git-publishing/gitlab-client';
import { EMPTY_REPOSITORY_MESSAGE } from './access-messages';
import { hasConnectionDetails } from './connection';
import type { ConnectionState, ConnectionStateHolder } from './connection-state';
import type { SavedConnection } from '../submission-tracking/submission-store';

/**
 * All the settings tab needs from the plugin: the details, the outcome, and
 * a way to remember the two non-secret values (2026-09-30). The tab gets no
 * dependency on the store that writes them.
 */
export interface ConnectionHolder {
	readonly connection: ConnectionDetails;
	readonly connectionState: ConnectionStateHolder;
	rememberConnection(saved: SavedConnection): Promise<void>;
}

const CHECKING_MESSAGE = 'Checking…';
const EMPTY_FIELDS_MESSAGE = 'Fill in all three fields before testing the connection.';

/**
 * The refused-for-a-permission variant, naming the permission GitLab itself
 * reported rather than sending the author to check a project path that is
 * very likely correct (`docs/ce-verification.md` §D0g).
 *
 * The parenthetical is dropped when no name came back, for the same reason
 * the panel's equivalents drop it: an invented name would send someone to
 * tick the wrong box.
 */
function connectionPermissionMessage(detail: string | undefined): string {
	const missing = detail === undefined ? '' : ` (missing: ${detail})`;
	return (
		`Your access token doesn't have permission to check your connection${missing}. ` +
		'Ask your admin to add it.'
	);
}

const FAILURE_MESSAGES: Record<FailureKind, string> = {
	'rejected-credential': 'Your access has expired or is incorrect. Please ask your admin to set it up again.',
	'not-reachable':
		'That project could not be found, or your access does not include it. Check the project ID above.',
	'server-unreachable':
		'Could not reach GitLab at that address. Check the address above and your connection, then try again.',
	// REACHABLE as of 2026-09-29, and it was not before: the identity read is
	// now classified as scoped, so a token missing `User: Read` lands here
	// instead of on `not-reachable`'s "that project could not be found".
	// `statusText` prefers `connectionPermissionMessage` below, which names
	// the permission; this entry is the fallback for a refusal that names
	// none.
	'insufficient-permission':
		"Your access token doesn't have permission to check your account. Ask your admin to add it.",
	// Unreachable from "Test connection" for the same reason as the entry
	// above: this check only reads, and content-changed is produced solely by
	// a refused write. Present for the table's exhaustiveness.
	'content-changed': 'Someone else changed this document. Open it in GitLab to see their changes.',
	// Unreachable here too — "Test connection" reads the account and the
	// project's access level, neither of which needs a branch. Present for
	// exhaustiveness; the author meets this one at their first submit.
	'empty-repository': EMPTY_REPOSITORY_MESSAGE,
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
				'Your GitLab address and project ID are remembered after you test the connection. ' +
				'Your access token is kept for this Obsidian session only and never written to disk, ' +
				'so you paste it again after a restart.',
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
				// Named, rather than left to an admin to guess, as of the
				// 2026-09-22 verification run. This used to say "the exact
				// permissions it needs are assigned by your admin", which was
				// honest only because nobody knew them: GitLab exposes no
				// endpoint reporting what a fine-grained token holds, so the
				// list could only be learned by making each call against a
				// deliberately under-scoped token and reading what the refusal
				// named. That was done against the target instance, and the
				// eight below are the complete set — each one confirmed
				// necessary by a refusal, and the set confirmed sufficient by a
				// run in which every call succeeded holding nothing else. See
				// `docs/ce-verification.md` §A2.10.
				//
				// Grouped by the token screen's own tabs and worded to be
				// forwarded verbatim to whoever creates the token. The User tab
				// is called out because it is the one an author reading a list
				// of "project permissions" will miss, and `User: Read` is what
				// the FIRST call of Test connection needs — so missing it fails
				// at step one, before anything else has been tried.
				createFragment((desc) => {
					desc.appendText(
						'Create a fine-grained access token in GitLab, under User settings → ' +
							'Access tokens, and tick exactly these:'
					);
					const list = desc.createEl('ul');
					list.createEl('li', {
						text:
							'Group and project — Project (Read), Repository (Read), ' +
							'Branch (Read, Delete), Commit (Create), Merge Request (Read, Create)',
					});
					list.createEl('li', {
						text: 'User — User (Read). This is on the separate User tab, and is easy to miss.',
					});
					desc.appendText('Nothing else is needed.');
				})
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

		// Remembered as typed, before the check and whatever its outcome: a
		// check most often fails for a reason unrelated to these two values,
		// such as an expired token. A failed save must not stop the author
		// connecting this session (persist-connection-settings, 2026-09-30).
		// Started, not awaited: awaiting here would let a second click through
		// the `checking` guard above before the state below is set.
		this.holder
			.rememberConnection({ host: details.host, projectId: details.projectId })
			.catch((error: unknown) => {
				console.error('Docs Publisher: could not remember the connection details', error);
			});

		state.set({ kind: 'checking' });
		try {
			const identity = await getCurrentUser(details);
			if (!identity.ok) {
				state.set({
					kind: 'failed',
					failure: identity.failure,
					identity: null,
					detail: identity.detail,
				});
				return;
			}

			const access = await getProjectAccess(details);
			if (!access.ok) {
				state.set({
					kind: 'failed',
					failure: access.failure,
					identity: identity.value,
					detail: access.detail,
				});
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
				return state.failure === 'insufficient-permission'
					? connectionPermissionMessage(state.detail)
					: FAILURE_MESSAGES[state.failure];
		}
	}

	private setStatus(text: string): void {
		if (this.statusEl !== null) {
			this.statusEl.setText(text);
		}
	}
}

export { ConnectionSettingTab };
