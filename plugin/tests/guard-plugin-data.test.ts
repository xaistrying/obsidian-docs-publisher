import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Plugin } from 'obsidian';
import type { SubmissionRecord } from '../src/submission-tracking/submission-record';
import { SubmissionStore } from '../src/submission-tracking/submission-store';

/**
 * guard-plugin-data (2026-09-30): a `data.json` that exists but cannot be
 * used is copied aside before anything overwrites it, and when it cannot be
 * copied nothing is written for the session. A missing one stays silent.
 */

const DIR = '.obsidian/plugins/obsidian-docs-publisher';

const RECORD: SubmissionRecord = {
	docId: 'Setup',
	branch: 'doc/Setup',
	mrIid: 7,
	state: 'published',
	path: 'SOPs/Setup.md',
	mtime: 1_000 as SubmissionRecord['mtime'],
	project: { host: 'https://gitlab.example.com', id: 42 },
};

/** Every adapter and plugin call, in order, so tests can check sequence. */
type Call = { op: 'exists' | 'copy' | 'save'; args: unknown[] };

function fakePlugin(
	raw: unknown,
	options: { exists?: boolean; copyFails?: boolean } = {},
): { plugin: Plugin; calls: Call[] } {
	const calls: Call[] = [];
	const plugin = {
		manifest: { dir: DIR },
		app: {
			vault: {
				adapter: {
					exists: async (path: string) => {
						calls.push({ op: 'exists', args: [path] });
						return options.exists ?? true;
					},
					copy: async (from: string, to: string) => {
						calls.push({ op: 'copy', args: [from, to] });
						if (options.copyFails === true) {
							throw new Error('EACCES');
						}
					},
				},
			},
		},
		loadData: async () => raw,
		saveData: async (data: unknown) => {
			// Serialized now, so a later in-memory change cannot rewrite what
			// this call is recorded as having received.
			calls.push({ op: 'save', args: [JSON.parse(JSON.stringify(data))] });
		},
	} as unknown as Plugin;
	return { plugin, calls };
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('a missing data file', () => {
	it('loads silently from null, without asking whether the file exists', async () => {
		const { plugin, calls } = fakePlugin(null);
		const store = new SubmissionStore(plugin);

		expect(await store.load()).toBe('loaded');
		expect(calls).toEqual([]);
		expect(store.allRecords()).toEqual([]);
	});

	it('loads silently when the file does not exist, whatever loadData returned', async () => {
		const { plugin, calls } = fakePlugin(undefined, { exists: false });
		const store = new SubmissionStore(plugin);

		expect(await store.load()).toBe('loaded');
		expect(calls).toEqual([{ op: 'exists', args: [`${DIR}/data.json`] }]);
	});
});

describe('an unusable data file', () => {
	it.each([
		['unreadable or not JSON', undefined],
		['JSON with no submissions', {}],
	])('%s: copies it aside, then writes empty data', async (_label, raw) => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const { plugin, calls } = fakePlugin(raw);
		const store = new SubmissionStore(plugin);

		expect(await store.load()).toBe('recovered');

		const ops = calls.map((call) => call.op);
		expect(ops).toEqual(['exists', 'copy', 'save']);
		const [from, to] = calls[1].args as [string, string];
		expect(from).toBe(`${DIR}/data.json`);
		expect(to.slice(0, DIR.length + 1)).toBe(`${DIR}/`);
		expect(to.slice(DIR.length + 1)).toMatch(/^data-unreadable-\d+\.json$/);
		expect(calls[2].args[0]).toEqual({ submissions: {} });
	});

	it('writes normally after a successful copy', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const { plugin, calls } = fakePlugin(undefined);
		const store = new SubmissionStore(plugin);
		await store.load();

		await store.save(RECORD);

		expect(calls.filter((call) => call.op === 'save')).toHaveLength(2);
	});

	it('treats an exists check that fails as a file that is there', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const { plugin } = fakePlugin(undefined);
		plugin.app.vault.adapter.exists = async () => {
			throw new Error('adapter');
		};
		const store = new SubmissionStore(plugin);

		expect(await store.load()).toBe('recovered');
	});
});

describe('an unusable data file that cannot be copied', () => {
	it('holds every write for the session, while memory and listeners carry on', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const { plugin, calls } = fakePlugin(undefined, { copyFails: true });
		const store = new SubmissionStore(plugin);
		let notified = 0;
		store.onChange(() => {
			notified++;
		});

		expect(await store.load()).toBe('held');

		await store.save(RECORD);
		await store.saveEditBaseline('Setup', undefined);
		await store.saveConnection({ host: 'gitlab.example.com', projectId: '42' });

		expect(calls.some((call) => call.op === 'save')).toBe(false);
		expect(store.get('Setup')).toEqual({ ...RECORD, mtime: undefined });
		expect(store.savedConnection()).toEqual({ host: 'gitlab.example.com', projectId: '42' });
		expect(notified).toBe(2);
	});
});

describe('a malformed remembered connection', () => {
	it('is dropped on its own and never triggers the guard', async () => {
		const { plugin, calls } = fakePlugin({
			submissions: { Setup: RECORD },
			connection: { host: 42 },
		});
		const store = new SubmissionStore(plugin);

		expect(await store.load()).toBe('loaded');
		expect(calls).toEqual([]);
		expect(store.get('Setup')).toEqual(RECORD);
		expect(store.savedConnection()).toBeUndefined();
	});
});
