import { describe, expect, it } from 'vitest';
import type { Plugin } from 'obsidian';
import { SettingsStore } from '../src/platform-config/settings-store';

/**
 * What setup remembers (platform-config "The plugin stores no secret" and "The
 * plugin's saved settings never stop it starting"). The store is `data.json`'s
 * only writer, so these are the properties of that one file.
 */

function fakePlugin(raw: unknown): { plugin: Plugin; saved: unknown[] } {
	const saved: unknown[] = [];
	const plugin = {
		manifest: { dir: '.obsidian/plugins/obsidian-docs-publisher' },
		app: { vault: { adapter: { exists: async () => true, copy: async () => undefined } } },
		loadData: async () => raw,
		saveData: async (data: unknown) => {
			saved.push(JSON.parse(JSON.stringify(data)));
		},
	} as unknown as Plugin;
	return { plugin, saved };
}

const LEGACY = {
	submissions: {
		Setup: {
			docId: 'Setup',
			branch: 'doc/Setup',
			mrIid: 7,
			state: 'published',
			path: 'SOPs/Setup.md',
			project: { host: 'https://gitlab.example.com', id: 42 },
		},
	},
	connection: { host: 'https://gitlab.example.com', projectId: 'docs/kb' },
};

describe('what setup remembers', () => {
	it('starts with nothing from a missing file', async () => {
		const { plugin } = fakePlugin(null);
		const store = new SettingsStore(plugin);
		await store.load();

		expect(store.savedSetup()).toEqual({});
	});

	it('starts with nothing from a file written before setup existed, and loads it without a notice', async () => {
		const { plugin } = fakePlugin(LEGACY);
		const store = new SettingsStore(plugin);

		await store.load();
		expect(store.savedSetup()).toEqual({});
	});

	it('remembers the four things and gives them back after a restart', async () => {
		const first = fakePlugin(null);
		const store = new SettingsStore(first.plugin);
		await store.load();

		await store.saveSetup({
			projectAddress: 'git@gitlab.example.com:docs/kb.git',
			keyPath: '/home/ana/.ssh/docs-publisher_ed25519',
			username: 'ana.nguyen',
			testedFor: { keyPath: '/home/ana/.ssh/docs-publisher_ed25519', address: 'git@gitlab.example.com:docs/kb.git' },
		});

		const second = fakePlugin(first.saved[first.saved.length - 1]);
		const reloaded = new SettingsStore(second.plugin);
		await reloaded.load();
		expect(reloaded.savedSetup()).toEqual({
			projectAddress: 'git@gitlab.example.com:docs/kb.git',
			keyPath: '/home/ana/.ssh/docs-publisher_ed25519',
			username: 'ana.nguyen',
			testedFor: { keyPath: '/home/ana/.ssh/docs-publisher_ed25519', address: 'git@gitlab.example.com:docs/kb.git' },
		});
	});

	it('keeps what an earlier version wrote, through every save, so that version can be reinstalled', async () => {
		const { plugin, saved } = fakePlugin({ ...LEGACY, aFieldFromANewerPlugin: { keep: 'me' } });
		const store = new SettingsStore(plugin);
		await store.load();

		await store.saveSetup({ projectAddress: 'git@gitlab.example.com:docs/kb.git' });

		const written = saved[saved.length - 1] as Record<string, unknown>;
		expect(written.submissions).toEqual(LEGACY.submissions);
		expect(written.connection).toEqual(LEGACY.connection);
		expect(written.aFieldFromANewerPlugin).toEqual({ keep: 'me' });
		expect((written.setup as { projectAddress: string }).projectAddress).toBe('git@gitlab.example.com:docs/kb.git');
	});

	it('changes only the fields it is given', async () => {
		const { plugin } = fakePlugin(null);
		const store = new SettingsStore(plugin);
		await store.load();
		await store.saveSetup({ projectAddress: 'git@h:a/b.git', username: 'ana' });

		await store.saveSetup({ keyPath: '/k' });

		expect(store.savedSetup()).toEqual({ projectAddress: 'git@h:a/b.git', username: 'ana', keyPath: '/k' });
	});

	it('forgets a field that is set to undefined, which is how a test result is discarded', async () => {
		const { plugin } = fakePlugin(null);
		const store = new SettingsStore(plugin);
		await store.load();
		await store.saveSetup({ keyPath: '/k', testedFor: { keyPath: '/k', address: 'git@h:a/b.git' } });

		await store.saveSetup({ testedFor: undefined });

		expect(store.savedSetup()).toEqual({ keyPath: '/k' });
	});

	it('writes no `setup` key at all once everything is forgotten', async () => {
		const { plugin, saved } = fakePlugin(null);
		const store = new SettingsStore(plugin);
		await store.load();
		await store.saveSetup({ keyPath: '/k' });

		await store.saveSetup({ keyPath: undefined });

		expect(saved[saved.length - 1]).not.toHaveProperty('setup');
	});

	it('has no way to remember a field it was not built for', async () => {
		const { plugin, saved } = fakePlugin(null);
		const store = new SettingsStore(plugin);
		await store.load();

		await store.saveSetup({ keyPath: '/k', token: 'must-not-be-written', passphrase: 'nor-this' } as never);

		const text = JSON.stringify(saved[saved.length - 1]);
		expect(text).not.toContain('must-not-be-written');
		expect(text).not.toContain('nor-this');
		expect(text).toContain('/k');
	});

	it('hands back a copy, so changing it does not change what is saved', async () => {
		const { plugin } = fakePlugin(null);
		const store = new SettingsStore(plugin);
		await store.load();
		await store.saveSetup({ testedFor: { keyPath: '/k', address: 'a' } });

		const copy = store.savedSetup();
		if (copy.testedFor !== undefined) {
			copy.testedFor.keyPath = 'changed';
		}
		copy.username = 'changed';

		expect(store.savedSetup().testedFor?.keyPath).toBe('/k');
		expect(store.savedSetup().username).toBeUndefined();
	});

	describe('a file that was edited by hand', () => {
		const damaged: Array<[string, unknown]> = [
			['fields of the wrong type', { projectAddress: 5, keyPath: ['x'], username: { a: 1 }, testedFor: 'yes' }],
			['a test result missing a half', { testedFor: { keyPath: '/k' } }],
			['empty strings', { projectAddress: '', keyPath: '', username: '' }],
			['setup that is not an object', 'oops'],
			['setup that is null', null],
		];
		for (const [label, setup] of damaged) {
			it(`drops ${label} and starts from the rest`, async () => {
				const { plugin } = fakePlugin({ ...LEGACY, setup });
				const store = new SettingsStore(plugin);

				await store.load();
				expect(store.savedSetup()).toEqual({});
			});
		}

		// The name becomes the owner written into every new document, one line
		// at a time, so anything that is not GitLab's alphabet is dropped on load.
		for (const [label, username] of [
			['a name with a line break in it', 'ana\nowner: someone-else'],
			['a name with a space', 'ana nguyen'],
			['a name that starts with a dot', '.ana'],
			['a name that is far too long', 'a'.repeat(300)],
		] as const) {
			it(`drops ${label}`, async () => {
				const { plugin } = fakePlugin({ ...LEGACY, setup: { projectAddress: 'git@h:a/b.git', username } });
				const store = new SettingsStore(plugin);
				await store.load();

				expect(store.savedSetup()).toEqual({ projectAddress: 'git@h:a/b.git' });
			});
		}

		it('keeps a username that is one', async () => {
			const { plugin } = fakePlugin({ ...LEGACY, setup: { username: 'ana.nguyen-2_x' } });
			const store = new SettingsStore(plugin);
			await store.load();

			expect(store.savedSetup()).toEqual({ username: 'ana.nguyen-2_x' });
		});

		it('keeps the good fields next to a bad one', async () => {
			const { plugin } = fakePlugin({ ...LEGACY, setup: { projectAddress: 'git@h:a/b.git', keyPath: 7, extra: 'x' } });
			const store = new SettingsStore(plugin);
			await store.load();

			expect(store.savedSetup()).toEqual({ projectAddress: 'git@h:a/b.git' });
		});
	});
});

describe('a data file that is not usable', () => {
	for (const [label, raw] of [
		['an array', [1, 2, 3]],
		['a number', 42],
		['a string', 'oops'],
		['nothing at all', null],
		['an empty object', {}],
	] as const) {
		it(`starts from defaults for ${label}, with no error`, async () => {
			const { plugin } = fakePlugin(raw);
			const store = new SettingsStore(plugin);

			await expect(store.load()).resolves.toBeUndefined();

			expect(store.savedSetup()).toEqual({});
		});
	}

	it('starts from defaults when the file cannot be parsed at all', async () => {
		const plugin = {
			loadData: async () => {
				throw new SyntaxError('Unexpected token');
			},
			saveData: async () => undefined,
		} as unknown as Plugin;
		const store = new SettingsStore(plugin);

		await expect(store.load()).resolves.toBeUndefined();

		expect(store.savedSetup()).toEqual({});
	});

	it('saves into the defaults it started from', async () => {
		const { plugin, saved } = fakePlugin([1, 2]);
		const store = new SettingsStore(plugin);
		await store.load();

		await store.saveSetup({ keyPath: '/k' });

		expect(saved[saved.length - 1]).toEqual({ setup: { keyPath: '/k' } });
	});
});
