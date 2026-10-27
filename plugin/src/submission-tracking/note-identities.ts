import { blobId } from '../git-publishing/blob-id';
import { isHiddenPath, isReservedPath } from '../git-publishing/ref-names';

/** What the cache needs to know about a note. A `TFile` satisfies it. */
export interface NoteFile {
	path: string;
	stat: { mtime: number; size: number };
}

type Listener = () => void;

/** How many notes are read before the panel is told and the event loop gets a turn. */
export const READ_BATCH = 50;

/** A note larger than this is not read: it is not a document someone wrote by hand, and reading it is the cost this cache exists to bound. */
export const MAX_NOTE_BYTES = 2 * 1024 * 1024;

/**
 * Whether a file is a note that could matter to the panel: markdown, not under a
 * hidden folder, not under the settings or repository folders
 * (panel-by-path-without-doc-id design.md D6). Only these are ever read.
 */
export function isCandidateNote(path: string): boolean {
	return /\.md$/i.test(path) && !isHiddenPath(path) && !isReservedPath(path);
}

const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * The content identifier of each note, kept so that drawing the panel can tell
 * an edited note from an unedited one without reading a file or starting a
 * process (replace-rest-with-local-git-ssh design.md D4).
 *
 * `get` is synchronous and answers from what was computed; `ensure` computes
 * what is missing or has changed on disk, and tells the listeners when it found
 * anything new so the panel can draw once more. A note whose identifier is not
 * known yet is not edited, which is the safe way to be wrong: an unestablished
 * difference reported for every note at once would swamp the list.
 *
 * Keyed by a note's modification time and size, so a note is read again exactly
 * when it has changed. Every candidate note is covered, not only those with an
 * identity property, because the panel needs the identifier of notes that were
 * never sent to match a moved one; so reading is lazy and bounded. It runs in
 * batches, telling the listeners after each so the panel fills in as it goes,
 * yields between batches so a vault of thousands of notes does not hold the
 * editor, and leaves a note over `MAX_NOTE_BYTES` unknown.
 */
export class NoteIdentities {
	private readonly known = new Map<string, { version: string; id: string }>();
	private readonly listeners = new Set<Listener>();
	private ensuring = false;
	private again = false;
	private latest: readonly NoteFile[] = [];

	constructor(private readonly read: (path: string) => Promise<Uint8Array>) {}

	private static versionOf(file: NoteFile): string {
		return `${file.stat.mtime}:${file.stat.size}`;
	}

	/** The identifier of the note as it was last read, or null when it has not been read, or has changed since. */
	get(file: NoteFile): string | null {
		const entry = this.known.get(file.path);
		return entry !== undefined && entry.version === NoteIdentities.versionOf(file) ? entry.id : null;
	}

	/** The notes whose identifier is known, as path and identifier: what a move is matched against. */
	identified(files: readonly NoteFile[]): Array<{ path: string; blob: string }> {
		const notes: Array<{ path: string; blob: string }> = [];
		for (const file of files) {
			const id = this.get(file);
			if (id !== null) {
				notes.push({ path: file.path, blob: id });
			}
		}
		return notes;
	}

	/**
	 * Reads every note that is missing or stale. Overlapping calls are folded
	 * into one run followed by one more, so a burst of edits is not a burst of
	 * reads. Never rejects: a note that cannot be read stays unknown.
	 */
	async ensure(files: readonly NoteFile[]): Promise<void> {
		// The newest list wins: a call that arrives mid-run replaces what the
		// run will look at next, and is not lost.
		this.latest = files;
		if (this.ensuring) {
			this.again = true;
			return;
		}
		this.ensuring = true;
		try {
			do {
				this.again = false;
				let changed = false;
				let reads = 0;
				for (const file of this.latest) {
					if (this.get(file) !== null || file.stat.size > MAX_NOTE_BYTES) {
						continue;
					}
					const version = NoteIdentities.versionOf(file);
					try {
						const id = blobId(await this.read(file.path));
						this.known.set(file.path, { version, id });
						changed = true;
					} catch (error) {
						console.error(`Docs Publisher: could not read ${file.path} to compare it`, error);
					}
					reads += 1;
					if (reads % READ_BATCH === 0) {
						// The panel fills in as it goes, and the editor gets a turn.
						if (changed) {
							this.notify();
							changed = false;
						}
						await yieldToEventLoop();
					}
				}
				if (changed) {
					this.notify();
				}
			} while (this.again);
		} finally {
			this.ensuring = false;
		}
	}

	/** Forgets notes that are no longer in the vault. */
	retain(paths: ReadonlySet<string>): void {
		for (const path of Array.from(this.known.keys())) {
			if (!paths.has(path)) {
				this.known.delete(path);
			}
		}
	}

	onChange(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	private notify(): void {
		for (const listener of [...this.listeners]) {
			listener();
		}
	}
}
