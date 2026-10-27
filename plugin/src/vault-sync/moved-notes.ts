import { isHiddenPath, isReservedPath } from '../git-publishing/ref-names';

/**
 * Which absent files are really notes that were moved or renamed
 * (panel-by-path-without-doc-id design.md D7).
 *
 * A file the project holds that the vault no longer has, whose exact bytes sit
 * in the vault at a path the project lacks, has been moved. Exact bytes only: a
 * move that was also edited has no match and reads as a deletion plus a new
 * note, because telling them apart would be guessing. One matcher serves Get
 * updates (which must not bring the original back) and the panel (which must not
 * count it as an update and must show the note as moved), so the two cannot
 * disagree.
 */
export interface NoteBlob {
	/** The note's path in the vault. */
	path: string;
	/** Its content identifier. */
	blob: string;
}

export interface MovedMatches {
	/** An absent project path, to every note at a path the project lacks that holds its exact bytes. */
	byAbsent: ReadonlyMap<string, readonly string[]>;
	/** A note's path, to every absent project path whose exact bytes it holds. */
	byNote: ReadonlyMap<string, readonly string[]>;
}

/** Whether a vault path can be the new home of a moved note: not under the settings or repository folders, not hidden. */
export function canHoldMovedNote(path: string): boolean {
	return !isReservedPath(path) && !isHiddenPath(path);
}

/**
 * @param absent the files the project holds that the vault does not, as project path to content identifier
 * @param notes the vault's files, with the identifiers known so far; a file without one is not in the list
 * @param project every path the project holds: a note already at one of these is not a moved note
 */
export function matchMoved(absent: ReadonlyMap<string, string>, notes: readonly NoteBlob[], project: ReadonlyMap<string, string>): MovedMatches {
	const byAbsent = new Map<string, string[]>();
	const byNote = new Map<string, string[]>();
	const absentByBlob = new Map<string, string[]>();
	absent.forEach((blob, path) => {
		absentByBlob.set(blob, [...(absentByBlob.get(blob) ?? []), path]);
	});
	for (const note of notes) {
		if (project.has(note.path) || !canHoldMovedNote(note.path)) {
			continue;
		}
		for (const path of absentByBlob.get(note.blob) ?? []) {
			byAbsent.set(path, [...(byAbsent.get(path) ?? []), note.path]);
			byNote.set(note.path, [...(byNote.get(note.path) ?? []), path]);
		}
	}
	return { byAbsent, byNote };
}

/** The absent paths that have been moved, which Get updates must not restore. */
export function movedAbsentPaths(matches: MovedMatches): Set<string> {
	return new Set(matches.byAbsent.keys());
}
