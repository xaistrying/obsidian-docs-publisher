import { AUTHOR_MESSAGES } from '../author-messages';
import { blobId } from '../git-publishing/blob-id';
import { foreignCommitTouching, tipBuiltHere } from '../git-publishing/branch-ownership';
import type { GitFailureKind } from '../git-publishing/failures';
import { buildCommit } from '../git-publishing/plumbing-commit';
import type { CommitIdentity } from '../git-publishing/plumbing-commit';
import type { ProjectAddress } from '../git-publishing/project-address';
import { pushDocumentBranch, pushTitle } from '../git-publishing/push';
import { fetchedBranchRef, fetchedDefaultRef, isValidRefPart, sentRef } from '../git-publishing/ref-names';
import { NOTE_TRAILER, blobAt, changedFiles, deleteRef, fetchProject, readRef, writeSent } from '../git-publishing/repo';
import type { RepoContext } from '../git-publishing/repo';
import { deriveDocument, deriveFromSnapshot, loadSnapshot } from '../submission-tracking/derive-state';
import type { Snapshot } from '../submission-tracking/derive-state';
import { resolveNotes } from '../submission-tracking/resolve-notes';
import type { Category } from './categories';
import { deriveDocId } from './doc-id';
import { withSubmissionFrontMatter } from './front-matter';

/**
 * Everything that happens between "the author confirmed" and "the document is
 * on the project", with no part of Obsidian in it
 * (replace-rest-with-local-git-ssh design.md D5, tasks 3.4 to 3.6).
 *
 * In this order, and the order is the logic: fetch first, so everything below
 * reads what the project holds now; then every refusal, each writing nothing
 * anywhere; then build the commit in a throwaway index; record it as sent
 * BEFORE pushing, so a push whose outcome is unknown is still recognised as the
 * author's own; then push, with a lease on what was seen. The note is not
 * touched here at all. What the caller does with the note afterwards is its own
 * business and is told exactly what was committed.
 *
 * The one thing that replaces the old per-file `last_commit_id` is the stale
 * guard below: a document someone else changed since the author last got
 * updates is never silently overwritten.
 */
export interface SubmitContext {
	/** Reads and builds in the vault's repository; carries no key. */
	local: RepoContext;
	/** Reaches the project; carries the chosen key. */
	network: RepoContext;
	address: ProjectAddress;
	identity: CommitIdentity;
}

export interface CarriedFile {
	/** The path in the vault, which is the path on the project. */
	path: string;
	bytes: Uint8Array;
}

export interface SubmitInput {
	/** The note's path in the vault, which is where it lives on the project. */
	notePath: string;
	/** The note's name without its extension, from which a first identity is derived. */
	basename: string;
	/** The note as it was read. */
	noteText: string;
	/**
	 * The `doc_id` in the note's front matter, where an older version of this
	 * plugin wrote one: an alias for the identity, never required and never
	 * written. Null for every other note.
	 */
	existingDocId: string | null;
	/** Title and category to complete in the note; null when the note already carries them. */
	fields: { title: string; category: Category } | null;
	/** Shown on the review request. */
	title: string;
	/** The images and other files the note embeds, as they are in the vault. */
	attachments: readonly CarriedFile[];
	/** Every path in the vault, so a note's old path can be told from one that is still there. */
	vaultPaths: ReadonlySet<string>;
	/**
	 * The other notes in the vault whose content identifier is known, so that a
	 * note is matched to a document the way the panel matches it: a note whose
	 * exact bytes sit in the vault twice is matched to nothing.
	 */
	knownNotes: ReadonlyArray<{ path: string; blob: string }>;
	/**
	 * Asked once, after every refusal and before anything is built, when the send
	 * would move the document on the project, with the path the project has it at.
	 * Answering no sends nothing.
	 */
	confirmMove: (from: string) => Promise<boolean>;
}

export type SubmitResult =
	| {
			kind: 'sent';
			docId: string;
			remotePath: string;
			commit: string;
			/** Exactly what was committed for the note, so the local copy can be made to match it byte for byte. */
			committedText: string;
			reviewRequest: 'created' | 'link-only';
			link: string | null;
			/** An update to a review that was already open, rather than a new review. */
			update: boolean;
			/** The document left its old path on the project and arrived at this one. */
			moved: boolean;
	  }
	| { kind: 'declined' }
	| { kind: 'refused'; message: string }
	| { kind: 'failed'; failure: GitFailureKind };

const refused = (message: string): SubmitResult => ({ kind: 'refused', message });
const failed = (failure: GitFailureKind): SubmitResult => ({ kind: 'failed', failure });

/**
 * Failures after which the commit certainly did not reach the project. The sent
 * record is put back as it was for these, so an earlier attempt of the author's
 * own is still recognised as theirs. A timeout, or anything unclassified, may
 * have delivered the commit, and the record is left pointing at it.
 */
const NOT_DELIVERED: ReadonlyArray<GitFailureKind> = [
	'changed-meanwhile',
	'not-allowed',
	'key-rejected',
	'key-protected',
	'key-unreadable',
	'host-changed',
	'project-not-found',
	'address-rewritten',
	'server-unreachable',
	'git-missing',
	'ssh-missing',
];

/** Whether sending this note would be a revision of a document the vault has received, which the modal says. */
export async function replacesPublishedVersion(local: RepoContext, notePath: string): Promise<boolean> {
	// Only the files are needed; what each send carried is not, and the dialog waits on this.
	const snapshot = await loadSnapshot(local, { withSentNotes: false });
	return snapshot.ok && snapshot.value !== null && snapshot.value.synced !== null && snapshot.value.synced.has(notePath);
}

export async function planAndSend(ctx: SubmitContext, input: SubmitInput): Promise<SubmitResult> {
	// An identity read from a note that cannot be a branch name stops here,
	// before the project is asked anything.
	if (input.existingDocId !== null && !isValidRefPart(input.existingDocId)) {
		return refused(AUTHOR_MESSAGES.invalidIdentity);
	}

	// Fetch first, so every check below reads what the project holds now. If the
	// project cannot be read, nothing is assumed about it.
	const fetched = await fetchProject(ctx.network, ctx.address);
	if (!fetched.ok) {
		return failed(fetched.failure);
	}
	const loaded = await loadSnapshot(ctx.local);
	if (!loaded.ok) {
		return failed(loaded.failure);
	}
	const snapshot = loaded.value;
	if (snapshot === null) {
		return failed('unexpected');
	}
	const states = await deriveFromSnapshot(ctx.local, snapshot, input.existingDocId === null ? [] : [input.existingDocId]);
	if (!states.ok) {
		return failed(states.failure);
	}

	// Which document this note is, before anything else. A note git already knows
	// continues that document, wherever the note now sits and whatever it is now
	// called. Only a note nothing knows is a first submission, and only then is
	// an identity derived from its file name.
	const noteBlob = blobId(Buffer.from(input.noteText, 'utf8'));
	const siblings = input.knownNotes.filter((other) => other.path !== input.notePath).map((other) => ({ ...other, legacyDocId: null }));
	const match = resolveNotes(
		states.value,
		[{ path: input.notePath, blob: noteBlob, legacyDocId: input.existingDocId }, ...siblings],
		input.vaultPaths
	).get(input.notePath);
	const first = match === undefined;
	const docId = match === undefined ? deriveDocId(input.basename) : match.docId;
	if (docId === null) {
		return refused(AUTHOR_MESSAGES.invalidFilename);
	}
	if (!isValidRefPart(docId)) {
		return refused(AUTHOR_MESSAGES.invalidIdentity);
	}

	const checked = first ? await checkFirstSubmission(ctx, input, snapshot, docId) : null;
	if (checked !== null) {
		return checked;
	}
	// A note at a path the project holds is a revision of that document, but only
	// of one the vault has received or sent itself: one that appeared there since
	// the last update has not been seen, and sending over it would be a guess.
	if (
		match !== undefined &&
		match.via === 'project-path' &&
		snapshot.synced?.has(input.notePath) !== true &&
		snapshot.sentNotes.get(docId)?.path !== input.notePath
	) {
		return refused(AUTHOR_MESSAGES.pathNotReceived);
	}

	const known = states.value.documents.get(docId);
	const derived = known !== undefined ? { ok: true as const, value: known } : await deriveDocument(ctx.local, snapshot, docId);
	if (!derived.ok) {
		return failed(derived.failure);
	}

	// A document at one path, a note at another: it was moved. The old path is
	// the document's own, never another document's, and is removed in the same
	// commit that adds the new one. This is the one case in which a send removes
	// a file from the project.
	const previousPath = first ? null : derived.value.remotePath ?? snapshot.sentNotes.get(docId)?.path ?? null;
	const moved = previousPath !== null && previousPath !== input.notePath;
	if (moved && snapshot.main.has(input.notePath)) {
		// The new path is held on the project by something else.
		return refused(AUTHOR_MESSAGES.pathNotReceived);
	}
	const removals = moved && previousPath !== null ? [previousPath] : [];

	// What reaches the project: the note with its title and category completed, in
	// memory only, and the images it embeds. The note itself is not written until
	// after the push has succeeded.
	let committedText = input.noteText;
	if (input.fields !== null) {
		committedText = withSubmissionFrontMatter(input.noteText, input.fields);
	}
	const noteBytes = new Uint8Array(Buffer.from(committedText, 'utf8'));
	const files: CarriedFile[] = [{ path: input.notePath, bytes: noteBytes }];
	for (const attachment of input.attachments) {
		if (attachment.path !== input.notePath) {
			files.push(attachment);
		}
	}

	const pending = derived.value.state === 'pending' && snapshot.branches.has(docId) && !first;
	const sentCommit = snapshot.sent.get(docId) ?? null;

	// The stale guard: for every file carried, a change someone else made to the
	// project since the author last got updates is never overwritten, unless the
	// change is the author's own, merged.
	const originals = new Map<string, string>([[input.notePath, noteBlob]]);
	for (const attachment of input.attachments) {
		originals.set(attachment.path, blobId(attachment.bytes));
	}
	for (const file of files) {
		const onProject = snapshot.main.get(file.path) ?? null;
		const synced = snapshot.synced?.get(file.path) ?? null;
		if (onProject === synced || originals.get(file.path) === onProject) {
			continue;
		}
		const lastSent = sentCommit === null ? { ok: true as const, value: null } : await blobAt(ctx.local, sentCommit, file.path);
		if (!lastSent.ok) {
			return failed(lastSent.failure);
		}
		if (lastSent.value !== onProject) {
			return refused(AUTHOR_MESSAGES.changedSinceUpdates);
		}
	}
	// And for a file the send removes: the project's copy at the old path must be
	// the version the vault last knew (received, sent, or this note's own), so a
	// move can never discard someone else's later edit.
	for (const path of removals) {
		const onProject = snapshot.main.get(path) ?? null;
		if (onProject === null) {
			continue;
		}
		const lastSent = sentCommit === null ? { ok: true as const, value: null } : await blobAt(ctx.local, sentCommit, path);
		if (!lastSent.ok) {
			return failed(lastSent.failure);
		}
		if (onProject !== (snapshot.synced?.get(path) ?? null) && onProject !== noteBlob && onProject !== lastSent.value) {
			return refused(AUTHOR_MESSAGES.changedSinceUpdates);
		}
	}

	// A review that is open, with a commit on it this vault did not build or
	// bring in, that changes one of the files being sent or removed.
	if (pending) {
		const foreign = await foreignCommitTouching(
			ctx.local,
			docId,
			snapshot.defaultBranch,
			[...files.map((file) => file.path), ...removals]
		);
		if (!foreign.ok) {
			return failed(foreign.failure);
		}
		if (foreign.value) {
			return refused(AUTHOR_MESSAGES.reviewHasChanges);
		}
	}

	// Where the commit starts from, and what the push is allowed to replace. An
	// open review takes a revision on top of its own tip, so a reviewer's commits
	// are kept. Everything else starts a new round from the default branch, and
	// replaces whatever is left of the last one, in the same push.
	const defaultTip = await readRef(ctx.local, fetchedDefaultRef(snapshot.defaultBranch));
	if (!defaultTip.ok || defaultTip.value === null) {
		return failed('unexpected');
	}
	const branchTip = snapshot.branches.has(docId) ? await readRef(ctx.local, fetchedBranchRef(docId)) : { ok: true as const, value: null };
	if (!branchTip.ok) {
		return failed(branchTip.failure);
	}
	const parent = pending && branchTip.value !== null ? branchTip.value : defaultTip.value;

	// Every refusal has passed. Moving the document on the project is the one
	// thing a send does that the author did not ask for by pressing Submit, so it
	// is asked about, in plain words, and declining sends nothing.
	if (moved && previousPath !== null && !(await input.confirmMove(previousPath))) {
		return { kind: 'declined' };
	}

	// The note's path goes in the message, so the send record can name it even when
	// this send changed only an image.
	const message = `docs: ${pushTitle(input.title, docId)}\n\n${NOTE_TRAILER}${input.notePath}`;
	const built = await buildCommit(ctx.local, parent, files, ctx.identity, message, removals);
	if (!built.ok) {
		return failed(built.failure);
	}
	const parentTree = await treeOf(ctx.local, parent);
	if (parentTree === built.value.tree) {
		return refused(AUTHOR_MESSAGES.nothingToSend);
	}

	// Recorded before the push: a push whose outcome is unknown — a timeout — is
	// still recognised afterwards as the author's own.
	const recorded = await writeSent(ctx.local, docId, built.value.commit);
	if (!recorded.ok) {
		return failed(recorded.failure);
	}
	const pushed = await pushDocumentBranch(ctx.network, {
		address: ctx.address,
		docId,
		commit: built.value.commit,
		expectedTip: branchTip.value,
		title: input.title,
		defaultBranch: snapshot.defaultBranch,
	});
	if (!pushed.ok) {
		if (NOT_DELIVERED.indexOf(pushed.failure) !== -1) {
			await restoreSent(ctx.local, docId, sentCommit);
		}
		return failed(pushed.failure);
	}

	return {
		kind: 'sent',
		docId,
		remotePath: input.notePath,
		commit: built.value.commit,
		committedText,
		reviewRequest: pushed.value.reviewRequest,
		link: pushed.value.link,
		update: pending,
		moved,
	};
}

/**
 * The checks that only a note with no identity yet is put through, each
 * refusing before anything is written. Null when all pass.
 */
async function checkFirstSubmission(ctx: SubmitContext, input: SubmitInput, snapshot: Snapshot, docId: string): Promise<SubmitResult | null> {
	// A file at this path that the vault has not received. One it has received
	// is a document being revised, which is allowed and is not a collision.
	const received = snapshot.synced !== null && snapshot.synced.has(input.notePath);
	if (!received && snapshot.main.has(input.notePath)) {
		return refused(AUTHOR_MESSAGES.pathNotReceived);
	}

	// An identity is a file name, so two files sharing one share a branch.
	const sharing = snapshot.identities.get(docId) ?? [];
	if (sharing.some((path) => path !== input.notePath)) {
		return refused(AUTHOR_MESSAGES.identityNotUnique);
	}

	// A branch this vault did not build is someone else's, and is never replaced.
	// One it did is an interrupted attempt of its own, and is completed.
	if (snapshot.branches.has(docId)) {
		const built = await tipBuiltHere(ctx.local, docId);
		if (built === 'failed') {
			return failed('unexpected');
		}
		if (built === 'no') {
			return refused(AUTHOR_MESSAGES.alreadyWaiting);
		}
		// An interrupted attempt of its own is the same note. A review this vault
		// opened for a note at ANOTHER path belongs to that note, and this one,
		// sharing its file name, would replace it.
		const sentPath = snapshot.sentNotes.get(docId)?.path ?? null;
		const reviewPath = sentPath ?? (await changedFiles(ctx.local, docId, snapshot.defaultBranch).then((read) => (read.ok ? read.value.document : null)));
		if (reviewPath !== null && reviewPath !== input.notePath) {
			return refused(AUTHOR_MESSAGES.identityNotUnique);
		}
	}
	return null;
}

async function treeOf(ctx: RepoContext, commit: string): Promise<string | null> {
	const result = await ctx.git.run({ args: ['rev-parse', '--verify', '--quiet', `${commit}^{tree}`], cwd: ctx.cwd });
	return result.exitCode === 0 ? result.stdout.toString('utf8').trim() : null;
}

/** Puts the sent record back as it was before this attempt, or removes it if there was none. */
async function restoreSent(ctx: RepoContext, docId: string, previous: string | null): Promise<void> {
	if (previous !== null) {
		await writeSent(ctx, docId, previous);
	} else {
		await deleteRef(ctx, sentRef(docId));
	}
}
