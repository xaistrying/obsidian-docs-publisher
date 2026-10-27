import { Modal, Setting } from 'obsidian';
import type { App } from 'obsidian';
import { AUTHOR_MESSAGES, AUTHOR_TEMPLATES } from '../author-messages';
import type { Prompts } from './get-updates';

/**
 * The questions an update asks, as dialogs
 * (replace-rest-with-local-git-ssh task 4.4).
 *
 * A dialog and not a notice, because each answer decides what happens to the
 * author's text and the author must have to give it. Every way out that is not a
 * button — Escape, the close button, clicking away — answers `dismissed`, which
 * the engine reads as "decide nothing for them": the path is held back and asked
 * about again next time, never defaulted to a choice.
 */
class ChoiceModal<T> extends Modal {
	private answered = false;

	constructor(
		app: App,
		private readonly title: string,
		private readonly text: string,
		private readonly choices: ReadonlyArray<{ label: string; value: T; cta?: boolean }>,
		private readonly dismissed: T,
		private readonly settle: (value: T) => void
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: this.title });
		contentEl.createEl('p', { text: this.text });
		const row = new Setting(contentEl);
		for (const choice of this.choices) {
			row.addButton((button) => {
				button.setButtonText(choice.label).onClick(() => {
					this.answered = true;
					this.close();
					this.settle(choice.value);
				});
				if (choice.cta === true) {
					button.setCta();
				}
			});
		}
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.answered) {
			this.answered = true;
			this.settle(this.dismissed);
		}
	}
}

function ask<T>(
	app: App,
	title: string,
	text: string,
	choices: ReadonlyArray<{ label: string; value: T; cta?: boolean }>,
	dismissed: T
): Promise<T> {
	return new Promise((resolve) => {
		new ChoiceModal(app, title, text, choices, dismissed, resolve).open();
	});
}

export function obsidianPrompts(app: App): Prompts {
	return {
		confirmSummary: (counts) =>
			ask(
				app,
				AUTHOR_MESSAGES.summaryTitle,
				AUTHOR_TEMPLATES.summaryText(counts.download, counts.update, counts.decide),
				[
					{ label: AUTHOR_MESSAGES.cancel, value: false },
					{ label: AUTHOR_MESSAGES.getUpdates, value: true, cta: true },
				],
				false
			),
		twoVersions: (name) =>
			ask(
				app,
				AUTHOR_TEMPLATES.twoVersionsTitle(name),
				AUTHOR_MESSAGES.twoVersionsText,
				[
					{ label: AUTHOR_MESSAGES.keepMine, value: 'mine' as const },
					{ label: AUTHOR_MESSAGES.useTheirs, value: 'theirs' as const },
					{ label: AUTHOR_MESSAGES.keepBoth, value: 'both' as const },
				],
				'skip' as const
			),
		removedThere: (name) =>
			ask(
				app,
				AUTHOR_TEMPLATES.twoVersionsTitle(name),
				AUTHOR_MESSAGES.removedOnProjectText,
				[
					{ label: AUTHOR_MESSAGES.keepMine, value: 'mine' as const },
					{ label: AUTHOR_MESSAGES.removeIt, value: 'remove' as const },
				],
				'skip' as const
			),
		removedHere: (name) =>
			ask(
				app,
				AUTHOR_TEMPLATES.removedHereTitle(name),
				AUTHOR_MESSAGES.removedHereText,
				[
					{ label: AUTHOR_MESSAGES.keepRemoved, value: 'keep-removed' as const },
					{ label: AUTHOR_MESSAGES.getItBack, value: 'get-back' as const },
				],
				'skip' as const
			),
	};
}

/**
 * Asked before a send moves a document on the project. A dialog and not a
 * notice, because it removes the document from its old place there: Escape and
 * closing the dialog answer no, so nothing is sent unless the author says so.
 */
export function confirmMove(app: App, from: string, to: string): Promise<boolean> {
	return ask(
		app,
		AUTHOR_MESSAGES.moveConfirmTitle,
		`${AUTHOR_MESSAGES.moveConfirmText} ${AUTHOR_TEMPLATES.moveDetail(from, to)}`,
		[
			{ label: AUTHOR_MESSAGES.cancel, value: false },
			{ label: AUTHOR_MESSAGES.moveAndSubmit, value: true, cta: true },
		],
		false
	);
}
