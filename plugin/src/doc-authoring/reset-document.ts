import { Modal, Notice, Setting } from 'obsidian';
import type { App, TFile } from 'obsidian';
import type { ConnectionDetails } from '../git-publishing/gitlab-client';
import { listRepositoryFiles } from '../git-publishing/gitlab-client';
import type { ConnectionState } from '../platform-config/connection-state';
import { captureEditBaseline } from '../submission-tracking/document-status';
import type { SubmissionStore } from '../submission-tracking/submission-store';
import { requireAuthoringGate } from './authoring-gate';
import { attachmentReportMessage, bringAttachments } from './fetch-attachments';

/** The action label the panel's Reset control shows. */
export const RESET_LABEL = 'Reset';

/** The same write, offered under its own name when the note is gone. */
export const RESTORE_LABEL = 'Restore';

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

export const RESTORE_DONE_MESSAGE = 'This document is back in your vault.';

/**
 * The note came back and its images did not, because the listing they would
 * have been located from could not be read. Says what actually happened —
 * the document IS back — rather than reporting a failure the author would
 * read as "nothing happened".
 */
export const RESTORE_ATTACHMENTS_FAILED_MESSAGE =
	"This document came back, but its images couldn't be fetched. Try again later.";

/**
 * Makes the note at `path` match `content`, whether or not it exists yet.
 *
 * ONE FUNCTION FOR BOTH DIRECTIONS, merged 2026-09-22 from `resetDocument`
 * and `recoverDocument`. They differed in exactly one thing — whether a
 * note at the path was required or forbidden — and in nothing else: same
 * gate, same verbatim write, same refusal to touch front matter or the
 * tracking record. Two files meant two places for that to drift.
 *
 * The branch that matters is the confirmation. Overwriting destroys local
 * work, so it asks first, every time. Creating a note that is not there
 * destroys nothing, so it does not — the author pressed Restore, and there
 * is nothing to lose.
 *
 * THE CONFIRMATION IS INSIDE THIS FUNCTION, and deliberately not the
 * caller's to remember. This is the only exported overwrite, the modal is
 * private to this file, and there is no parameter that skips it — so "every
 * route to the overwrite passes through the confirmation" is a property of
 * the code's shape rather than of every future caller's diligence. That
 * condition is what `openspec/config.yaml`'s amended NO CI PIPELINE
 * decision exempts this on: the rule it is exempted from exists to prevent
 * silent loss of local edits, so an unconfirmed overwrite would be the
 * exact case that rule forbids. Do not add a variant that skips it.
 *
 * Writes the content verbatim, front matter included, so the note lands
 * byte-identical to what reviewers are looking at. It changes no state, no
 * branch and no path, and re-asserts no front matter field of its own: this
 * changes nothing about the review.
 *
 * It DOES record the edit baseline for `docId`, after either write. The
 * baseline is a fact about the note, not the review, and the note is now
 * exactly what the plugin wrote — leaving the old one would report every
 * reset note as edited, which it did until fix-edited-baseline.
 * `saveEditBaseline` takes nothing else, so it cannot move the review.
 *
 * `ref` is where the content came from, and supplying it is what makes the
 * document's IMAGES come back too (milestone 9a). Only the CREATE path
 * fetches them — a note already in the vault has whatever images it had,
 * and re-fetching them on a reset is not this change's business. Omitting
 * `ref` restores the text alone; a caller that does not know which ref its
 * content came from must not guess one, because fetching a document's
 * images from the wrong point in history is worse than not fetching them.
 *
 * Gated the same way `createDocument` is: hiding the control that offers it
 * is never what enforces the gate.
 */
export async function restoreDocument(
	app: App,
	details: ConnectionDetails,
	state: ConnectionState,
	store: SubmissionStore,
	docId: string,
	path: string,
	content: string,
	ref?: string
): Promise<boolean> {
	const gate = requireAuthoringGate(details, state);
	if (gate === null) {
		return false;
	}

	const existing = app.vault.getAbstractFileByPath(path);
	if (existing !== null) {
		const written = await overwrite(app, existing as TFile, content);
		if (written) {
			await store.saveEditBaseline(docId, await captureEditBaseline(app, path));
		}
		return written;
	}

	try {
		// The path may nest under folders this vault does not yet have (a
		// document filed deep in the corpus's own hierarchy, never seen
		// locally before). `createFolder` creates every missing intermediate
		// folder, so this is skipped only when the exact target folder
		// already exists — calling it again would throw.
		const folderPath = path.slice(0, path.lastIndexOf('/'));
		if (folderPath !== '' && app.vault.getAbstractFileByPath(folderPath) === null) {
			await app.vault.createFolder(folderPath);
		}

		const created = await app.vault.create(path, content);
		await app.workspace.getLeaf(false).openFile(created);
	} catch {
		new Notice(RESET_FAILED_MESSAGE);
		return false;
	}

	await store.saveEditBaseline(docId, await captureEditBaseline(app, path));
	new Notice(RESTORE_DONE_MESSAGE);

	if (ref !== undefined) {
		await restoreAttachments(app, details, path, ref);
	}

	return true;
}

/** The overwrite half: confirm, re-check, replace. */
async function overwrite(app: App, file: TFile, content: string): Promise<boolean> {
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
 * The images, after the note. Shares `bringAttachments` with Import rather
 * than having a mechanism of its own — two would be two chances to get it
 * wrong, and this gap existed in exactly one of them for long enough
 * already.
 *
 * A listing that fails is reported as images that did not arrive, which is
 * what it means here, rather than as a failure of the restore: the note is
 * already in the vault and staying there.
 */
async function restoreAttachments(
	app: App,
	details: ConnectionDetails,
	path: string,
	ref: string
): Promise<void> {
	const listing = await listRepositoryFiles(details, ref);
	if (!listing.ok) {
		new Notice(RESTORE_ATTACHMENTS_FAILED_MESSAGE);
		return;
	}

	const report = await bringAttachments(app, details, {
		notePath: path,
		ref,
		remotePaths: listing.value.paths,
	});
	const message = attachmentReportMessage(report);
	if (message !== null) {
		new Notice(message);
	}
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
