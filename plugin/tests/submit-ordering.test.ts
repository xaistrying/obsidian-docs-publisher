import { afterEach, describe, expect, it } from 'vitest';
import type { App, Plugin, TFile } from 'obsidian';
import { setRequestUrlHandler, stubResponse } from './obsidian-stub';
import { openNewCycle } from '../src/doc-authoring/submit-document';
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
	restore = setRequestUrlHandler((request) => {
		if (request.url.endsWith('/repository/commits')) {
			return stubResponse({ status: 201, body: JSON.stringify({ id: 'abc' }) });
		}
		if (request.url.endsWith('/merge_requests')) {
			return stubResponse({ status: 201, body: JSON.stringify({ iid: 9 }) });
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

function submit(app: App, store: SubmissionStore): Promise<void> {
	return openNewCycle(app, DETAILS, FILE, RESULT, store, {
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
