import { Notice } from 'obsidian';
import type { App, TFile } from 'obsidian';
import type { ActionSlot } from '../action-slot';
import { AUTHOR_MESSAGES, AUTHOR_TEMPLATES } from '../author-messages';
import type { GitFailureKind } from '../git-publishing/failures';
import { newReviewUrl } from '../git-publishing/project-address';
import type { ProjectAddress } from '../git-publishing/project-address';
import type { RepoContext } from '../git-publishing/repo';
import { setupMessageFor } from '../platform-config/setup-messages';
import { stepForFailure } from '../platform-config/setup-state';
import { readDocId } from '../submission-tracking/resolve';
import type { ResolvedNote } from '../submission-tracking/resolve-notes';
import { confirmMove } from '../vault-sync/modals';
import { listVaultDocuments } from '../plugin-shell/vault-documents';
import type { SubmitModalResult } from './submit-modal';
import { SubmitModal } from './submit-modal';
import { resolveEmbeddedAttachments } from './embeds';
import { hasSubmissionCategory, readSubmissionFields } from './front-matter';
import { planAndSend, replacesPublishedVersion } from './submit-plan';
import type { CarriedFile, SubmitContext, SubmitResult } from './submit-plan';
import { vaultEmbedIndex } from './vault-attachments';

/**
 * What the submit flow needs from the plugin, handed in so the panel's control
 * and the command palette are the same path and cannot drift apart.
 */
export interface SubmitDeps {
	app: App;
	writeAction: ActionSlot;
	/** The saved address, or null when there is none. */
	address: () => ProjectAddress | null;
	/** The vault's repository, for reading what the project holds before the dialog opens. */
	local: () => RepoContext;
	/** Everything a send needs, or null when setup is not complete. */
	context: () => Promise<SubmitContext | null>;
	/** The document git already knows this note to be, from what was last derived; null when it is not one. */
	resolveNote: (file: TFile) => ResolvedNote | null;
	/** The vault's notes whose content identifier is known, so a note can be matched as the panel matches it. */
	knownNotes: () => Array<{ path: string; blob: string }>;
	/** Derives the states again from the fetched copy, which a successful push has just updated, without a fetch. */
	rederive: () => Promise<void>;
	/** Sends a failure that is about setup back to its step. */
	onSetupFailure: (failure: GitFailureKind) => Promise<void>;
}

/**
 * Entry point for both the command and the panel control. The gate that setup
 * is complete is the caller's and has already passed. Opens the dialog; the
 * sequence itself runs only after the author confirms, and holds the busy slot
 * from that moment until the outcome is told.
 */
export function submitForReview(deps: SubmitDeps, target: TFile | null = null): void {
	const { app, writeAction } = deps;

	// Refused BEFORE the dialog, so the command palette does not let the author
	// fill it in only to be told no. Opening the dialog takes no slot.
	if (writeAction.current !== null) {
		new Notice(AUTHOR_MESSAGES.stillBusy);
		return;
	}
	// A row in the panel names its note; the command and the open note's control
	// submit whichever note is open.
	const file = target ?? app.workspace.getActiveFile();
	if (file === null || file.extension !== 'md') {
		new Notice(AUTHOR_MESSAGES.noActiveNote);
		return;
	}
	const address = deps.address();
	if (address === null) {
		new Notice(AUTHOR_MESSAGES.notReady);
		return;
	}

	void (async () => {
		// A note git already knows is a document that has been sent; one that has
		// been sent and has since lost its title is sent back to the note, because
		// collecting it again and writing the answer is the repeat write the front
		// matter contract forbids. Read HERE, ahead of the dialog, because it
		// decides which of the dialog's shapes opens.
		const legacyDocId = readDocId(app, file);
		const existing = readSubmissionFields(app, file);
		const known = legacyDocId !== null || deps.resolveNote(file) !== null;
		if (known && existing === null && hasSubmissionCategory(app, file)) {
			new Notice(AUTHOR_MESSAGES.incompleteFrontMatter);
			return;
		}

		const about = {
			destination: AUTHOR_TEMPLATES.destination(address.host, address.path),
			replacesPublished: await replacesPublishedVersion(deps.local(), file.path),
		};
		// A note without a title or a category has them collected now, which is the
		// moment they are written.
		const collects = existing === null;
		new SubmitModal(
			app,
			file,
			(result) => {
				void writeAction.run('submit', file.path, () => perform(deps, file, result, legacyDocId, collects));
			},
			existing ?? undefined,
			about
		).open();
	})();
}

/** The two notes that claim one identity: duplicating a note copies its front matter, `doc_id` included. */
function findDuplicateNote(app: App, file: TFile, docId: string): TFile | null {
	for (const entry of listVaultDocuments(app)) {
		if (entry.docId === docId && entry.file.path !== file.path) {
			return entry.file;
		}
	}
	return null;
}

/** The files a note embeds, as they are in the vault. One that cannot be read is skipped: the author's note being out of date is not a reason to refuse. */
async function readAttachments(app: App, file: TFile): Promise<CarriedFile[]> {
	const carried: CarriedFile[] = [];
	for (const path of resolveEmbeddedAttachments(file.path, vaultEmbedIndex(app))) {
		const attachment = app.vault.getFileByPath(path);
		if (attachment === null) {
			continue;
		}
		try {
			carried.push({ path, bytes: new Uint8Array(await app.vault.readBinary(attachment)) });
		} catch (error) {
			console.error(`Docs Publisher: could not read ${path} to send it; sending without it.`, error);
		}
	}
	return carried;
}

async function perform(
	deps: SubmitDeps,
	file: TFile,
	result: SubmitModalResult,
	existingDocId: string | null,
	collectsFields: boolean
): Promise<void> {
	const { app } = deps;

	if (existingDocId !== null) {
		const other = findDuplicateNote(app, file, existingDocId);
		if (other !== null) {
			new Notice(AUTHOR_TEMPLATES.duplicateDocId(other.path));
			return;
		}
	}
	const context = await deps.context();
	if (context === null) {
		new Notice(AUTHOR_MESSAGES.notReady);
		return;
	}

	// Read AFTER the dialog, not before: what reaches the project must be the
	// note as it stands at the moment of the successful send.
	const noteText = await app.vault.read(file);
	const outcome = await planAndSend(context, {
		notePath: file.path,
		basename: file.basename,
		noteText,
		existingDocId,
		fields: collectsFields ? { title: result.title, category: result.category } : null,
		title: result.title,
		attachments: await readAttachments(app, file),
		vaultPaths: new Set(app.vault.getFiles().map((entry) => entry.path)),
		knownNotes: deps.knownNotes(),
		confirmMove: (from) => confirmMove(app, from, file.path),
	});
	await report(deps, file, noteText, outcome, context.address);
}

/** Tells the author what happened, and on a send, makes the note match what was committed. */
async function report(deps: SubmitDeps, file: TFile, noteText: string, outcome: SubmitResult, address: ProjectAddress): Promise<void> {
	const { app } = deps;
	if (outcome.kind === 'declined') {
		// Nothing was sent and nothing was written; the note stays listed as moved.
		return;
	}
	if (outcome.kind === 'refused') {
		new Notice(outcome.message);
		return;
	}
	if (outcome.kind === 'failed') {
		await reportFailure(deps, outcome.failure);
		return;
	}

	// The note is made to equal exactly what was committed, and only if it still
	// holds what it held when it was read. Re-serialising the front matter
	// instead would leave it differing from the pushed file and reading as
	// edited at once; and a note the author kept typing in is left alone. A write
	// that is skipped leaves the note without its identity, and the next press
	// completes the send, because the branch is recognisably the author's.
	await completeNote(app, file, noteText, outcome.committedText);
	await deps.rederive();

	if (outcome.reviewRequest === 'link-only') {
		offerReviewRequest(outcome.link ?? newReviewUrl(address, outcome.docId));
		return;
	}
	new Notice(outcome.update ? AUTHOR_MESSAGES.updateSent : AUTHOR_MESSAGES.waitingForReview);
}

/**
 * Makes the note equal to what was committed, atomically and only if it still
 * holds what it held when it was read. Returns whether it was written. Never
 * throws: a note that cannot be completed is left as it is.
 */
export async function completeNote(app: Pick<App, 'vault'>, file: TFile, readText: string, committedText: string): Promise<boolean> {
	if (committedText === readText) {
		return false;
	}
	let written = false;
	try {
		await app.vault.process(file, (data) => {
			if (data !== readText) {
				return data;
			}
			written = true;
			return committedText;
		});
	} catch (error) {
		console.error('Docs Publisher: could not complete the note after sending it', error);
		return false;
	}
	return written;
}

/** The push went through and no review request was opened: said once, with the way to open one, and kept until the author acts. */
function offerReviewRequest(link: string): void {
	const fragment = document.createDocumentFragment();
	fragment.createEl('p', { text: AUTHOR_MESSAGES.sentNoRequest });
	const button = fragment.createEl('button', { text: AUTHOR_MESSAGES.openToRequestReview });
	button.addEventListener('click', () => {
		window.open(link);
	});
	// Duration 0: a notice that holds a button must not fade out from under it.
	new Notice(fragment, 0);
}

/** One message per cause. A setup problem sends the author to its step; everything unclassified is told the same way. */
async function reportFailure(deps: SubmitDeps, failure: GitFailureKind): Promise<void> {
	const said = submitFailureMessage(failure);
	new Notice(said.message);
	if (said.setup) {
		await deps.onSetupFailure(failure);
	}
}

/** What a failed send tells the author, and whether it is about setup and so sends them back to a step. */
export function submitFailureMessage(failure: GitFailureKind): { message: string; setup: boolean } {
	switch (failure) {
		case 'not-allowed':
			return { message: AUTHOR_MESSAGES.notAllowed, setup: false };
		case 'changed-meanwhile':
			return { message: AUTHOR_MESSAGES.changedWhileSending, setup: false };
		default:
			break;
	}
	if (stepForFailure(failure) !== null) {
		return { message: setupMessageFor(failure), setup: true };
	}
	// Every other cause — a dropped connection, a timeout, an unexpected reply —
	// is told the same way, naming no cause and not advising a rename.
	return { message: AUTHOR_MESSAGES.submitFailed, setup: false };
}
