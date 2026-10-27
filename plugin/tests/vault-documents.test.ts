import { describe, expect, it } from 'vitest';
import type { App, TFile } from 'obsidian';
import { listCandidateNotes, listVaultDocuments } from '../src/plugin-shell/vault-documents';
import { readDocId } from '../src/submission-tracking/resolve';

/** A note, and what Obsidian's metadata cache says its front matter holds. */
function note(path: string, frontmatter: Record<string, unknown> | undefined): { file: TFile; frontmatter: Record<string, unknown> | undefined } {
	const basename = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '');
	return { file: { path, basename, extension: 'md' } as TFile, frontmatter };
}

function appWith(notes: Array<ReturnType<typeof note>>): App {
	return {
		vault: { getMarkdownFiles: () => notes.map((n) => n.file) },
		metadataCache: {
			getFileCache: (file: TFile) => {
				const found = notes.find((n) => n.file.path === file.path);
				return found === undefined || found.frontmatter === undefined ? null : { frontmatter: found.frontmatter };
			},
		},
	} as unknown as App;
}

describe('reading a note\'s identity', () => {
	it('is the doc_id in its front matter, as written', () => {
		const n = note('Docs/Printer.md', { doc_id: 'Printer' });

		expect(readDocId(appWith([n]), n.file)).toBe('Printer');
	});

	it('is nothing for a note with no front matter, or none of that name', () => {
		const bare = note('a.md', undefined);
		const other = note('b.md', { title: 'x' });

		expect(readDocId(appWith([bare, other]), bare.file)).toBeNull();
		expect(readDocId(appWith([bare, other]), other.file)).toBeNull();
	});

	it('is nothing for a value that is empty, blank or not text', () => {
		const empty = note('a.md', { doc_id: '' });
		const blank = note('b.md', { doc_id: '   ' });
		const number = note('c.md', { doc_id: 12 });
		const list = note('d.md', { doc_id: ['x'] });
		const app = appWith([empty, blank, number, list]);

		for (const n of [empty, blank, number, list]) {
			expect(readDocId(app, n.file), n.file.path).toBeNull();
		}
	});
});

describe('the notes that carry an identity', () => {
	it('lists only those, sorted by the name the author sees', () => {
		const app = appWith([
			note('Docs/Zebra.md', { doc_id: 'Zebra' }),
			note('Docs/Plain.md', {}),
			note('Docs/Alpha.md', { doc_id: 'Alpha' }),
			note('Other/Middle.md', { doc_id: 'Middle' }),
		]);

		expect(listVaultDocuments(app).map((d) => [d.docId, d.file.path])).toEqual([
			['Alpha', 'Docs/Alpha.md'],
			['Middle', 'Other/Middle.md'],
			['Zebra', 'Docs/Zebra.md'],
		]);
	});

	it('lists nothing for a vault where no note has been sent', () => {
		expect(listVaultDocuments(appWith([note('a.md', {}), note('b.md', undefined)]))).toEqual([]);
	});

	it('lists two notes that claim one identity, so a duplicate can be found', () => {
		const app = appWith([note('a/Printer.md', { doc_id: 'Printer' }), note('b/Printer.md', { doc_id: 'Printer' })]);

		expect(listVaultDocuments(app)).toHaveLength(2);
	});
});

describe('the notes the panel can say something about', () => {
	it('lists every markdown note outside hidden and reserved folders, by path, whether or not it was ever sent', () => {
		const app = appWith([
			note('L2/b.md', { title: 'B', category: 'SOP' }),
			note('L1/a.md', {}),
			note('.obsidian/plugins/x.md', {}),
			note('.git/y.md', {}),
			note('.claudian/z.md', {}),
			note('top.md', undefined),
		]);

		expect(listCandidateNotes(app).map((c) => c.file.path)).toEqual(['L1/a.md', 'L2/b.md', 'top.md']);
	});

	it('lists a note whatever its properties, and reads the legacy identity as an alias', () => {
		const app = appWith([
			note('both.md', { title: 'T', category: 'SOP' }),
			note('title-only.md', { title: 'T' }),
			note('bare.md', undefined),
			note('legacy.md', { doc_id: 'Legacy', title: 'T', category: 'SOP' }),
		]);

		expect(listCandidateNotes(app).map((c) => [c.file.path, c.legacyDocId])).toEqual([
			['bare.md', null],
			['both.md', null],
			['legacy.md', 'Legacy'],
			['title-only.md', null],
		]);
	});
});
