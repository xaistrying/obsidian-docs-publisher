import { afterEach, describe, expect, it } from 'vitest';
import type { App, Plugin, TFile } from 'obsidian';
import { setRequestUrlHandler, stubResponse } from './obsidian-stub';
import { openNewCycle } from '../src/doc-authoring/submit-document';
import { DocumentStatusHolder } from '../src/submission-tracking/document-status';
import { SubmissionStore } from '../src/submission-tracking/submission-store';

/**
 * A first submit records the document BEFORE it writes front matter
 * (`docs/ce-verification.md` §D0e). Recorded last, a failed front-matter write
 * left a review on the remote with no `doc_id` in the note and no record — a
 * document nothing in the vault could find again.
 */

const DETAILS = { host: 'https://gitlab.example.com', projectId: '42', token: 'x' };
const PROJECT = { host: 'https://gitlab.example.com', id: 42 };
const PATH = 'SOPs/Setup.md';
const FILE = { path: PATH, basename: 'Setup', extension: 'md' } as unknown as TFile;
const RESULT = { title: 'Setup', category: 'SOP' as const };

let restore: (() => void) | null = null;

afterEach(() => {
	restore?.();
	restore = null;
});

/** The remote accepts the branch, the commit and the merge request. */
function remoteAccepts(): void {
	remoteAnswersMergeRequest(201);
}

/** The branch and commit are accepted; the merge request gets `status`. */
function remoteAnswersMergeRequest(status: number): void {
	restore = setRequestUrlHandler((request) => {
		if (request.url.endsWith('/repository/commits')) {
			return stubResponse({ status: 201, body: JSON.stringify({ id: 'abc' }) });
		}
		if (request.url.endsWith('/merge_requests')) {
			return status === 201
				? stubResponse({ status: 201, body: JSON.stringify({ iid: 9 }) })
				: stubResponse({ status, body: JSON.stringify({ message: 'refused' }) });
		}
		return stubResponse({ status: 200, body: JSON.stringify({ default_branch: 'main', empty_repo: false }) });
	});
}

function appWhoseFrontMatterWrite(outcome: 'succeeds' | 'fails'): App {
	return {
		vault: { adapter: { stat: async () => ({ mtime: 5_000 }) } },
		fileManager: {
			processFrontMatter: async () => {
				if (outcome === 'fails') {
					throw new Error('front matter write failed');
				}
			},
		},
	} as unknown as App;
}

async function emptyStore(): Promise<SubmissionStore> {
	const plugin = { loadData: async () => null, saveData: async () => undefined } as unknown as Plugin;
	const store = new SubmissionStore(plugin);
	await store.load();
	return store;
}

function submit(
	app: App,
	store: SubmissionStore,
	statuses: DocumentStatusHolder = new DocumentStatusHolder()
): Promise<void> {
	return openNewCycle(app, DETAILS, FILE, RESULT, store, statuses, {
		docId: 'Setup',
		branch: 'doc/Setup',
		project: PROJECT,
		files: [{ action: 'create', filePath: PATH, content: '# Setup' }],
		completeFrontMatter: RESULT,
	});
}

describe('the order a first submit writes in', () => {
	it('still tracks the document when the front-matter write fails', async () => {
		remoteAccepts();
		const store = await emptyStore();

		await expect(submit(appWhoseFrontMatterWrite('fails'), store)).rejects.toThrow();

		expect(store.get('Setup')).toEqual({
			docId: 'Setup',
			branch: 'doc/Setup',
			mrIid: 9,
			state: 'pending',
			path: PATH,
			// The project the writes went to, so the record says where it lives
			// (scope-records-to-their-project).
			project: PROJECT,
		});
	});

	it('records the baseline after the front-matter write when it succeeds', async () => {
		remoteAccepts();
		const store = await emptyStore();

		await submit(appWhoseFrontMatterWrite('succeeds'), store);

		expect(store.get('Setup')?.mtime).toBe(5_000);
	});
});

/**
 * A review the submit itself opened counts as resolved, so Reset shows with no
 * refresh (show-reset-after-submit). Pinned here because `openNewCycle` is the
 * only place that may record it.
 */
describe('what a submit that opens a review records as resolved', () => {
	it('records the document as pending, with the new review number and no link', async () => {
		remoteAccepts();
		const store = await emptyStore();
		const statuses = new DocumentStatusHolder();

		await submit(appWhoseFrontMatterWrite('succeeds'), store, statuses);

		expect(statuses.statusFor('Setup')).toEqual({
			docId: 'Setup',
			submission: { state: 'pending', mrIid: 9, webUrl: null },
		});
	});

	it('records nothing when opening the review fails', async () => {
		remoteAnswersMergeRequest(500);
		const store = await emptyStore();
		const statuses = new DocumentStatusHolder();

		await submit(appWhoseFrontMatterWrite('succeeds'), store, statuses);

		expect(store.get('Setup')).toBeUndefined();
		expect(statuses.statusFor('Setup')).toBeNull();
	});
});
