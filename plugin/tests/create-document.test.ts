import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { App, TFile } from 'obsidian';
import { AUTHOR_MESSAGES } from '../src/author-messages';
import { CREATE_FAILED_MESSAGE, createDocument } from '../src/doc-authoring/create-document';

const shown: string[] = [];
vi.mock('obsidian', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	Notice: class {
		constructor(message: string) {
			shown.push(message);
		}
	},
}));

interface Fake {
	app: App;
	created: Array<{ path: string; content: string }>;
	opened: TFile[];
}

/** An app that records what is made and opened, with paths that already exist. */
function fakeApp(options: { existing?: string[]; parent?: string; failCreate?: boolean; active?: string | null } = {}): Fake {
	const existing = new Set(options.existing ?? []);
	const created: Fake['created'] = [];
	const opened: TFile[] = [];
	const app = {
		workspace: {
			getActiveFile: () => (options.active === undefined || options.active === null ? null : { path: options.active }),
			getLeaf: () => ({
				openFile: async (file: TFile) => {
					opened.push(file);
				},
			}),
		},
		fileManager: { getNewFileParent: () => ({ path: options.parent ?? '/' }) },
		vault: {
			getAbstractFileByPath: (path: string) => (existing.has(path) ? { path } : null),
			create: async (path: string, content: string) => {
				if (options.failCreate === true) {
					throw new Error('refused');
				}
				created.push({ path, content });
				existing.add(path);
				return { path } as TFile;
			},
		},
	} as unknown as App;
	return { app, created, opened };
}

beforeEach(() => {
	shown.length = 0;
});

describe('creating a document', () => {
	it('makes a note owned by the username it was given, and opens it', async () => {
		const fake = fakeApp();

		await createDocument(fake.app, 'inguyen');

		expect(fake.created).toHaveLength(1);
		expect(fake.created[0].path).toBe('Untitled document.md');
		expect(fake.created[0].content).toMatch(/^---\nowner: inguyen\ncreated: \d{4}-\d{2}-\d{2}\nlast_reviewed: \d{4}-\d{2}-\d{2}\nlifecycle: active\n---\n/);
		expect(fake.opened).toHaveLength(1);
	});

	it('takes the owner exactly as given, not from anything an email or a display name could say', async () => {
		const fake = fakeApp();

		await createDocument(fake.app, 'ana.nguyen-2');

		expect(fake.created[0].content).toContain('owner: ana.nguyen-2\n');
	});

	it('puts the note where Obsidian would, with a space in its name that git would refuse as a name', async () => {
		const fake = fakeApp({ parent: 'Drafts' });

		await createDocument(fake.app, 'ana');

		expect(fake.created[0].path).toBe('Drafts/Untitled document.md');
	});

	it('takes the first free name when the default is taken', async () => {
		const fake = fakeApp({ existing: ['Untitled document.md', 'Untitled document 1.md'] });

		await createDocument(fake.app, 'ana');

		expect(fake.created[0].path).toBe('Untitled document 2.md');
	});

	it('tells the author, and opens nothing, when the note cannot be created', async () => {
		const fake = fakeApp({ failCreate: true });

		await createDocument(fake.app, 'ana');

		expect(shown).toEqual([CREATE_FAILED_MESSAGE]);
		expect(fake.opened).toEqual([]);
	});

	// The owner is written into front matter unquoted, so a name from a hand-edited
	// settings file that could start another line must never reach it.
	for (const bad of ['', 'ana\nowner: someone', 'ana nguyen', '.ana', 'a'.repeat(300)]) {
		it(`creates nothing for an owner that is not a GitLab username (${JSON.stringify(bad.slice(0, 20))})`, async () => {
			const fake = fakeApp();

			await createDocument(fake.app, bad);

			expect(fake.created).toEqual([]);
			expect(shown).toEqual([AUTHOR_MESSAGES.notReady]);
		});
	}
});
