import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decide } from '../src/vault-sync/decide';
import type { Versions } from '../src/vault-sync/decide';
import { isText, mergeText } from '../src/vault-sync/merge-text';
import { createLocalRemote } from './support/local-remote';
import type { LocalRemote } from './support/local-remote';

const none = new Set<string>();
const v = (over: Partial<Versions>): Versions => ({ base: 'B', mine: 'M', theirs: 'T', lastSent: none, text: true, ...over });

// Every row of the table in design D9, in the order it is tried.
describe('deciding one path', () => {
	it('row 1: does nothing when the note already is the new version', () => {
		expect(decide(v({ mine: 'T' }))).toEqual({ kind: 'nothing', row: 1 });
	});

	it('row 1: does nothing when both are absent', () => {
		expect(decide(v({ mine: null, theirs: null }))).toEqual({ kind: 'nothing', row: 1 });
	});

	it('row 2: does nothing when the new version is what this vault sent, even after the note was edited again', () => {
		expect(decide(v({ lastSent: new Set(['T']) }))).toEqual({ kind: 'nothing', row: 2 });
	});

	it('row 2 does not apply to a version this vault did not send', () => {
		expect(decide(v({ lastSent: new Set(['other']) })).kind).toBe('merge');
	});

	it('row 3: takes the project\'s version when the note is as last synced', () => {
		expect(decide(v({ mine: 'B' }))).toEqual({ kind: 'take-theirs' });
	});

	it('row 3: takes a new file when the base and the note are both absent', () => {
		expect(decide(v({ base: null, mine: null }))).toEqual({ kind: 'take-theirs' });
	});

	it('row 3: removes an unchanged note the project removed', () => {
		expect(decide(v({ mine: 'B', theirs: null }))).toEqual({ kind: 'remove-unchanged' });
	});

	it('row 4: asks when the note was removed here and the project changed it', () => {
		expect(decide(v({ mine: null }))).toEqual({ kind: 'ask-removed-here' });
	});

	it('row 5: asks when the note was changed here and the project removed it', () => {
		expect(decide(v({ theirs: null }))).toEqual({ kind: 'ask-removed-there' });
	});

	it('row 6: asks, with three choices, when both added the same path differently', () => {
		expect(decide(v({ base: null }))).toEqual({ kind: 'ask-two-versions' });
	});

	it('row 7: tries a merge when all three are present, different and text', () => {
		expect(decide(v({}))).toEqual({ kind: 'merge' });
	});

	it('row 8: asks, with three choices, when all three differ and the file is not text', () => {
		expect(decide(v({ text: false }))).toEqual({ kind: 'ask-two-versions' });
	});

	it('takes the rows in order: row 1 wins over row 3, and row 2 over row 3', () => {
		expect(decide(v({ base: 'B', mine: 'B', theirs: 'B' })).kind).toBe('nothing');
		expect(decide(v({ mine: 'B', lastSent: new Set(['T']) }))).toEqual({ kind: 'nothing', row: 2 });
	});
});

describe('what counts as text', () => {
	it('is valid UTF-8 without a NUL', () => {
		expect(isText(new TextEncoder().encode('Trần Phạm\r\nline\n'))).toBe(true);
		expect(isText(new Uint8Array([0, 1, 2]))).toBe(false);
		expect(isText(new Uint8Array([0xff, 0xfe, 0x41]))).toBe(false);
		expect(isText(new Uint8Array())).toBe(true);
	});
});

describe('merging two edits of a text', () => {
	let remote: LocalRemote;
	let cwd: string;
	beforeEach(() => {
		remote = createLocalRemote({ empty: true });
		cwd = mkdtempSync(join(tmpdir(), 'merge-'));
	});
	afterEach(() => {
		remote.dispose();
		rmSync(cwd, { recursive: true, force: true });
	});
	const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
	const dec = (b: Uint8Array): string => new TextDecoder().decode(b);
	const base = 'one\n\ntwo\n\nthree\n\nfour\n\nfive\n';

	it('combines edits to different paragraphs', async () => {
		const result = await mergeText(remote.runner(), cwd, enc(base), enc(base.replace('one', 'ONE (mine)')), enc(base.replace('five', 'FIVE (theirs)')));

		expect(result.kind).toBe('clean');
		expect(result.kind === 'clean' && dec(result.text)).toBe(base.replace('one', 'ONE (mine)').replace('five', 'FIVE (theirs)'));
	});

	it('keeps Windows line endings', async () => {
		const crlf = base.replace(/\n/g, '\r\n');
		const result = await mergeText(remote.runner(), cwd, enc(crlf), enc(crlf.replace('one', 'ONE')), enc(crlf.replace('five', 'FIVE')));

		expect(result.kind === 'clean' && dec(result.text)).toBe(crlf.replace('one', 'ONE').replace('five', 'FIVE'));
	});

	it('reports an overlap, and gives back no text with a marker in it', async () => {
		const result = await mergeText(remote.runner(), cwd, enc(base), enc(base.replace('three', 'mine')), enc(base.replace('three', 'theirs')));

		expect(result).toEqual({ kind: 'overlap' });
	});

	it('does not try to merge what is not text', async () => {
		const result = await mergeText(remote.runner(), cwd, new Uint8Array([0, 1]), new Uint8Array([0, 2]), new Uint8Array([0, 3]));

		expect(result).toEqual({ kind: 'not-text' });
	});

	it('fails, rather than guess, when git cannot be run', async () => {
		const broken = { run: async () => ({ exitCode: null, stdout: Buffer.alloc(0), stderr: '', timedOut: false, truncated: false, spawnError: 'ENOENT' }) };

		expect(await mergeText(broken, cwd, enc(base), enc(base + 'a'), enc(base + 'b'))).toEqual({ kind: 'failed' });
	});
});
