import { Modal, Notice, Setting } from 'obsidian';
import type { App, TFile } from 'obsidian';
import type { ActionSlot } from '../action-slot';
import { AUTHOR_MESSAGES, AUTHOR_TEMPLATES } from '../author-messages';
import type { RepoContext } from '../git-publishing/repo';
import { readVersionUnderReview, recordSeen } from './reset-note';

/** What Reset needs from the plugin, handed in so the one entry point is the only one. */
export interface ResetDeps {
	app: App;
	writeAction: ActionSlot;
	local: () => RepoContext;
	/** Derives the states again from the fetched copy, which is unchanged but whose "edited" answer is not. */
	rederive: () => Promise<void>;
	/**
	 * The document a note is, as the panel resolved it: by where it sits on the
	 * project or in this vault's record of what it sent, with an older `doc_id`
	 * property read as an alias. Null when the note is not a document.
	 */
	docIdOf: (file: TFile) => string | null;
}

/**
 * The one path to resetting a document: read what the document carries on its
 * own branch, confirm, then replace the note with it.
 *
 * There is no second entry point — no command palette entry, deliberately. A
 * hotkey-bound destructive action on whatever note happens to be open is the
 * misclick the panel control is shaped to avoid, and the confirmation would be
 * the only thing left guarding it.
 *
 * It changes where nothing stands: not the document's state, not its branch. Only
 * the note changes, and the commit it now matches is recorded as seen. Held in
 * the busy slot from the press until the confirmation is answered or the reset
 * is refused, labelled "Checking…" because until then nothing has been reset.
 */
export function resetDocument(deps: ResetDeps, file: TFile): void {
	// Not read from the note's properties: a note sent by this version carries no
	// identity property, and doing so made Reset do nothing, silently, on exactly
	// the notes it is offered for.
	const docId = deps.docIdOf(file);
	if (docId === null) {
		new Notice(AUTHOR_MESSAGES.resetFinished);
		return;
	}
	void deps.writeAction.run('reset', file.path, async () => {
		const plan = await readVersionUnderReview(deps.local(), docId);
		if (plan.kind === 'refused') {
			new Notice(plan.message);
			return;
		}
		if (!(await confirmReset(deps.app, file))) {
			return;
		}
		// Checked after the prompt rather than before it: the author may have
		// deleted or moved the note while it was open.
		if (deps.app.vault.getAbstractFileByPath(file.path) === null) {
			new Notice(AUTHOR_MESSAGES.resetMissingNote);
			return;
		}
		try {
			await deps.app.vault.modify(file, plan.content);
		} catch {
			new Notice(AUTHOR_MESSAGES.resetFailed);
			return;
		}
		await recordSeen(deps.local(), plan.docId, plan.tip);
		await deps.rederive();
		new Notice(AUTHOR_MESSAGES.resetDone);
	});
}

function confirmReset(app: App, file: TFile): Promise<boolean> {
	return new Promise((resolve) => {
		new ResetConfirmModal(app, file, resolve).open();
	});
}

/**
 * A modal rather than a `Notice` with a button: this destroys local work, and
 * the author must have to answer it rather than merely have a chance to catch it
 * before it fades. Not conditional on whether anything would be lost: a
 * conditional prompt is one refactor away from the silent path.
 */
class ResetConfirmModal extends Modal {
	private confirmed = false;

	constructor(
		app: App,
		private readonly file: TFile,
		private readonly settle: (confirmed: boolean) => void
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: AUTHOR_MESSAGES.resetConfirmTitle });
		contentEl.createEl('p', { text: AUTHOR_TEMPLATES.resetConfirmText(this.file.basename) });

		new Setting(contentEl)
			.addButton((button) =>
				button.setButtonText(AUTHOR_MESSAGES.cancel).onClick(() => {
					this.close();
				})
			)
			.addButton((button) =>
				button
					.setButtonText(AUTHOR_MESSAGES.resetDocument)
					.setWarning()
					.onClick(() => {
						this.confirmed = true;
						this.close();
					})
			);
	}

	onClose(): void {
		this.contentEl.empty();
		// Settled here, so every way out of this modal — Cancel, Escape, the close
		// button, clicking away — answers exactly once and defaults to not writing.
		this.settle(this.confirmed);
	}
}
