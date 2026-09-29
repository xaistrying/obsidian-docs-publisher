import { describe, expect, it } from 'vitest';
import { restorableDocuments } from '../src/submission-tracking/reset';
import type { SubmissionRecord, SubmissionState } from '../src/submission-tracking/submission-record';
import type { SubmissionStore } from '../src/submission-tracking/submission-store';

const PROJECT = { host: 'https://gitlab.example.com', id: 42 };

function record(docId: string, state: SubmissionState, mrIid = 1): SubmissionRecord {
	return { docId, branch: `doc/${docId}`, mrIid, state, project: PROJECT };
}

/** Only `allRecords` is reached, so the fake stops there. */
function store(...records: SubmissionRecord[]): SubmissionStore {
	return { allRecords: () => records } as unknown as SubmissionStore;
}

describe('documents the vault can restore', () => {
	it('offers a tracked document whose note is gone', () => {
		const result = restorableDocuments(store(record('SBT-KE-001', 'pending')), new Set(), PROJECT);

		expect(result).toEqual([{ docId: 'SBT-KE-001', mrIid: 1 }]);
	});

	it('leaves out a document the vault still has a note for', () => {
		const result = restorableDocuments(store(record('SBT-KE-001', 'pending')), new Set(['SBT-KE-001']), PROJECT);

		expect(result).toEqual([]);
	});

	it('leaves published documents to Discover, which lists them by path', () => {
		const result = restorableDocuments(store(record('SBT-KE-001', 'published')), new Set(), PROJECT);

		expect(result).toEqual([]);
	});

	// The regression this rule exists to prevent: Discover excludes whatever
	// Restore offers, so anything Restore drops MUST fall through to Discover
	// rather than out of both lists.
	it('drops a published orphan so Discover can pick it up', () => {
		const records = store(record('published-doc', 'published'), record('open-doc', 'pending'));
		const offered = restorableDocuments(records, new Set(), PROJECT).map((entry) => entry.docId);

		expect(offered).toEqual(['open-doc']);
		expect(offered).not.toContain('published-doc');
	});

	// Nothing deletes a stored record, so anything that can enter this list
	// without a way to leave it stays forever. A rejected draft the author
	// deleted because they had given up on it is exactly that case.
	it('drops a not-accepted document, which would otherwise never leave the list', () => {
		const result = restorableDocuments(store(record('SBT-KE-002', 'closed')), new Set(), PROJECT);

		expect(result).toEqual([]);
	});

	it('keeps a changes-requested document', () => {
		const result = restorableDocuments(store(record('SBT-KE-003', 'changes-requested')), new Set(), PROJECT);

		expect(result.map((entry) => entry.docId)).toEqual(['SBT-KE-003']);
	});

	it('sorts by doc_id, since there is no filename to sort by', () => {
		const result = restorableDocuments(
			store(record('zulu', 'pending'), record('alpha', 'pending'), record('mike', 'pending')),
			new Set(),
			PROJECT
		);

		expect(result.map((entry) => entry.docId)).toEqual(['alpha', 'mike', 'zulu']);
	});

	it('carries the merge request the content is read from', () => {
		const result = restorableDocuments(store(record('SBT-KE-004', 'pending', 77)), new Set(), PROJECT);

		expect(result[0].mrIid).toBe(77);
	});

	// scope-records-to-their-project: Restore reads from the record's merge
	// request, and another project's names a review this one does not have.
	it('leaves out a record from another project, or one never stamped', () => {
		const foreign = { ...record('elsewhere', 'pending'), project: { host: PROJECT.host, id: 7 } };
		const unstamped = { ...record('unknown', 'pending'), project: undefined };

		expect(restorableDocuments(store(foreign, unstamped), new Set(), PROJECT)).toEqual([]);
	});
});
