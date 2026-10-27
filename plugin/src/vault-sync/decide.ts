/**
 * What to do about one path, from three versions of it
 * (replace-rest-with-local-git-ssh design.md D9; vault-sync "Each changed file is
 * decided by comparing the note, the last synced version and the new version").
 *
 * Pure: it is given content identifiers and nothing else, which is what lets
 * every row of the table be a test. An absent file is `null`. Identifiers are
 * compared exactly, with no line-ending or other filter.
 *
 * `base` is the last synced version, `mine` the note as it is now, `theirs` the
 * fetched version, and `lastSent` the identifiers this vault last committed for
 * the path. Only called for a path where base and theirs differ.
 */
export type Action =
	/** Rows 1 and 2: nothing to write. */
	| { kind: 'nothing'; row: 1 | 2 }
	/** Row 3: the note is unchanged, so take the project's version, or trash the note if it is gone. */
	| { kind: 'take-theirs' }
	| { kind: 'remove-unchanged' }
	/** Row 4: removed here, changed there. */
	| { kind: 'ask-removed-here' }
	/** Row 5: changed here, removed there. */
	| { kind: 'ask-removed-there' }
	/** Rows 6 and 8: two different versions with nothing to merge against, or not text. */
	| { kind: 'ask-two-versions' }
	/** Row 7: three present, different versions of a text; a merge is attempted first. */
	| { kind: 'merge' };

export interface Versions {
	base: string | null;
	mine: string | null;
	theirs: string | null;
	lastSent: ReadonlySet<string>;
	/** Whether the file can be merged as text. Only consulted for row 7. */
	text: boolean;
}

export function decide(v: Versions): Action {
	// 1. The note already is the new version, both present and equal or both absent.
	if (v.mine === v.theirs) {
		return { kind: 'nothing', row: 1 };
	}
	// 2. The new version is what this vault sent: the author's own change coming back.
	if (v.theirs !== null && v.lastSent.has(v.theirs)) {
		return { kind: 'nothing', row: 2 };
	}
	// 3. The note is as it was last synced, so the project's change is simply taken.
	if (v.mine === v.base) {
		return v.theirs === null ? { kind: 'remove-unchanged' } : { kind: 'take-theirs' };
	}
	// From here the author changed the note, or removed it, or never had it.
	if (v.mine === null) {
		// 4. Removed here; the project changed it (base and theirs both present and different).
		return v.base !== null && v.theirs !== null ? { kind: 'ask-removed-here' } : { kind: 'ask-two-versions' };
	}
	if (v.theirs === null) {
		// 5. Changed here; removed there.
		return { kind: 'ask-removed-there' };
	}
	if (v.base === null) {
		// 6. Both added the same path with different content.
		return { kind: 'ask-two-versions' };
	}
	// 7 and 8. All three present and different.
	return v.text ? { kind: 'merge' } : { kind: 'ask-two-versions' };
}
