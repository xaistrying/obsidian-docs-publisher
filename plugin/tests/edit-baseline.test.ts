import { describe, expect, it, vi } from 'vitest';
import { Modal } from 'obsidian';
import type { App, Plugin, TFile } from 'obsidian';
import type { ConnectionState } from '../src/platform-config/connection-state';
import { restoreDocument } from '../src/doc-authoring/reset-document';
import { captureEditBaseline, hasLocalEdits } from '../src/submission-tracking/document-status';
import type { SubmissionRecord } from '../src/submission-tracking/submission-record';
import { SubmissionStore } from '../src/submission-tracking/submission-store';

/**
 * The edit baseline, end to end through the code that writes it.
 *
 * Every fake here keeps TWO mtimes per note on purpose: what the disk says
 * (`adapter.stat`) and what Obsidian's cached `TFile.stat` says. The bug this
 * guards against lived in the gap — the cache still held the pre-write value
 * when the baseline was read — so a fake with one mtime could not fail.
 */

const DETAILS = { host: 'https://gitlab.example.com', projectId: 'group/docs', token: 'x' };

const VERIFIED: ConnectionState = {
	kind: 'verified',
	identity: { id: 1, name: 'Ivan', username: 'ivan' },
	access: { id: 42, accessLevel: 30, accessLabel: 'Developer' },
};

const PATH = 'SOPs/Setup.md';

/**
 * One note: its disk mtime, its cached `TFile`, and a clock. Writing bumps
 * the disk and leaves the cache behind until `settle`, which is the stale
 * window the old `file.stat.mtime` read fell into.
 */
function vault(params: { exists: boolean }) {
	let clock = 1_000;
	let onDisk: number | null = params.exists ? clock : null;
	const file = { path: PATH, basename: 'Setup', stat: { mtime: clock } };

	const write = () => {
		clock += 1_000;
		onDisk = clock;
		return file;
	};

	const app = {
		vault: {
			adapter: { stat: async (path: string) => (path === PATH && onDisk !== null ? { mtime: onDisk } : null) },
			getAbstractFileByPath: (path: string) => (path === PATH && onDisk !== null ? file : null),
			createFolder: async () => undefined,
			create: async () => write(),
			modify: async () => void write(),
		},
		workspace: { getLeaf: () => ({ openFile: async () => undefined }) },
	} as unknown as App;

	return {
		app,
		file: file as unknown as TFile,
		/** Obsidian's cache catches up with the disk. */
		settle: () => {
			file.stat.mtime = onDisk ?? file.stat.mtime;
		},
		/** The author edits the note. */
		edit: () => {
			write();
			file.stat.mtime = clock;
		},
	};
}

async function storeWith(record: SubmissionRecord): Promise<SubmissionStore> {
	const data = { submissions: { [record.docId]: record } };
	const plugin = { loadData: async () => data, saveData: async () => undefined } as unknown as Plugin;
	const store = new SubmissionStore(plugin);
	await store.load();
	return store;
}

const REVIEWED: SubmissionRecord = {
	docId: 'Setup',
	branch: 'doc/Setup',
	mrIid: 7,
	state: 'changes-requested',
	path: PATH,
};

describe('whether a note has been edited since the plugin last wrote it', () => {
	it('reads an untouched note as not edited', async () => {
		const note = vault({ exists: true });
		const record = { ...REVIEWED, mtime: await captureEditBaseline(note.app, PATH) };

		expect(hasLocalEdits(note.file, record)).toBe(false);
	});

	it('reads an edited note as edited', async () => {
		const note = vault({ exists: true });
		const record = { ...REVIEWED, mtime: await captureEditBaseline(note.app, PATH) };
		note.edit();

		expect(hasLocalEdits(note.file, record)).toBe(true);
	});

	it('reads a record with no baseline as NOT edited', () => {
		const note = vault({ exists: true });
		note.edit();

		expect(hasLocalEdits(note.file, REVIEWED)).toBe(false);
	});

	it('captures no baseline, rather than a guess, when the note is not there', async () => {
		const note = vault({ exists: false });

		expect(await captureEditBaseline(note.app, PATH)).toBeUndefined();
	});
});

describe('the baseline after a reset', () => {
	/** The author answers the confirmation with Reset. */
	function confirmResets() {
		return vi.spyOn(Modal.prototype, 'open').mockImplementation(function (this: Modal) {
			(this as unknown as { settle: (confirmed: boolean) => void }).settle(true);
		});
	}

	it('reads a reset note as not edited, and an edit after it as edited', async () => {
		const note = vault({ exists: true });
		const store = await storeWith({ ...REVIEWED, mtime: await captureEditBaseline(note.app, PATH) });
		note.edit();
		expect(hasLocalEdits(note.file, store.get('Setup'))).toBe(true);

		const confirm = confirmResets();
		const written = await restoreDocument(note.app, DETAILS, VERIFIED, store, 'Setup', PATH, 'reviewed');
		confirm.mockRestore();
		note.settle();

		expect(written).toBe(true);
		expect(hasLocalEdits(note.file, store.get('Setup'))).toBe(false);

		note.edit();
		expect(hasLocalEdits(note.file, store.get('Setup'))).toBe(true);
	});

	it('records a baseline when the note is restored rather than overwritten', async () => {
		const note = vault({ exists: false });
		const store = await storeWith(REVIEWED);

		await restoreDocument(note.app, DETAILS, VERIFIED, store, 'Setup', PATH, 'reviewed');
		note.settle();

		expect(store.get('Setup')?.mtime).toBeDefined();
		expect(hasLocalEdits(note.file, store.get('Setup'))).toBe(false);
	});

	it('writes no baseline when the author cancels', async () => {
		const note = vault({ exists: true });
		const store = await storeWith(REVIEWED);
		const cancel = vi.spyOn(Modal.prototype, 'open').mockImplementation(function (this: Modal) {
			(this as unknown as { settle: (confirmed: boolean) => void }).settle(false);
		});

		await restoreDocument(note.app, DETAILS, VERIFIED, store, 'Setup', PATH, 'reviewed');
		cancel.mockRestore();

		expect(store.get('Setup')).toEqual(REVIEWED);
	});

	// The property the doc-authoring spec turns on: a reset changes nothing
	// about where the review stands.
	it('leaves state, branch, path and merge request untouched', async () => {
		const note = vault({ exists: true });
		const store = await storeWith(REVIEWED);

		await store.saveEditBaseline('Setup', await captureEditBaseline(note.app, PATH));

		const { mtime, ...rest } = store.get('Setup') as SubmissionRecord;
		expect(mtime).toBeDefined();
		expect(rest).toEqual(REVIEWED);
	});

	it('invents no record for a document the store does not hold', async () => {
		const note = vault({ exists: true });
		const store = await storeWith(REVIEWED);

		await store.saveEditBaseline('Elsewhere', await captureEditBaseline(note.app, PATH));

		expect(store.get('Elsewhere')).toBeUndefined();
	});
});

// Send update writes nothing to the note, so the store's own notification is
// the only thing that re-renders the panel onto the new baseline (2026-09-27).
describe('telling the panel a record changed', () => {
	it('notifies after a write, and stops once unsubscribed', async () => {
		const store = await storeWith(REVIEWED);
		const listener = vi.fn();
		const unsubscribe = store.onChange(listener);

		await store.saveEditBaseline(REVIEWED.docId, undefined);
		expect(listener).toHaveBeenCalledTimes(1);

		unsubscribe();
		await store.save(REVIEWED);
		expect(listener).toHaveBeenCalledTimes(1);
	});
});
