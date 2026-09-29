import { afterEach, describe, expect, it } from 'vitest';
import type { App, Plugin } from 'obsidian';
import { setRequestUrlHandler, stubResponse } from './obsidian-stub';
import type { ConnectionState } from '../src/platform-config/connection-state';
import {
	DocumentStatusHolder,
	effectiveState,
	inAnotherProject,
	refreshDocumentStatuses,
} from '../src/submission-tracking/document-status';
import type { ProjectRef, SubmissionRecord } from '../src/submission-tracking/submission-record';
import { belongsToProject, configuredProject } from '../src/submission-tracking/submission-record';
import { SubmissionStore } from '../src/submission-tracking/submission-store';

/**
 * A record carries the project it belongs to, and nothing acts on one that
 * does not match — `docs/ce-verification.md` §D0h, where pointing the plugin at
 * a second project left every document wearing the first one's state.
 */

const DETAILS = { host: 'https://gitlab.example.com', projectId: '42', token: 'x' };
const HERE: ProjectRef = { host: 'https://gitlab.example.com', id: 42 };
const ELSEWHERE: ProjectRef = { host: 'https://gitlab.example.com', id: 7 };

function verified(id: number): ConnectionState {
	return {
		kind: 'verified',
		identity: { id: 1, name: 'Ivan', username: 'ivan' },
		access: { id, accessLevel: 30, accessLabel: 'Developer' },
	};
}

function record(docId: string, project?: ProjectRef): SubmissionRecord {
	return { docId, branch: `doc/${docId}`, mrIid: 3, state: 'pending', project };
}

describe('whether a record belongs to the configured project', () => {
	it('matches the same project configured by id or by path', () => {
		const byId = configuredProject(DETAILS, verified(42));
		const byPath = configuredProject({ ...DETAILS, projectId: 'group/docs' }, verified(42));

		expect(belongsToProject(record('a', HERE), byId)).toBe(true);
		expect(belongsToProject(record('a', HERE), byPath)).toBe(true);
	});

	it('ignores how the address was typed', () => {
		const project = configuredProject({ ...DETAILS, host: 'GitLab.Example.com/' }, verified(42));

		expect(belongsToProject(record('a', HERE), project)).toBe(true);
	});

	it('does not match the same project id on a different host', () => {
		const project = configuredProject({ ...DETAILS, host: 'https://gitlab.com' }, verified(42));

		expect(belongsToProject(record('a', HERE), project)).toBe(false);
	});

	it('does not match an unstamped record, or when nothing is verified', () => {
		expect(belongsToProject(record('a'), HERE)).toBe(false);
		expect(belongsToProject(record('a', HERE), configuredProject(DETAILS, { kind: 'unverified' }))).toBe(false);
	});
});

let restore: (() => void) | null = null;

afterEach(() => {
	restore?.();
	restore = null;
});

/** The configured project's one listing holds a merge request for `doc/Matched` only. */
function remote(): void {
	restore = setRequestUrlHandler(() =>
		stubResponse({
			status: 200,
			body: JSON.stringify([{ iid: 9, state: 'merged', source_branch: 'doc/Matched', user_notes_count: 0 }]),
		})
	);
}

async function storeWith(...records: SubmissionRecord[]): Promise<SubmissionStore> {
	const data = { submissions: Object.fromEntries(records.map((entry) => [entry.docId, { ...entry }])) };
	const plugin = { loadData: async () => data, saveData: async () => undefined } as unknown as Plugin;
	const store = new SubmissionStore(plugin);
	await store.load();
	return store;
}

async function refresh(store: SubmissionStore): Promise<void> {
	const vault = { vault: { getMarkdownFiles: () => [] } } as unknown as App;
	await refreshDocumentStatuses(vault, DETAILS, verified(42), store, new DocumentStatusHolder());
}

describe('stamping on evidence', () => {
	it('stamps a record the remote matched here', async () => {
		remote();
		const store = await storeWith(record('Matched'));

		await refresh(store);

		expect(store.get('Matched')).toEqual({ ...record('Matched', HERE), mrIid: 9, state: 'published' });
	});

	it('leaves an unmatched record exactly as it was', async () => {
		remote();
		const store = await storeWith(record('Unmatched'));

		await refresh(store);

		expect(store.get('Unmatched')).toEqual(record('Unmatched'));
	});

	// DECIDED: not overwritten. `doc_id` is unique per repository, so a match
	// here does not prove the note is this project's when its record already
	// says it is another's — and left whole, it is intact on pointing back.
	it('does not take over a record already stamped with another project', async () => {
		remote();
		const store = await storeWith(record('Matched', ELSEWHERE));

		await refresh(store);

		expect(store.get('Matched')).toEqual(record('Matched', ELSEWHERE));
	});
});

describe('the state a document is shown in', () => {
	const noMergeRequest = { docId: 'a', submission: null };
	const imported: SubmissionRecord = { docId: 'a', branch: 'doc/a', state: 'published', project: HERE };

	it('still reads an imported document here as published', () => {
		expect(effectiveState(noMergeRequest, imported, HERE)).toBe('published');
	});

	// Undefined is what the panel reads as "no label, and offer a first
	// submission" rather than the resubmit action for the stored state.
	it('gives no state for a record from another project, or one never stamped', () => {
		expect(effectiveState(noMergeRequest, { ...imported, project: ELSEWHERE }, HERE)).toBeUndefined();
		expect(effectiveState(noMergeRequest, { ...imported, project: undefined }, HERE)).toBeUndefined();
	});

	it('takes the remote over any record when the remote has an answer', () => {
		const live = { docId: 'a', submission: { state: 'pending' as const, mrIid: 3, webUrl: null } };

		expect(effectiveState(live, { ...imported, project: ELSEWHERE }, HERE)).toBe('pending');
	});
});

describe('marking a document as in another project', () => {
	const noMergeRequest = { docId: 'a', submission: null };
	const live = { docId: 'a', submission: { state: 'pending' as const, mrIid: 3, webUrl: null } };

	it('marks a record naming another project that has nothing here', () => {
		expect(inAnotherProject(noMergeRequest, record('a', ELSEWHERE), HERE)).toBe(true);
	});

	// "Another project" would assert where it belongs, which nothing established.
	it('never marks an unstamped record', () => {
		expect(inAnotherProject(noMergeRequest, record('a'), HERE)).toBe(false);
	});

	it('does not mark a record of this project, or one with a live answer, or before any refresh', () => {
		expect(inAnotherProject(noMergeRequest, record('a', HERE), HERE)).toBe(false);
		expect(inAnotherProject(live, record('a', ELSEWHERE), HERE)).toBe(false);
		expect(inAnotherProject(null, record('a', ELSEWHERE), HERE)).toBe(false);
	});
});
