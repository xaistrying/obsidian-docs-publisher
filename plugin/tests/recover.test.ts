import { afterEach, describe, expect, it } from 'vitest';
// From the stub by path rather than through the `obsidian` specifier — see
// the note in `submission-files.test.ts`.
import { setRequestUrlHandler, stubResponse } from './obsidian-stub';
import type { RequestUrlParam } from './obsidian-stub';
import { resolveOrphanedRecords } from '../src/submission-tracking/recover';
import type { SubmissionRecord } from '../src/submission-tracking/submission-record';
import type { SubmissionStore } from '../src/submission-tracking/submission-store';

/**
 * Which stored records can actually be recovered, and from where.
 *
 * The third fallback — the document's own file on the default branch — is
 * what most of this covers, and it exists because the first two both need a
 * MERGE REQUEST to read a path from. A published document's review is merged
 * and its branch gone, so it resolved as "content can no longer be found"
 * while its file sat on the default branch; Discover then listed that same
 * file and offered to Import it. One document, two lists, opposite answers
 * (`docs/panel-tracking-scope.md`, 2026-09-20).
 */

const DETAILS = { host: 'https://gitlab.example.com', projectId: '42', token: 'x' };

let restore: (() => void) | null = null;

afterEach(() => {
	restore?.();
	restore = null;
});

function store(...records: SubmissionRecord[]): SubmissionStore {
	return { allRecords: () => records } as unknown as SubmissionStore;
}

function record(docId: string, extra: Partial<SubmissionRecord> = {}): SubmissionRecord {
	return { docId, branch: `doc/${docId}`, mrIid: 7, state: 'published', ...extra };
}

/**
 * Answers the reads resolution makes. `openFor` names the branches that still
 * have an open merge request; everything else answers "none open", which is
 * what a merged or closed review looks like.
 */
function remote(params: { tree?: string[]; openFor?: string[]; treeStatus?: number }): {
	requests: string[];
} {
	const requests: string[] = [];
	const tree = params.tree ?? [];
	const open = new Set(params.openFor ?? []);

	restore = setRequestUrlHandler((request: RequestUrlParam) => {
		const url = request.url;
		requests.push(url);

		if (url.includes('/repository/tree')) {
			if (params.treeStatus !== undefined) {
				return stubResponse({ status: params.treeStatus, body: '{}' });
			}
			// One short page, so the listing reports itself complete.
			return stubResponse({
				status: 200,
				body: JSON.stringify(tree.map((path) => ({ type: 'blob', path }))),
			});
		}

		if (url.includes('/merge_requests?')) {
			const branch = decodeURIComponent(/source_branch=([^&]+)/.exec(url)?.[1] ?? '');
			return stubResponse({
				status: 200,
				body: JSON.stringify(
					open.has(branch)
						? [{ iid: 7, state: 'opened', source_branch: branch, user_notes_count: 0 }]
						: []
				),
			});
		}

		return stubResponse({ status: 200, body: JSON.stringify({ default_branch: 'main' }) });
	});

	return { requests };
}

describe('resolving which orphaned records can be recovered', () => {
	it("takes the record's own stored path without any request at all", async () => {
		const { requests } = remote({});

		const result = await resolveOrphanedRecords(
			DETAILS,
			store(record('Setup', { path: 'Guides/Setup.md' })),
			new Set()
		);

		expect(result).toEqual({
			ok: true,
			documents: [
				{
					recoverable: true,
					docId: 'Setup',
					record: record('Setup', { path: 'Guides/Setup.md' }),
					path: 'Guides/Setup.md',
				},
			],
		});
		// The fast path must stay free: reading a listing to answer nothing
		// would spend a request on every refresh of every ordinary store.
		expect(requests).toEqual([]);
	});

	it('finds a published document on the default branch when no review is open', async () => {
		// The case that was reported unrecoverable and is the whole point of
		// the third fallback. No stored path, no open merge request — and the
		// file is right there.
		remote({ tree: ['test/test-007.md', 'Guides/Setup.md'] });

		const result = await resolveOrphanedRecords(DETAILS, store(record('test-007')), new Set());

		expect(result).toEqual({
			ok: true,
			documents: [
				{ recoverable: true, docId: 'test-007', record: record('test-007'), path: 'test/test-007.md' },
			],
		});
	});

	it('declines when two remote files derive the same document ID', async () => {
		// `docs/document-naming.md`: several `README.md` files derive one id,
		// so the record could belong to either. Unrecoverable is the honest
		// answer; picking one would hand back the wrong document's content.
		remote({ tree: ['Products/A/README.md', 'Products/B/README.md'] });

		const result = await resolveOrphanedRecords(DETAILS, store(record('README')), new Set());

		expect(result).toEqual({
			ok: true,
			documents: [{ recoverable: false, docId: 'README', record: record('README') }],
		});
	});

	it('is still unrecoverable when the repository holds no such document', async () => {
		remote({ tree: ['Guides/Setup.md'] });

		const result = await resolveOrphanedRecords(DETAILS, store(record('Gone')), new Set());

		expect(result).toEqual({
			ok: true,
			documents: [{ recoverable: false, docId: 'Gone', record: record('Gone') }],
		});
	});

	it('reads the listing once for many records that need it', async () => {
		const { requests } = remote({ tree: ['a/one.md', 'b/two.md'] });

		await resolveOrphanedRecords(DETAILS, store(record('one'), record('two')), new Set());

		expect(requests.filter((url) => url.includes('/repository/tree'))).toHaveLength(1);
	});

	it('reports a failed listing rather than calling the document unrecoverable', async () => {
		// A failure is not an answer. Reporting it as "cannot be recovered"
		// would tell the author something false about a document that is
		// probably fine.
		remote({ treeStatus: 403 });

		const result = await resolveOrphanedRecords(DETAILS, store(record('Setup')), new Set());

		expect(result.ok).toBe(false);
	});

	it('skips a record whose note is still in the vault', async () => {
		const { requests } = remote({});

		const result = await resolveOrphanedRecords(DETAILS, store(record('Setup')), new Set(['Setup']));

		expect(result).toEqual({ ok: true, documents: [] });
		expect(requests).toEqual([]);
	});
});
