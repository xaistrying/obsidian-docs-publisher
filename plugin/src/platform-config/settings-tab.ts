import { PluginSettingTab, Setting } from 'obsidian';
import type { App, Plugin, TextComponent } from 'obsidian';
import type { ActionSlot } from '../action-slot';
import { AUTHOR_MESSAGES } from '../author-messages';
import { pressSetupControl } from './setup-actions';
import type { SetupActionTargets } from './setup-actions';
import type { SetupController } from './setup-controller';
import type { GitResult } from '../git-publishing/failures';
import type { RepoContext } from '../git-publishing/repo';
import type { SetupStateHolder, SetupSnapshot } from './setup-state';
import { backToDefault as removeFromVault, readAdvanced, scopeLabel, setForVault } from './advanced-settings';
import type { AdvancedKey, AdvancedOutcome, AdvancedRow } from './advanced-settings';
import { buildKeyControls, buildStepRows, noticeFor } from './setup-view';
import type { SetupControl } from './setup-view';

/**
 * What the tab needs, and no more. The tab draws; the controller acts; the
 * holder is where the two meet and where the panel reads the same thing from.
 */
export interface SetupTabDeps {
	controller: SetupController;
	holder: SetupStateHolder;
	slot: Pick<ActionSlot, 'current' | 'onChange'>;
	targets: SetupActionTargets;
	/** What the Advanced section reads and changes, in this vault's own settings. */
	advanced: AdvancedPort;
}

export interface AdvancedPort {
	read(): Promise<GitResult<AdvancedRow[]>>;
	set(key: AdvancedKey, value: string): Promise<AdvancedOutcome>;
	clear(key: AdvancedKey): Promise<AdvancedOutcome>;
}

/** The port for a vault's repository: reads every layer, writes only this vault's own settings. */
export function advancedPortFor(context: () => RepoContext): AdvancedPort {
	return {
		read: () => readAdvanced(context()),
		set: (key, value) => setForVault(context(), key, value),
		clear: (key) => removeFromVault(context(), key),
	};
}

const MARKS = { done: '✓', current: '→', todo: '○' } as const;

/**
 * The settings tab: a project address, a key, and who the author is, under a
 * list of the five steps (replace-rest-with-local-git-ssh task 1.9). It
 * replaces the three-field token form, and shows the same steps as the panel's
 * first screen, drawn from the same state, so a step finished here is shown
 * there without either knowing the other exists.
 *
 * Built in pieces. The address field is made once and kept: it is the one
 * thing the author types into here, and rebuilding a field that is being typed
 * in loses the cursor. Everything around it is redrawn when setup changes, and
 * a section is redrawn only if what it would show is different. A control that
 * is pressed at the instant its section is rebuilt can lose the click: typing
 * an address and then clicking a button blurs the field on the way down, which
 * saves, which announces setup, which is the panel's own recorded race. So a
 * save or a refresh that changes nothing must not touch the buttons.
 */
export class SetupSettingTab extends PluginSettingTab {
	private readonly deps: SetupTabDeps;
	private progressEl: HTMLElement | null = null;
	private addressNoticeEl: HTMLElement | null = null;
	private keyEl: HTMLElement | null = null;
	private identityEl: HTMLElement | null = null;
	private identityNoticeEl: HTMLElement | null = null;
	private advancedEl: HTMLElement | null = null;
	/** The rows as last read, and the one message about the last change. */
	private advancedRows: AdvancedRow[] = [];
	private advancedNotice: string | null = null;
	/** Whether the section is open, kept across redraws: it is closed until the author opens it. */
	private advancedOpen = false;
	/** Ticked settings still waiting for a value to write; memory only, gone when the tab closes. */
	private readonly advancedPending = new Set<AdvancedKey>();
	private addressInput: TextComponent | null = null;
	/** The author has typed in the address field since it was last saved. Only then is leaving the tab a save. */
	private addressDirty = false;
	/** What each section last drew, so an unchanged one is left alone. */
	private drawn: { [section: string]: string } = {};
	private unsubscribers: Array<() => void> = [];

	constructor(app: App, plugin: Plugin, deps: SetupTabDeps) {
		super(app, plugin);
		this.deps = deps;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		this.releaseSubscriptions();
		this.drawn = {};
		this.addressDirty = false;

		containerEl.createEl('h2', { text: AUTHOR_MESSAGES.pluginName });
		this.progressEl = containerEl.createDiv();

		new Setting(containerEl)
			.setName(AUTHOR_MESSAGES.stepLabel2)
			.setDesc(AUTHOR_MESSAGES.addressHint)
			.addText((input) => {
				this.addressInput = input;
				input.setPlaceholder(AUTHOR_MESSAGES.addressPlaceholder);
				input.setValue(this.snapshot().facts.address?.sshUrl ?? '');
				input.inputEl.addEventListener('input', () => {
					this.addressDirty = true;
				});
				// When the author leaves the field, not on every keystroke: an
				// address half-typed is not an address to validate, and saving
				// runs a process to re-read setup.
				input.inputEl.addEventListener('blur', () => {
					void this.leaveAddress(input);
				});
			});
		this.addressNoticeEl = containerEl.createDiv();
		this.keyEl = containerEl.createDiv();
		this.identityEl = containerEl.createDiv();
		this.identityNoticeEl = containerEl.createDiv();
		this.advancedEl = containerEl.createDiv();
		containerEl.createEl('p', { text: AUTHOR_MESSAGES.remembered, cls: 'setting-item-description' });

		this.renderDynamic();
		this.unsubscribers = [
			this.deps.holder.onChange(() => this.renderDynamic()),
			this.deps.slot.onChange(() => this.renderDynamic()),
		];

		// Setup is read when the tab opens, so what it shows is what is saved
		// and not what was last read, which is nothing at all if the panel has
		// never been open this session. The field is filled in afterwards, unless
		// the author has already started typing in it.
		void this.deps.controller.refresh().then(() => {
			const input = this.addressInput;
			if (input !== null && !this.addressDirty) {
				input.setValue(this.snapshot().facts.address?.sshUrl ?? '');
			}
			void this.loadAdvanced();
		});
	}

	/**
	 * Setup is read again when the tab closes, and an address typed and not yet
	 * left is saved first: closing with Escape may remove the field before it
	 * loses focus, and the edit would be lost. Only an edit is saved — an empty
	 * field that was never typed in is a field that had not been filled yet, not
	 * a request to forget the address.
	 */
	hide(): void {
		this.releaseSubscriptions();
		const input = this.addressInput;
		const typed = input !== null && this.addressDirty ? input.getValue() : null;
		void (async () => {
			if (typed !== null) {
				this.addressDirty = false;
				await this.deps.controller.setAddress(typed);
			}
			await this.deps.controller.refresh();
		})();
	}

	private snapshot(): SetupSnapshot {
		return this.deps.holder.current;
	}

	private releaseSubscriptions(): void {
		for (const stop of this.unsubscribers) {
			stop();
		}
		this.unsubscribers = [];
	}

	private async leaveAddress(input: TextComponent): Promise<void> {
		this.addressDirty = false;
		const outcome = await this.deps.controller.setAddress(input.getValue());
		// A refused address stays as typed so it can be corrected; anything else
		// shows what was actually kept, which is the normalised form.
		if (outcome !== 'invalid') {
			input.setValue(this.snapshot().facts.address?.sshUrl ?? '');
		}
	}

	private renderDynamic(): void {
		if (
			this.progressEl === null ||
			this.addressNoticeEl === null ||
			this.keyEl === null ||
			this.identityEl === null ||
			this.identityNoticeEl === null ||
			this.advancedEl === null
		) {
			return;
		}
		const snapshot = this.snapshot();
		const progressEl = this.progressEl;
		const addressNoticeEl = this.addressNoticeEl;
		const keyEl = this.keyEl;
		const identityEl = this.identityEl;
		const identityNoticeEl = this.identityNoticeEl;
		const advancedEl = this.advancedEl;

		const rows = buildStepRows(snapshot);
		this.draw('progress', progressEl, rows, () => {
			for (const row of rows) {
				const text = `${MARKS[row.state]} ${row.label}`;
				progressEl.createEl('div', { text, cls: row.state === 'current' ? 'mod-warning' : '' });
			}
		});

		const addressNotice = noticeFor(snapshot, 2);
		this.draw('address', addressNoticeEl, addressNotice, () => {
			this.addNotice(addressNoticeEl, addressNotice);
		});

		const controls = buildKeyControls(snapshot, this.deps.slot.current);
		const keyNotice = noticeFor(snapshot, 3);
		const asksForName = this.asksForUsername(snapshot);
		this.draw('key', keyEl, { controls, keyNotice, asksForName }, () => {
			this.renderKey(keyEl, controls, keyNotice, asksForName);
		});

		// The fields and the message under them are drawn apart: a message about
		// what was typed must not rebuild the fields and take the typing away.
		const { identity, vaultConnected } = snapshot.facts;
		this.draw('identity', identityEl, { identity, vaultConnected }, () => {
			this.renderIdentity(identityEl, snapshot);
		});
		const identityNotice = noticeFor(snapshot, 5);
		this.draw('identityNotice', identityNoticeEl, identityNotice, () => {
			this.addNotice(identityNoticeEl, identityNotice);
		});

		this.draw('advanced', advancedEl, { rows: this.advancedRows, connected: vaultConnected, notice: this.advancedNotice, pending: Array.from(this.advancedPending) }, () => {
			this.renderAdvanced(advancedEl, vaultConnected);
		});
	}

	/** Redraws a section only if what it shows is different from last time. */
	private draw(name: string, el: HTMLElement, shown: unknown, build: () => void): void {
		const signature = JSON.stringify(shown);
		if (this.drawn[name] === signature) {
			return;
		}
		this.drawn[name] = signature;
		el.empty();
		build();
	}

	/**
	 * Asked for only when a test passed and the server did not say whose key it
	 * is: typed once, remembered, and new documents carry it as their owner.
	 */
	private asksForUsername(snapshot: SetupSnapshot): boolean {
		const { key, username, address, testedFor } = snapshot.facts;
		const tested =
			key !== null &&
			address !== null &&
			testedFor !== null &&
			testedFor.keyPath === key.path &&
			testedFor.address === address.sshUrl;
		return tested && (username === null || username === '');
	}

	private renderKey(el: HTMLElement, controls: SetupControl[], notice: string | null, asksForName: boolean): void {
		const keySetting = new Setting(el).setName(AUTHOR_MESSAGES.settingsKeyName).setDesc(AUTHOR_MESSAGES.keyIntro);
		for (const control of controls) {
			keySetting.addButton((button) => {
				button.setButtonText(control.label);
				button.setDisabled(control.disabled);
				button.onClick(() => {
					pressSetupControl(control.id, this.deps.targets);
				});
			});
		}
		this.addNotice(el, notice);

		if (asksForName) {
			new Setting(el)
				.setName(AUTHOR_MESSAGES.settingsUsernameName)
				.setDesc(AUTHOR_MESSAGES.usernamePrompt)
				.addText((input) => {
					input.inputEl.addEventListener('blur', () => {
						void this.deps.controller.setUsername(input.getValue());
					});
				});
		}
	}

	/**
	 * The name and email, from wherever they are set. Read-only until the vault
	 * is connected, because saving writes this vault's own git settings and those
	 * exist only then; afterwards they can be changed, and are saved for this
	 * vault alone, never to the computer's settings.
	 */
	private renderIdentity(el: HTMLElement, snapshot: SetupSnapshot): void {
		const { identity, vaultConnected } = snapshot.facts;
		const where =
			identity?.scope === 'vault'
				? AUTHOR_MESSAGES.scopeVault
				: identity?.scope === 'computer'
					? AUTHOR_MESSAGES.scopeComputer
					: identity?.scope === 'system'
						? AUTHOR_MESSAGES.scopeSystem
						: '';
		const description = vaultConnected
			? where
			: [AUTHOR_MESSAGES.identityReadonly, where].filter((part) => part !== '').join(' ');

		let name: TextComponent | null = null;
		let email: TextComponent | null = null;
		const setting = new Setting(el).setName(AUTHOR_MESSAGES.stepLabel5).setDesc(description);
		setting.addText((input) => {
			name = input;
			input.setPlaceholder(AUTHOR_MESSAGES.namePlaceholder);
			input.setDisabled(!vaultConnected);
			input.setValue(identity === null ? '' : identity.name);
		});
		setting.addText((input) => {
			email = input;
			input.setPlaceholder(AUTHOR_MESSAGES.emailPlaceholder);
			input.setDisabled(!vaultConnected);
			input.setValue(identity === null ? '' : identity.email);
		});
		if (vaultConnected) {
			setting.addButton((button) => {
				button.setButtonText(AUTHOR_MESSAGES.saveIdentity);
				button.onClick(() => {
					const typedName = name as TextComponent | null;
					const typedEmail = email as TextComponent | null;
					if (typedName !== null && typedEmail !== null) {
						void this.deps.controller.saveIdentity(typedName.getValue(), typedEmail.getValue());
					}
				});
			});
		}
	}

	/** Reads the three settings again, then draws them. A vault with no repository has nothing to read, and shows none. */
	private async loadAdvanced(): Promise<void> {
		const rows = await this.deps.advanced.read();
		this.advancedRows = rows.ok ? rows.value : [];
		this.renderDynamic();
	}

	/** Runs one change, says what went wrong if it did, and reads the rows again. */
	private async changeAdvanced(change: () => Promise<AdvancedOutcome>): Promise<void> {
		const outcome = await change();
		if (outcome.ok) {
			this.advancedNotice = null;
		} else {
			this.advancedNotice = 'message' in outcome ? outcome.message : AUTHOR_MESSAGES.setupUnexpected;
		}
		await this.loadAdvanced();
	}

	/**
	 * Writes a ticked setting's value. With no value yet, the tick is kept and the
	 * text box opens for one; a value that is refused keeps the tick too, with
	 * the reason, so the author can correct it instead of starting again.
	 */
	private async tickAdvanced(key: AdvancedKey, value: string): Promise<void> {
		if (value.trim() === '') {
			this.advancedPending.add(key);
			this.advancedNotice = null;
			this.renderDynamic();
			return;
		}
		const outcome = await this.deps.advanced.set(key, value);
		if (outcome.ok) {
			this.advancedPending.delete(key);
			this.advancedNotice = null;
		} else {
			this.advancedPending.add(key);
			this.advancedNotice = 'message' in outcome ? outcome.message : AUTHOR_MESSAGES.setupUnexpected;
		}
		await this.loadAdvanced();
	}

	/**
	 * The Advanced section: a fixed short list, closed until opened. Each row has a
	 * tick (this vault has its own value), the value, where it comes from, and
	 * "Back to default". A value from the computer or the system is shown and
	 * never edited; ticking it writes this vault's own and leaves theirs alone.
	 * Nothing here changes how documents are sent or received.
	 */
	private renderAdvanced(el: HTMLElement, connected: boolean): void {
		const details = el.createEl('details');
		details.open = this.advancedOpen;
		details.addEventListener('toggle', () => {
			this.advancedOpen = details.open;
		});
		details.createEl('summary', { text: AUTHOR_MESSAGES.advancedHeading });
		details.createEl('p', { text: AUTHOR_MESSAGES.advancedNote, cls: 'setting-item-description' });
		if (!connected) {
			details.createEl('p', { text: AUTHOR_MESSAGES.advancedUnconnected, cls: 'setting-item-description' });
		}

		for (const row of this.advancedRows) {
			const where = row.effective === null ? '' : scopeLabel(row.effective.scope);
			let text: TextComponent | null = null;
			// A tick with no value to write yet stays on, waiting for one: writing an
			// empty value is refused, and redrawing from git would switch it straight
			// back off, so nothing could ever be typed.
			const waiting = this.advancedPending.has(row.key);
			const setting = new Setting(details).setName(row.key).setDesc(where);
			setting.addToggle((toggle) => {
				toggle.setValue(row.ticked || waiting);
				toggle.setDisabled(!connected);
				toggle.onChange((on) => {
					if (!on) {
						this.advancedPending.delete(row.key);
						void this.changeAdvanced(() => this.deps.advanced.clear(row.key));
						return;
					}
					const typed = text === null ? '' : (text as TextComponent).getValue().trim();
					const value = typed !== '' ? typed : row.effective === null ? '' : row.effective.value;
					void this.tickAdvanced(row.key, value);
				});
			});
			setting.addText((input) => {
				text = input;
				input.setValue(row.effective === null ? '' : row.effective.value);
				// A value that is not this vault's own is shown and cannot be typed over.
				input.setDisabled(!connected || !(row.ticked || waiting));
				input.inputEl.addEventListener('blur', () => {
					const typed = input.getValue().trim();
					if ((row.ticked || waiting) && typed !== '' && typed !== (row.effective?.value ?? '')) {
						void this.tickAdvanced(row.key, typed);
					}
				});
			});
			setting.addButton((button) => {
				button.setButtonText(AUTHOR_MESSAGES.backToDefault);
				button.setDisabled(!connected || !(row.ticked || waiting));
				button.onClick(() => {
					this.advancedPending.delete(row.key);
					void this.changeAdvanced(() => this.deps.advanced.clear(row.key));
				});
			});
		}
		this.addNotice(details, this.advancedNotice);
	}

	private addNotice(el: HTMLElement, text: string | null): void {
		if (text !== null) {
			el.createEl('p', { text, cls: 'setting-item-description' });
		}
	}
}
