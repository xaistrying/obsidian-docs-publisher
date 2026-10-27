import { describe, expect, it } from 'vitest';
import { canHoldMovedNote, matchMoved, movedAbsentPaths } from '../src/vault-sync/moved-notes';

const map = (entries: Array<[string, string]>): Map<string, string> => new Map(entries);

describe('matching an absent project file to a moved note', () => {
	it('matches a note whose exact bytes sit at a path the project lacks', () => {
		const project = map([['docs/a.md', 'blob-a']]);
		const matches = matchMoved(map([['docs/a.md', 'blob-a']]), [{ path: 'archive/a.md', blob: 'blob-a' }], project);

		expect(matches.byAbsent.get('docs/a.md')).toEqual(['archive/a.md']);
		expect(matches.byNote.get('archive/a.md')).toEqual(['docs/a.md']);
	});

	it('does not match a note edited after the move, because only exact bytes count', () => {
		const matches = matchMoved(map([['docs/a.md', 'blob-a']]), [{ path: 'archive/a.md', blob: 'blob-a-edited' }], map([['docs/a.md', 'blob-a']]));

		expect(matches.byAbsent.size).toBe(0);
		expect(matches.byNote.size).toBe(0);
	});

	it('ignores a note already at a path the project holds', () => {
		const project = map([
			['docs/a.md', 'blob-a'],
			['docs/b.md', 'blob-a'],
		]);
		const matches = matchMoved(map([['docs/a.md', 'blob-a']]), [{ path: 'docs/b.md', blob: 'blob-a' }], project);

		expect(matches.byAbsent.size).toBe(0);
	});

	it('ignores a note under a hidden or reserved folder', () => {
		const matches = matchMoved(
			map([['docs/a.md', 'blob-a']]),
			[
				{ path: '.hidden/a.md', blob: 'blob-a' },
				{ path: '.obsidian/a.md', blob: 'blob-a' },
			],
			map([['docs/a.md', 'blob-a']])
		);

		expect(matches.byAbsent.size).toBe(0);
	});

	it('reports every note holding the bytes, so the caller can decide what two candidates mean', () => {
		const matches = matchMoved(
			map([['docs/a.md', 'blob-a']]),
			[
				{ path: 'x/a.md', blob: 'blob-a' },
				{ path: 'y/a.md', blob: 'blob-a' },
			],
			map([['docs/a.md', 'blob-a']])
		);

		expect(matches.byAbsent.get('docs/a.md')).toEqual(['x/a.md', 'y/a.md']);
	});

	it('reports every absent path a note matches, when two absent files hold the same bytes', () => {
		const matches = matchMoved(
			map([
				['docs/a.md', 'blob-same'],
				['docs/b.md', 'blob-same'],
			]),
			[{ path: 'new/a.md', blob: 'blob-same' }],
			map([
				['docs/a.md', 'blob-same'],
				['docs/b.md', 'blob-same'],
			])
		);

		expect(matches.byNote.get('new/a.md')).toEqual(['docs/a.md', 'docs/b.md']);
	});

	it('lists the absent paths that were moved, and not the others', () => {
		const matches = matchMoved(
			map([
				['docs/a.md', 'blob-a'],
				['docs/b.md', 'blob-b'],
			]),
			[{ path: 'archive/a.md', blob: 'blob-a' }],
			map([
				['docs/a.md', 'blob-a'],
				['docs/b.md', 'blob-b'],
			])
		);

		expect(Array.from(movedAbsentPaths(matches))).toEqual(['docs/a.md']);
	});

	it('finds nothing when nothing is absent', () => {
		expect(matchMoved(new Map(), [{ path: 'a.md', blob: 'x' }], new Map()).byNote.size).toBe(0);
	});
});

describe('where a moved note can have gone', () => {
	it.each([
		['archive/a.md', true],
		['a.md', true],
		['.obsidian/plugins/a.md', false],
		['.git/a.md', false],
		['.claudian/a.md', false],
		['notes/.draft/a.md', false],
	])('%s: %s', (path, expected) => {
		expect(canHoldMovedNote(path)).toBe(expected);
	});
});
