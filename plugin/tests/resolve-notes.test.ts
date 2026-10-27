import { sendDefaults } from './support/send-defaults';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { planAndSend } from '../src/doc-authoring/submit-plan';
import type { SubmitContext } from '../src/doc-authoring/submit-plan';
import { blobId } from '../src/git-publishing/blob-id';
import { fetchProject, readRef, sentNote } from '../src/git-publishing/repo';
import type { RepoContext } from '../src/git-publishing/repo';
import { sentRef } from '../src/git-publishing/ref-names';
import { deriveStates } from '../src/submission-tracking/derive-state';
import type { DerivedStates } from '../src/submission-tracking/derive-state';
import { isOnProject, resolveNotes } from '../src/submission-tracking/resolve-notes';
import type { NoteToResolve } from '../src/submission-tracking/resolve-notes';
import { connectReceived } from './support/connect-received';
import { createLocalRemote } from './support/local-remote';
import type { LocalRemote } from './support/local-remote';

let remote: LocalRemote;
let vault: string;
let ctx: RepoContext;

const ME = { name: 'Ana Nguyen', email: 'ana@example.com' };
const NOTE = '---\nowner: ana\n---\nThe note\n';
const text = (s: string): string => blobId(Buffer.from(s));

beforeEach(() => {
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
	remote = createLocalRemote();
	vault = mkdtempSync(join(tmpdir(), 'vault-'));
	ctx = { git: remote.runner(), cwd: vault };
	remote.setHook('pre-receive', 'echo "View merge request for doc/x:" >&2\necho "  https://gitlab.example.com/docs/kb/-/merge_requests/1" >&2');
});
afterEach(() => {
	remote.dispose();
	rmSync(vault, { recursive: true, force: true });
	vi.restoreAllMocks();
});

async function derive(context: RepoContext = ctx, legacy: string[] = []): Promise<DerivedStates> {
	await fetchProject(context, remote.address);
	const states = await deriveStates(context, legacy);
	if (!states.ok || states.value === null) {
		throw new Error('nothing derived');
	}
	return states.value;
}

function note(path: string, contents: string | null, legacyDocId: string | null = null): NoteToResolve {
	return { path, blob: contents === null ? null : text(contents), legacyDocId };
}

const submitContext = (): SubmitContext => ({ local: ctx, network: ctx, address: remote.address, identity: ME });

/** A real first send of `notePath`, the way Submit makes one. */
async function sendNew(notePath: string, basename: string): Promise<void> {
	const result = await planAndSend(submitContext(), {
		notePath,
		basename,
		noteText: NOTE,
		existingDocId: null,
		fields: null,
		title: basename,
		attachments: [],
		...sendDefaults(notePath),
	});
	if (result.kind !== 'sent') {
		throw new Error(`expected a send, got ${JSON.stringify(result)}`);
	}
}

/** Every path in the vault, which resolution reads as "present". */
const vaultOf = (...paths: string[]): ReadonlySet<string> => new Set(paths);

describe('a note at a path the project holds', () => {
	beforeEach(async () => {
		remote.publish('main', { 'Docs/Printer.md': 'v1' });
		await connectReceived(ctx, remote.address);
	});

	it('is that document, with no identity property in the note', async () => {
		const states = await derive();

		const resolved = resolveNotes(states, [note('Docs/Printer.md', 'v1')], vaultOf('Docs/Printer.md'));

		expect(resolved.get('Docs/Printer.md')).toEqual({ docId: 'Printer', via: 'project-path', moved: false });
		expect(states.documents.get('Printer')?.state).toBe('published');
	});

	it('is a different document than the legacy property says when the property is there, because the property wins', async () => {
		const states = await derive(ctx, ['Other']);

		const resolved = resolveNotes(states, [note('Docs/Printer.md', 'v1', 'Other')], vaultOf('Docs/Printer.md'));

		expect(resolved.get('Docs/Printer.md')).toMatchObject({ docId: 'Other', via: 'doc-id' });
	});

	it('is known to be on the project', async () => {
		const states = await derive();

		expect(isOnProject(states.index, 'Docs/Printer.md')).toBe(true);
		expect(isOnProject(states.index, 'Docs/Other.md')).toBe(false);
	});

	it('is none when two paths on the project derive one identity, because which is the document cannot be told', async () => {
		remote.publish('main', { 'A/Same.md': 'one', 'B/Same.md': 'two' });
		const states = await derive();

		expect(resolveNotes(states, [note('A/Same.md', 'one')], vaultOf('A/Same.md', 'B/Same.md')).size).toBe(0);
	});
});

describe('a note a send from this vault touched', () => {
	beforeEach(async () => {
		await connectReceived(ctx, remote.address);
		await sendNew('Docs/Guide.md', 'Guide');
	});

	it('is that document by the send record, though the project does not have it', async () => {
		const states = await derive();

		const resolved = resolveNotes(states, [note('Docs/Guide.md', NOTE)], vaultOf('Docs/Guide.md'));

		expect(resolved.get('Docs/Guide.md')).toEqual({ docId: 'Guide', via: 'send-record', moved: false });
		expect(states.documents.get('Guide')?.state).toBe('pending');
	});

	it('reads the record\'s path from the commit it points at, and stores nothing', async () => {
		const commit = await readRef(ctx, sentRef('Guide'));
		if (!commit.ok || commit.value === null) {
			throw new Error('no record');
		}

		const found = await sentNote(ctx, commit.value);

		expect(found).toEqual({ ok: true, value: { path: 'Docs/Guide.md', blob: text(NOTE) } });
	});

	it('keeps its path in the send record when a later send changed only an image, so the review is not lost to the panel', async () => {
		const result = await planAndSend(submitContext(), {
			notePath: 'Docs/Guide.md',
			basename: 'Guide',
			noteText: NOTE,
			existingDocId: null,
			fields: null,
			title: 'Guide',
			attachments: [{ path: 'img/a.png', bytes: new Uint8Array([1, 2, 3]) }],
			...sendDefaults('Docs/Guide.md'),
		});
		expect(result.kind).toBe('sent');
		const commit = await readRef(ctx, sentRef('Guide'));
		if (!commit.ok || commit.value === null) {
			throw new Error('no record');
		}

		const found = await sentNote(ctx, commit.value);
		const states = await derive();

		expect(found).toEqual({ ok: true, value: { path: 'Docs/Guide.md', blob: text(NOTE) } });
		expect(resolveNotes(states, [note('Docs/Guide.md', NOTE)], vaultOf('Docs/Guide.md')).get('Docs/Guide.md')).toMatchObject({
			docId: 'Guide',
			via: 'send-record',
		});
	});

	it('is the same document after a rename, found by its exact bytes, and is shown as moved', async () => {
		const states = await derive();

		const resolved = resolveNotes(states, [note('Archive/Renamed.md', NOTE)], vaultOf('Archive/Renamed.md'));

		expect(resolved.get('Archive/Renamed.md')).toEqual({ docId: 'Guide', via: 'content', moved: true });
	});

	it('is nothing after a rename that also edited it, because only exact bytes are matched', async () => {
		const states = await derive();

		expect(resolveNotes(states, [note('Archive/Renamed.md', `${NOTE}more\n`)], vaultOf('Archive/Renamed.md')).size).toBe(0);
	});

	it('is nothing on a second vault that never sent it, which shows no move it never saw', async () => {
		const other = mkdtempSync(join(tmpdir(), 'vault-'));
		try {
			const second: RepoContext = { git: remote.runner(), cwd: other };
			await connectReceived(second, remote.address);
			const states = await derive(second);

			expect(states.index.sentNotes.size).toBe(0);
			expect(resolveNotes(states, [note('Archive/Renamed.md', NOTE)], vaultOf('Archive/Renamed.md')).size).toBe(0);
		} finally {
			rmSync(other, { recursive: true, force: true });
		}
	});
});

describe('a published note that was moved without being edited', () => {
	beforeEach(async () => {
		remote.publish('main', { 'Docs/Printer.md': 'v1' });
		await connectReceived(ctx, remote.address);
	});

	it('is the same document at its new path, and is shown as moved', async () => {
		const states = await derive();

		const resolved = resolveNotes(states, [note('Archive/Printer.md', 'v1')], vaultOf('Archive/Printer.md'));

		expect(resolved.get('Archive/Printer.md')).toEqual({ docId: 'Printer', via: 'content', moved: true });
	});

	it('is not matched while the old path is still in the vault, because then it is a copy and not a move', async () => {
		const states = await derive();

		const resolved = resolveNotes(states, [note('Archive/Printer.md', 'v1')], vaultOf('Archive/Printer.md', 'Docs/Printer.md'));

		expect(resolved.has('Archive/Printer.md')).toBe(false);
	});

	it('is not matched while its bytes are not known yet', async () => {
		const states = await derive();

		expect(resolveNotes(states, [note('Archive/Printer.md', null)], vaultOf('Archive/Printer.md')).size).toBe(0);
	});

	it('is none when two copies of those bytes are in the vault, since which is the moved one cannot be told', async () => {
		const states = await derive();

		const resolved = resolveNotes(states, [note('A/Printer.md', 'v1'), note('B/Printer.md', 'v1')], vaultOf('A/Printer.md', 'B/Printer.md'));

		expect(resolved.size).toBe(0);
	});

	it('is none when two absent files hold the same bytes, since the note could be either document', async () => {
		remote.publish('main', { 'Docs/Scanner.md': 'v1' });
		const states = await derive();

		const resolved = resolveNotes(states, [note('Archive/Copy.md', 'v1')], vaultOf('Archive/Copy.md'));

		expect(resolved.size).toBe(0);
	});
});

describe('a legacy identity property', () => {
	it('resolves a note to its document and is shown as moved when the note is not where the document is', async () => {
		remote.publish('main', { 'Docs/Printer.md': 'v1' });
		await connectReceived(ctx, remote.address);
		const states = await derive(ctx, ['Printer']);

		const resolved = resolveNotes(states, [note('Elsewhere/Printer.md', 'v1', 'Printer')], vaultOf('Elsewhere/Printer.md'));

		expect(resolved.get('Elsewhere/Printer.md')).toEqual({ docId: 'Printer', via: 'doc-id', moved: true });
	});

	it('resolves a note whose document has not been derived yet, with no state to show', () => {
		const states = { documents: new Map(), index: { main: new Map(), synced: null, sentNotes: new Map(), identities: new Map() } };

		const resolved = resolveNotes(states, [note('a.md', 'x', 'New')], vaultOf('a.md'));

		expect(resolved.get('a.md')).toEqual({ docId: 'New', via: 'doc-id', moved: false });
	});
});
