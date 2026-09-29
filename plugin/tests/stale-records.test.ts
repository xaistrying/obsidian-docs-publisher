import { afterEach, describe, expect, it } from 'vitest';
import type { App, Plugin } from 'obsidian';
import { setRequestUrlHandler, stubResponse } from './obsidian-stub';
import type { ConnectionState } from '../src/platform-config/connection-state';
import { DocumentStatusHolder, refreshDocumentStatuses } from '../src/submission-tracking/document-status';
import { restorableDocuments } from '../src/submission-tracking/reset';
import type { SubmissionRecord } from '../src/submission-tracking/submission-record';
import { SubmissionStore } from '../src/submission-tracking/submission-store';

/**
 * A record whose note was deleted while under review — `docs/ce-verification.md`
 * §D0f. Refresh used to reconcile vault notes only, so this record's state
 * stayed `pending` forever and it sat on the restore list for good.
 */

const DETAILS = { host: 'https://gitlab.example.com', projectId: '42', token: 'x' };
const PROJECT = { host: 'https://gitlab.example.com', id: 42 };

const VERIFIED: ConnectionState = {
	kind: 'verified',
	identity: { id: 1, name: 'Ivan', username: 'ivan' },
	access: { id: 42, accessLevel: 30, accessLabel: 'Developer' },
};

const ORPHAN: SubmissionRecord = {
	docId: 'Setup',
	branch: 'doc/Setup',
	mrIid: 7,
	state: 'pending',
	path: 'SOPs/Setup.md',
	mtime: 1_000 as SubmissionRecord['mtime'],
	project: PROJECT,
};

/** A vault with no notes at all: the record is the only trace of the document. */
const EMPTY_VAULT = { vault: { getMarkdownFiles: () => [] } } as unknown as App;

let restore: (() => void) | null = null;

afterEach(() => {
	restore?.();
	restore = null;
});

/** Answers the one merge-request listing with a single entry in `state`. */
function remote(state: string): { requests: number } {
	const seen = { requests: 0 };
	restore = setRequestUrlHandler(() => {
		seen.requests++;
		return stubResponse({
			status: 200,
			body: JSON.stringify([{ iid: 7, state, source_branch: 'doc/Setup', user_notes_count: 0 }]),
		});
	});
	return seen;
}

async function storeWith(record: SubmissionRecord): Promise<SubmissionStore> {
	const data = { submissions: { [record.docId]: { ...record } } };
	const plugin = { loadData: async () => data, saveData: async () => undefined } as unknown as Plugin;
	const store = new SubmissionStore(plugin);
	await store.load();
	return store;
}

async function refresh(store: SubmissionStore): Promise<void> {
	await refreshDocumentStatuses(EMPTY_VAULT, DETAILS, VERIFIED, store, new DocumentStatusHolder());
}

describe('reconciling a record whose note is gone', () => {
	it('asks the remote about it, and corrects a merged one to published', async () => {
		const seen = remote('merged');
		const store = await storeWith(ORPHAN);

		await refresh(store);

		expect(seen.requests).toBe(1);
		expect(store.get('Setup')?.state).toBe('published');
	});

	// The silent one: a correction that dropped `path` would break a later
	// Restore while appearing to fix the listing.
	it('keeps the path and baseline only a submit establishes', async () => {
		remote('closed');
		const store = await storeWith(ORPHAN);

		await refresh(store);

		expect(store.get('Setup')).toEqual({ ...ORPHAN, state: 'closed' });
	});

	it('leaves the restore list once corrected, which is what empties it', async () => {
		remote('merged');
		const store = await storeWith(ORPHAN);
		expect(restorableDocuments(store, new Set(), PROJECT).map((entry) => entry.docId)).toEqual(['Setup']);

		await refresh(store);

		expect(restorableDocuments(store, new Set(), PROJECT)).toEqual([]);
	});
});
