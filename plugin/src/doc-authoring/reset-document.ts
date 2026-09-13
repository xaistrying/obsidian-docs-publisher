import { Modal, Notice, Setting } from 'obsidian';
import type { App, TFile } from 'obsidian';
import type { ConnectionDetails } from '../git-publishing/gitlab-client';
import type { ConnectionState } from '../platform-config/connection-state';
import { requireAuthoringGate } from './authoring-gate';

/** The action label the panel's Reset control shows. */
export const RESET_LABEL = 'Reset';

/**
 * The read refused, told apart because the author's next step differs.
 * Absence means the review finished between the last refresh and the press,
 * so a refresh will show where the document actually stands; a failed read
 * means try again. Neither writes anything.
 *
 * Vocabulary-checked like every other author-facing string here: no
 * "branch", "commit", "merge request", "MR", "conflict", or "main".
 */
export const RESET_UNAVAILABLE_MESSAGE =
	"This document's review has already finished, so nothing was reset. Refresh to see where it stands now.";

export const RESET_READ_FAILED_MESSAGE =
	"Couldn't read the version under review just now, so nothing was reset. Try again.";

/**
 * The note vanished between the confirmation and the write — a real window,
 * since confirming is asynchronous. Refusing is the only honest answer:
 * recreating it here would be Recover, which is a different action with a
 * different guard.
 */
export const RESET_MISSING_NOTE_MESSAGE = 'That note is no longer in your vault, so nothing was reset.';

export const RESET_FAILED_MESSAGE = "This document wasn't reset. Try again.";

export const RESET_DONE_MESSAGE = 'This note now matches the version under review.';

/**
 * Replaces an EXISTING note's content with already-read remote content —
 * the mirror of `recoverDocument`, with the guard inverted. Recovery
 * refuses when a note occupies the path, because existence there means
 * something else already claims that identity; Reset REQUIRES one, because
 * the note at that path IS the document and replacing it is the requested
 * action.
 *
 * Writes the content verbatim, front matter included, so the note lands
 * byte-identical to what reviewers are looking at. It writes no tracking
 * record, changes no state, and re-asserts no front matter field of its own
 * (design.md decision 5): resetting local content changes nothing about the
 * review, and the front matter contract has the plugin never rewriting
 * those fields after they are frozen.
 *
 * THE CONFIRMATION IS INSIDE THIS FUNCTION, and deliberately not the
 * caller's to remember. This is the only exported overwrite, the modal is
 * private to this file, and there is no parameter that skips it — so "every
 * route to the overwrite passes through the confirmation" is a property of
 * the code's shape rather than of every future caller's diligence. That
 * condition is what `openspec/config.yaml`'s amended NO CI PIPELINE
 * decision exempts Reset on: the rule it is exempted from exists to prevent
 * silent loss of local edits, so an unconfirmed Reset would be the exact
 * case that rule forbids. Do not add a "reset without asking" variant.
 *
 * Gated the same way `recoverDocument` and `createDocument` are: hiding the
 * control that offers it is never what enforces the gate.
 */
export async function resetDocument(
	app: App,
	details: ConnectionDetails,
	state: ConnectionState,
	file: TFile,
	content: string
): Promise<boolean> {
	const gate = requireAuthoringGate(details, state);
	if (gate === null) {
		return false;
	}

	const confirmed = await confirmReset(app, file);
	if (!confirmed) {
		return false;
	}

	// Re-checked after the prompt rather than before it: the author may have
	// deleted or moved the note while it was open.
	if (app.vault.getAbstractFileByPath(file.path) === null) {
		new Notice(RESET_MISSING_NOTE_MESSAGE);
		return false;
	}

	try {
		await app.vault.modify(file, content);
	} catch {
		new Notice(RESET_FAILED_MESSAGE);
		return false;
	}

	new Notice(RESET_DONE_MESSAGE);
	return true;
}

/**
 * Resolves true only when the author presses Reset. Dismissing — the close
 * button, Escape, clicking away, or Cancel — resolves false, and nothing is
 * written on any of those paths.
 */
function confirmReset(app: App, file: TFile): Promise<boolean> {
	return new Promise((resolve) => {
		new ResetConfirmModal(app, file, resolve).open();
	});
}

/**
 * A modal rather than a `Notice` with a button: this destroys local work,
 * and the author must have to answer it rather than merely have a chance to
 * catch it before it fades.
 *
 * Not private to a setting, and not conditional on whether anything would
 * actually be lost. Obsidian exposes no signal the plugin can read to tell
 * whether this note has drifted from what was submitted, and diffing local
 * content against the remote before prompting was rejected: it would make
 * the prompt conditional, and a conditional prompt is one refactor away
 * from the silent path the amendment forbids. Always asking costs one click
 * when nothing is lost, and is the entire safety property when something
 * is (design.md decision 3).
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
		contentEl.createEl('h2', { text: 'Reset this document?' });
		contentEl.createEl('p', {
			text:
				`“${this.file.basename}” will be replaced with the version currently under ` +
				'review. Anything you have changed in this note since you last sent it will be lost.',
		});

		new Setting(contentEl)
			.addButton((button) =>
				button.setButtonText('Cancel').onClick(() => {
					this.close();
				})
			)
			.addButton((button) =>
				button
					.setButtonText(RESET_LABEL)
					.setWarning()
					.onClick(() => {
						this.confirmed = true;
						this.close();
					})
			);
	}

	onClose(): void {
		this.contentEl.empty();
		// Settled here rather than in the click handler, so every way out of
		// this modal — Cancel, Escape, the close button, clicking away —
		// answers exactly once and defaults to not writing.
		this.settle(this.confirmed);
	}
}
