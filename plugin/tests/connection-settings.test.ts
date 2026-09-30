import { describe, expect, it } from 'vitest';
import type { Plugin } from 'obsidian';
import type { SubmissionRecord } from '../src/submission-tracking/submission-record';
import { SubmissionStore } from '../src/submission-tracking/submission-store';

/**
 * persist-connection-settings (2026-09-30): the address and project ID are
 * remembered in `data.json`, the token never is, and a bad `connection` key
 * can never cost the records beside it.
 */

// A sentinel, not a real value: distinctive enough that finding it anywhere
// in the serialized output means the token leaked.
const TOKEN = 'SENTINEL-SESSION-ONLY-VALUE';

const RECORD: SubmissionRecord = {
	docId: 'Setup',
	branch: 'doc/Setup',
	mrIid: 7,
	state: 'pending',
	path: 'SOPs/Setup.md',
	mtime: 1_000 as SubmissionRecord['mtime'],
	project: { host: 'https://gitlab.example.com', id: 42 },
};

/** A fake `Plugin` whose `data.json` is `initial`, capturing every save as JSON. */
function fakePlugin(initial: unknown): { plugin: Plugin; saved: string[] } {
	const saved: string[] = [];
	const plugin = {
		loadData: async () => initial,
		saveData: async (data: unknown) => {
			saved.push(JSON.stringify(data));
		},
	} as unknown as Plugin;
	return { plugin, saved };
}

describe('remembering the connection details', () => {
	it('returns the saved address and project ID after a reload', async () => {
		const first = fakePlugin(null);
		const store = new SubmissionStore(first.plugin);
		await store.load();
		await store.saveConnection({ host: 'gitlab.example.com', projectId: 'team/docs' });

		const reloaded = new SubmissionStore(fakePlugin(JSON.parse(first.saved[0])).plugin);
		await reloaded.load();

		expect(reloaded.savedConnection()).toEqual({ host: 'gitlab.example.com', projectId: 'team/docs' });
	});

	it('never writes the token, even when handed the full connection details', async () => {
		const { plugin, saved } = fakePlugin(null);
		const store = new SubmissionStore(plugin);
		await store.load();

		const details = { host: 'https://gitlab.example.com', projectId: '42', token: TOKEN };
		await store.saveConnection(details);

		expect(saved).toHaveLength(1);
		expect(saved[0]).not.toContain('"token"');
		expect(saved[0]).not.toContain(TOKEN);
	});

	it('drops a malformed connection and still loads every record', async () => {
		const { plugin } = fakePlugin({
			submissions: { Setup: RECORD },
			connection: { host: 42, projectId: null },
		});
		const store = new SubmissionStore(plugin);
		await store.load();

		expect(store.savedConnection()).toBeUndefined();
		expect(store.get('Setup')).toEqual(RECORD);
	});
});
