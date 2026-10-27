import { beforeEach, describe, expect, it, vi } from 'vitest';
import { blobId } from '../src/git-publishing/blob-id';
import { MAX_NOTE_BYTES, NoteIdentities, READ_BATCH, isCandidateNote } from '../src/submission-tracking/note-identities';
import type { NoteFile } from '../src/submission-tracking/note-identities';

const file = (path: string, mtime = 1, size = 5): NoteFile => ({ path, stat: { mtime, size } });
const bytes = (text: string): Uint8Array => new Uint8Array(Buffer.from(text));

let contents: Record<string, string>;
let reads: string[];
let identities: NoteIdentities;

beforeEach(() => {
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
	contents = { 'a.md': 'alpha', 'b.md': 'beta' };
	reads = [];
	identities = new NoteIdentities(async (path) => {
		reads.push(path);
		if (contents[path] === undefined) {
			throw new Error('gone');
		}
		return bytes(contents[path]);
	});
});

describe('the content identifier of each note', () => {
	it('is unknown until the note has been read', () => {
		expect(identities.get(file('a.md'))).toBeNull();
	});

	it('is the identifier git would give the bytes, once read', async () => {
		await identities.ensure([file('a.md')]);

		expect(identities.get(file('a.md'))).toBe(blobId(Buffer.from('alpha')));
	});

	it('is read once for a note that has not changed, however often it is asked for', async () => {
		await identities.ensure([file('a.md')]);
		await identities.ensure([file('a.md')]);
		await identities.ensure([file('a.md')]);

		expect(reads).toEqual(['a.md']);
	});

	it('is read again when the note\'s time or size has changed, and the old answer is not given meanwhile', async () => {
		await identities.ensure([file('a.md', 1, 5)]);
		contents['a.md'] = 'alpha, edited';

		expect(identities.get(file('a.md', 2, 13))).toBeNull();
		await identities.ensure([file('a.md', 2, 13)]);

		expect(identities.get(file('a.md', 2, 13))).toBe(blobId(Buffer.from('alpha, edited')));
		expect(reads).toEqual(['a.md', 'a.md']);
	});

	it('stays unknown for a note that cannot be read, and the others are still read', async () => {
		await identities.ensure([file('missing.md'), file('b.md')]);

		expect(identities.get(file('missing.md'))).toBeNull();
		expect(identities.get(file('b.md'))).toBe(blobId(Buffer.from('beta')));
	});

	it('does not reject for a note that cannot be read', async () => {
		await expect(identities.ensure([file('missing.md')])).resolves.toBeUndefined();
	});
});

describe('telling the panel there is something new', () => {
	it('says so once when something was read, and not when nothing was', async () => {
		let heard = 0;
		identities.onChange(() => {
			heard += 1;
		});

		await identities.ensure([file('a.md'), file('b.md')]);
		await identities.ensure([file('a.md'), file('b.md')]);

		expect(heard).toBe(1);
	});

	it('does not say anything to a listener that has stopped listening', async () => {
		let heard = 0;
		const stop = identities.onChange(() => {
			heard += 1;
		});
		stop();

		await identities.ensure([file('a.md')]);

		expect(heard).toBe(0);
	});
});

describe('a burst of requests', () => {
	it('runs one pass and then one more, and the later request\'s notes are not lost', async () => {
		let release: () => void = () => undefined;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		let first = true;
		identities = new NoteIdentities(async (path) => {
			reads.push(path);
			if (first) {
				first = false;
				await held;
			}
			return bytes(contents[path] ?? '');
		});

		const one = identities.ensure([file('a.md')]);
		const two = identities.ensure([file('a.md'), file('b.md')]);
		release();
		await Promise.all([one, two]);

		expect(identities.get(file('a.md'))).not.toBeNull();
		expect(identities.get(file('b.md'))).not.toBeNull();
	});
});

describe('notes that leave the vault', () => {
	it('are forgotten, so a note recreated at the same path is read afresh', async () => {
		await identities.ensure([file('a.md')]);

		identities.retain(new Set(['b.md']));

		expect(identities.get(file('a.md'))).toBeNull();
	});
});

describe('which files are candidates', () => {
	it.each([
		['a.md', true],
		['L1/deep/a.MD', true],
		['image.png', false],
		['.obsidian/notes.md', false],
		['.git/notes.md', false],
		['.claudian/notes.md', false],
		['folder/.draft/notes.md', false],
	])('%s: %s', (path, expected) => {
		expect(isCandidateNote(path)).toBe(expected);
	});
});

describe('a large vault', () => {
	it('lists the notes whose identifier is known, and not the others', async () => {
		await identities.ensure([file('a.md')]);

		expect(identities.identified([file('a.md'), file('b.md')])).toEqual([{ path: 'a.md', blob: blobId(Buffer.from('alpha')) }]);
	});

	it('leaves a note over the size limit unread and unknown', async () => {
		await identities.ensure([file('a.md', 1, MAX_NOTE_BYTES + 1), file('b.md')]);

		expect(reads).toEqual(['b.md']);
		expect(identities.get(file('a.md', 1, MAX_NOTE_BYTES + 1))).toBeNull();
	});

	it('tells the panel after each batch, so the list fills in while the rest is read', async () => {
		const many = Array.from({ length: READ_BATCH * 2 + 1 }, (_, i) => file(`n${i}.md`));
		identities = new NoteIdentities(async () => bytes('x'));
		let heard = 0;
		identities.onChange(() => {
			heard += 1;
		});

		await identities.ensure(many);

		expect(heard).toBe(3);
		expect(identities.identified(many)).toHaveLength(many.length);
	});
});
