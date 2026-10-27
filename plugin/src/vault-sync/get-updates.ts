import { AUTHOR_MESSAGES, AUTHOR_TEMPLATES } from '../author-messages';
import { blobId } from '../git-publishing/blob-id';
import type { GitFailureKind } from '../git-publishing/failures';
import type { ProjectAddress } from '../git-publishing/project-address';
import { isCommittablePath } from '../git-publishing/plumbing-commit';
import { CONNECTED_REF, SYNCED_REF, fetchedDefaultRef } from '../git-publishing/ref-names';
import {
	advanceHead,
	advanceSynced,
	currentBranch,
	fetchProject,
	listFiles,
	readBlob,
	readRef,
	sentVersions,
} from '../git-publishing/repo';
import type { RepoContext } from '../git-publishing/repo';
import { decide } from './decide';
import type { Action } from './decide';
import { isText, mergeText } from './merge-text';
import { canHoldMovedNote, matchMoved, movedAbsentPaths } from './moved-notes';
import type { NoteBlob } from './moved-notes';

/**
 * Getting updates: fetch, then apply the whole project to the vault, one
 * direction, and send nothing
 * (replace-rest-with-local-git-ssh design.md D9, tasks 4.1 to 4.4).
 *
 * Never `git pull`, which refuses over a vault whose notes differ from the
 * project's and would write what it likes. Every path where the last synced
 * version (the base) differs from ONE fetched commit (theirs) is decided by
 * `decide`, from the note's exact bytes, and the commit is pinned at the start:
 * a fetch cannot start under an update, so what is compared with is what is
 * applied. Every write goes through the vault's own file API, so an open editor
 * shows it, and nothing is ever written under the settings or repository
 * folders. Before any write that replaces or removes text the author changed, a
 * copy of the author's text is made in the plugin's own folder inside the vault,
 * so recovery does not depend on the vault's "deleted files" setting; a copy that
 * cannot be made stops that file.
 *
 * A path that cannot be applied is skipped and held back from the recorded
 * synced version, so the next update decides it again and nothing else.
 */

/** The vault, as the engine needs to see it. The real one is Obsidian's; the tests use a folder. */
export interface VaultIO {
	/** The file's bytes, or null when there is none. */
	read(path: string): Promise<Uint8Array | null>;
	/** Creates or replaces a file, creating folders. Throws when the system refuses. */
	write(path: string, bytes: Uint8Array): Promise<void>;
	/** Moves a note to the vault's own trash, whatever the vault's setting for deleted files. */
	trash(path: string): Promise<void>;
	/** Copies the author's text into the plugin's trash folder under `stamp`. Throws on failure. */
	saveCopy(path: string, bytes: Uint8Array, stamp: string): Promise<void>;
	/** Whether the note is open in an editor whose text differs from the file's. */
	isUnsaved(path: string): Promise<boolean>;
	/** Every file path in the vault. */
	allPaths(): Promise<string[]>;
	/** Whether names that differ only in case are one file, found by probing the file system. */
	caseInsensitive(): Promise<boolean>;
}

export type TwoVersions = 'mine' | 'theirs' | 'both' | 'skip';

/** What the author is asked, and how they answer. Dismissing a dialog is `skip`: nothing is decided for them. */
export interface Prompts {
	confirmSummary(counts: { download: number; update: number; decide: number }): Promise<boolean>;
	twoVersions(name: string): Promise<TwoVersions>;
	removedThere(name: string): Promise<'mine' | 'remove' | 'skip'>;
	removedHere(name: string): Promise<'keep-removed' | 'get-back' | 'skip'>;
}

export interface UpdateDeps {
	local: RepoContext;
	network: RepoContext;
	address: ProjectAddress;
	vault: VaultIO;
	prompts: Prompts;
	now: () => Date;
}

export type UpdateResult =
	| {
			kind: 'done';
			added: number;
			updated: number;
			removed: number;
			/** Paths that were not applied and will be decided again. */
			skipped: string[];
			/** What to tell the author, in order. */
			messages: string[];
	  }
	| { kind: 'cancelled' }
	| { kind: 'failed'; failure: GitFailureKind };

interface Planned {
	path: string;
	/** The path that actually holds the note: the same, or a name differing only in case. */
	occupant: string | null;
	mine: Uint8Array | null;
	mineBlob: string | null;
	theirsBlob: string | null;
	action: Action;
}

const failed = (failure: GitFailureKind): UpdateResult => ({ kind: 'failed', failure });

/** `2026-10-23_14-05-09`: a folder name every file system accepts. */
function stamp(date: Date): string {
	const p = (n: number): string => (n < 10 ? `0${n}` : `${n}`);
	return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}_${p(date.getHours())}-${p(date.getMinutes())}-${p(date.getSeconds())}`;
}

function nameOf(path: string): string {
	const file = path.slice(path.lastIndexOf('/') + 1);
	const dot = file.lastIndexOf('.');
	return dot <= 0 ? file : file.slice(0, dot);
}

/** `<name> (from GitLab).<ext>`, then `(from GitLab 2)`, and so on, the first that is free. */
export function copyPath(path: string, taken: (candidate: string) => boolean): string {
	const slash = path.lastIndexOf('/');
	const folder = slash === -1 ? '' : path.slice(0, slash + 1);
	const file = path.slice(slash + 1);
	const dot = file.lastIndexOf('.');
	const name = dot <= 0 ? file : file.slice(0, dot);
	const extension = dot <= 0 ? '' : file.slice(dot);
	for (let n = 1; ; n++) {
		const candidate = `${folder}${name} (from GitLab${n === 1 ? '' : ` ${n}`})${extension}`;
		if (!taken(candidate)) {
			return candidate;
		}
	}
}

export async function getUpdates(deps: UpdateDeps): Promise<UpdateResult> {
	const { local, vault } = deps;

	const fetched = await fetchProject(deps.network, deps.address);
	if (!fetched.ok) {
		return failed(fetched.failure);
	}

	// One commit, used for every comparison and for the last step.
	const branch = await currentBranch(local);
	if (!branch.ok || branch.value === null) {
		return failed(branch.ok ? 'unexpected' : branch.failure);
	}
	const tip = await readRef(local, fetchedDefaultRef(branch.value));
	if (!tip.ok || tip.value === null) {
		return failed(tip.ok ? 'unexpected' : tip.failure);
	}
	const syncedCommit = await readRef(local, SYNCED_REF);
	if (!syncedCommit.ok) {
		return failed(syncedCommit.failure);
	}
	if (syncedCommit.value === null) {
		return failed('unexpected');
	}
	const base = await listFiles(local, syncedCommit.value);
	const theirs = await listFiles(local, tip.value);
	if (!base.ok) {
		return failed(base.failure);
	}
	if (!theirs.ok) {
		return failed(theirs.failure);
	}

	const baseFiles = base.value;
	const changed = Array.from(new Set([...Array.from(base.value.keys()), ...Array.from(theirs.value.keys())])).filter(
		(path) => base.value.get(path) !== theirs.value.get(path)
	);
	const sent = await sentVersions(local, changed);
	if (!sent.ok) {
		return failed(sent.failure);
	}

	const insensitive = await vault.caseInsensitive();
	const existing = await vault.allPaths();
	const occupantOf = (path: string): string | null => {
		if (existing.indexOf(path) !== -1) {
			return path;
		}
		if (!insensitive) {
			return null;
		}
		const folded = path.toLowerCase();
		return existing.find((other) => other.toLowerCase() === folded) ?? null;
	};

	// A file the project has, unchanged since the last update, that the vault no
	// longer holds: the author deleted it, or it never arrived. "Get updates"
	// brings the whole project down, so it comes back. (One the project has
	// changed is the "removed here" question below, and is asked about instead.)
	const gone: string[] = [];
	theirs.value.forEach((blob, path) => {
		if (base.value.get(path) === blob && occupantOf(path) === null) {
			gone.push(path);
		}
	});

	// Except one the author moved or renamed: its exact bytes sit at a path the
	// project does not have, so bringing it back would leave two copies. Only
	// files the project lacks are read, and only when something is missing, so
	// an ordinary update reads nothing extra. A move that was also edited has no
	// matching bytes and comes back as the original; that cannot be told from
	// a deletion plus a new note without guessing.
	const missing: string[] = [];
	if (gone.length > 0) {
		const notes: NoteBlob[] = [];
		for (const path of existing) {
			if (theirs.value.has(path) || !canHoldMovedNote(path)) {
				continue;
			}
			const bytes = await vault.read(path);
			if (bytes !== null) {
				notes.push({ path, blob: blobId(bytes) });
			}
		}
		const absent = new Map<string, string>(gone.map((path) => [path, theirs.value.get(path) ?? ''] as [string, string]));
		const moved = movedAbsentPaths(matchMoved(absent, notes, theirs.value));
		for (const path of gone) {
			if (!moved.has(path)) {
				missing.push(path);
			}
		}
	}

	const plan: Planned[] = [];
	for (const path of changed.concat(missing).sort()) {
		const theirsBlob = theirs.value.get(path) ?? null;
		const occupant = occupantOf(path);
		const mine = occupant === null ? null : await vault.read(occupant);
		const mineBlob = mine === null ? null : blobId(mine);
		let action: Action;
		if (occupant === null && theirsBlob !== null && base.value.get(path) === theirsBlob) {
			action = { kind: 'take-theirs' };
		} else if (occupant !== null && occupant !== path && theirsBlob !== null) {
			// The project's name differs from a note only in case, which on this file
			// system is the same file: one name must not silently replace the other.
			action = mineBlob === theirsBlob ? { kind: 'nothing', row: 1 } : { kind: 'ask-two-versions' };
		} else {
			action = decide({
				base: base.value.get(path) ?? null,
				mine: mineBlob,
				theirs: theirsBlob,
				lastSent: sent.value.get(path) ?? new Set<string>(),
				text: mine !== null && isText(mine),
			});
		}
		plan.push({ path, occupant, mine, mineBlob, theirsBlob, action });
	}

	// The first update after connecting is shown first and waits for the author.
	const connected = await readRef(local, CONNECTED_REF);
	const changes = plan.filter((p) => p.action.kind !== 'nothing');
	if (connected.ok && connected.value === syncedCommit.value && changes.length > 0) {
		const counts = { download: 0, update: 0, decide: 0 };
		for (const p of changes) {
			if (p.action.kind === 'take-theirs') {
				counts[p.mine === null ? 'download' : 'update'] += 1;
			} else if (p.action.kind === 'remove-unchanged' || p.action.kind === 'merge') {
				counts.update += 1;
			} else {
				counts.decide += 1;
			}
		}
		if (!(await deps.prompts.confirmSummary(counts))) {
			return { kind: 'cancelled' };
		}
	}

	const when = stamp(deps.now());
	const out = { added: 0, updated: 0, removed: 0, skipped: [] as string[], messages: [] as string[] };
	const skip = (path: string, message: string): void => {
		out.skipped.push(path);
		out.messages.push(message);
	};
	const theirsBytes = async (p: Planned): Promise<Uint8Array | null> => (p.theirsBlob === null ? null : readBlob(local, p.theirsBlob));

	for (const p of plan) {
		if (p.action.kind === 'nothing') {
			continue;
		}
		// A path from the project is data from elsewhere: one that could leave the
		// vault, or name a settings or repository folder, is never written.
		if (!isCommittablePath(p.path)) {
			skip(p.path, AUTHOR_TEMPLATES.skippedPath(p.path));
			continue;
		}
		const target = p.occupant ?? p.path;
		if (p.mine !== null && (await vault.isUnsaved(target))) {
			skip(p.path, AUTHOR_TEMPLATES.unsavedNote(nameOf(p.path)));
			continue;
		}
		try {
			await apply(p, target);
		} catch (error) {
			console.error(`Docs Publisher: could not apply ${p.path}`, error);
			skip(p.path, AUTHOR_TEMPLATES.skippedPath(p.path));
		}
	}

	async function keepCopy(p: Planned, target: string): Promise<void> {
		if (p.mine !== null) {
			await vault.saveCopy(target, p.mine, when);
		}
	}

	async function writeTheirs(p: Planned, target: string): Promise<void> {
		const bytes = await theirsBytes(p);
		if (bytes === null) {
			throw new Error('the project\'s version could not be read');
		}
		await vault.write(target, bytes);
	}

	async function apply(p: Planned, target: string): Promise<void> {
		switch (p.action.kind) {
			case 'take-theirs':
				await writeTheirs(p, p.path);
				out[p.mine === null ? 'added' : 'updated'] += 1;
				return;
			case 'remove-unchanged':
				await vault.trash(target);
				out.removed += 1;
				return;
			case 'ask-removed-here': {
				const answer = await deps.prompts.removedHere(nameOf(p.path));
				if (answer === 'skip') {
					out.skipped.push(p.path);
				} else if (answer === 'get-back') {
					await writeTheirs(p, p.path);
					out.added += 1;
				}
				return;
			}
			case 'ask-removed-there': {
				const answer = await deps.prompts.removedThere(nameOf(p.path));
				if (answer === 'skip') {
					out.skipped.push(p.path);
				} else if (answer === 'remove') {
					await keepCopy(p, target);
					await vault.trash(target);
					out.removed += 1;
				}
				return;
			}
			case 'merge':
				await merge(p, target);
				return;
			case 'ask-two-versions':
				await twoVersions(p, target);
				return;
			default:
				return;
		}
	}

	async function merge(p: Planned, target: string): Promise<void> {
		const baseBlob = baseFiles.get(p.path);
		const baseBytes = baseBlob === undefined ? null : await readBlob(local, baseBlob);
		const theirs = await theirsBytes(p);
		if (baseBytes === null || theirs === null || p.mine === null) {
			throw new Error('a version could not be read');
		}
		const merged = await mergeText(local.git, local.cwd, baseBytes, p.mine, theirs);
		if (merged.kind === 'clean') {
			await keepCopy(p, target);
			await vault.write(target, merged.text);
			out.updated += 1;
			out.messages.push(AUTHOR_TEMPLATES.merged(nameOf(p.path)));
			return;
		}
		if (merged.kind === 'failed') {
			throw new Error('the merge could not be made');
		}
		await twoVersions(p, target);
	}

	async function twoVersions(p: Planned, target: string): Promise<void> {
		const answer = await deps.prompts.twoVersions(nameOf(p.path));
		if (answer === 'skip') {
			out.skipped.push(p.path);
		} else if (answer === 'theirs') {
			await keepCopy(p, target);
			await writeTheirs(p, target);
			out.updated += 1;
		} else if (answer === 'both') {
			const taken = new Set((await vault.allPaths()).map((q) => (insensitive ? q.toLowerCase() : q)));
			const copy = copyPath(p.path, (candidate) => taken.has(insensitive ? candidate.toLowerCase() : candidate));
			await writeTheirs(p, copy);
			out.added += 1;
		}
		// 'mine': the note is kept as it is, and reads as the author's own change from here on.
	}

	// The synced version moves to the fetched one, except for what was skipped,
	// and then HEAD follows as a fast-forward. Neither touches a file.
	const advanced = await advanceSynced(local, tip.value, out.skipped);
	if (!advanced.ok) {
		return failed(advanced.failure);
	}
	const moved = await advanceHead(local, tip.value);
	if (!moved.ok) {
		return failed(moved.failure);
	}

	const nothingChanged = out.added + out.updated + out.removed === 0 && out.messages.length === 0 && out.skipped.length === 0;
	if (nothingChanged) {
		out.messages.push(AUTHOR_MESSAGES.alreadyLatest);
	} else if (out.added + out.updated + out.removed > 0) {
		out.messages.unshift(AUTHOR_TEMPLATES.gotUpdates(out.added, out.updated, out.removed));
	}
	return { kind: 'done', added: out.added, updated: out.updated, removed: out.removed, skipped: out.skipped, messages: out.messages };
}
