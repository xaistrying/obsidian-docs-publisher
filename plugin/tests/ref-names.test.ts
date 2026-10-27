import { describe, expect, it } from 'vitest';
import { deriveDocId, deriveDocIdFromPath } from '../src/doc-authoring/doc-id';
import {
	CONNECTED_REF,
	SYNCED_REF,
	docIdOfSentRef,
	documentBranch,
	fetchedBranchRef,
	fetchedDefaultRef,
	isHiddenPath,
	isReservedPath,
	isValidRefPart,
	sentRef,
} from '../src/git-publishing/ref-names';

describe('what may be one part of a ref name', () => {
	for (const good of ['Printer', 'SBT-KE-001_EG95-mTLS-Socket', 'a.b', 'v1.2', 'a/b', 'x'.repeat(200)]) {
		it(`accepts ${good.slice(0, 30)}`, () => {
			expect(isValidRefPart(good)).toBe(true);
		});
	}

	const bad: Array<[string, string]> = [
		['empty', ''],
		['a space', 'a b'],
		['a tab', 'a\tb'],
		['a line break', 'a\nb'],
		['a NUL', 'a\0b'],
		['a delete character', 'a\u007fb'],
		['..', 'a..b'],
		['@{', 'a@{1}'],
		['a lone @', '@'],
		['a leading dot', '.hidden'],
		['a leading dash, which a command would read as an option', '-rf'],
		['a leading slash', '/a'],
		['a trailing dot', 'a.'],
		['a trailing slash', 'a/'],
		['.lock', 'a.lock'],
		['.lock in a folder', 'a.lock/b'],
		['a hidden folder part', 'a/.b'],
		['an empty part', 'a//b'],
		['~', 'a~1'],
		['^', 'a^'],
		[':', 'a:b'],
		['?', 'a?'],
		['*', 'a*'],
		['[', 'a[0]'],
		['a backslash', 'a\\b'],
		['more than 200 characters', 'x'.repeat(201)],
	];
	for (const [label, value] of bad) {
		it(`refuses ${label}`, () => {
			expect(isValidRefPart(value)).toBe(false);
		});
	}
});

describe('the names of the refs', () => {
	it('puts each kind where the design says', () => {
		expect(SYNCED_REF).toBe('refs/docs-publisher/synced');
		expect(CONNECTED_REF).toBe('refs/docs-publisher/connected');
		expect(sentRef('Printer')).toBe('refs/docs-publisher/sent/Printer');
		expect(fetchedBranchRef('Printer')).toBe('refs/remotes/origin/doc/Printer');
		expect(fetchedDefaultRef('main')).toBe('refs/remotes/origin/main');
		expect(documentBranch('Printer')).toBe('doc/Printer');
	});

	it('refuses to build any of them from an identity that is not usable', () => {
		for (const build of [sentRef, fetchedBranchRef, documentBranch]) {
			expect(() => build('a b')).toThrow(/not usable/);
			expect(() => build('-x')).toThrow(/not usable/);
		}
		expect(() => fetchedDefaultRef('--upload-pack=x')).toThrow(/not usable/);
	});

	it('reads the identity back out of a sent ref, and nothing out of any other', () => {
		expect(docIdOfSentRef(sentRef('Printer'))).toBe('Printer');
		expect(docIdOfSentRef(SYNCED_REF)).toBeNull();
		expect(docIdOfSentRef('refs/heads/doc/Printer')).toBeNull();
	});
});

describe('the folders the plugin never reads', () => {
	it('are the settings folder and the repository folder, at any depth under them', () => {
		expect(isReservedPath('.obsidian')).toBe(true);
		expect(isReservedPath('.obsidian/app.json')).toBe(true);
		expect(isReservedPath('.git/config')).toBe(true);
		expect(isReservedPath('.git')).toBe(true);
	});

	it('are not a note that merely has the name in it', () => {
		expect(isReservedPath('Docs/.obsidian/x.md')).toBe(false);
		expect(isReservedPath('.obsidianx/a.md')).toBe(false);
		expect(isReservedPath('Docs/a.md')).toBe(false);
	});
});

describe('the hidden files the plugin never compares', () => {
	it('are any file or folder whose name starts with a dot, at any depth', () => {
		expect(isHiddenPath('.claudian/settings.json')).toBe(true);
		expect(isHiddenPath('Docs/.cache/x.md')).toBe(true);
		expect(isHiddenPath('Docs/.hidden.md')).toBe(true);
		expect(isHiddenPath('.gitignore')).toBe(true);
	});

	it('are not a note with a dot elsewhere in its name', () => {
		expect(isHiddenPath('Docs/a.b.md')).toBe(false);
		expect(isHiddenPath('Docs/v1.2/a.md')).toBe(false);
		expect(isHiddenPath('a.md')).toBe(false);
	});
});

// The author's own rule for a filename and git's rule for a ref are one rule,
// applied once when an identity is made and again when one is read from a note.
describe('an identity made from a file name', () => {
	it('folds Vietnamese letters and keeps a name git accepts', () => {
		expect(deriveDocId('Hướng dẫn')).toBeNull(); // a space is not allowed
		expect(deriveDocId('Hướng-dẫn_Đường')).toBe('Huong-dan_Duong');
	});

	it('refuses a name git would read differently, which the older filename rule let through', () => {
		expect(deriveDocId('a..b')).toBeNull();
		expect(deriveDocId('a@{1}')).toBeNull();
		expect(deriveDocId('-draft')).toBeNull();
		expect(deriveDocId('notes.')).toBeNull();
	});

	it('finds the identity a remote path\'s file name derives', () => {
		expect(deriveDocIdFromPath('Docs/Hướng dẫn/Mạng.md')).toBe('Mang');
		expect(deriveDocIdFromPath('a/b/.gitkeep')).toBeNull();
	});
});
