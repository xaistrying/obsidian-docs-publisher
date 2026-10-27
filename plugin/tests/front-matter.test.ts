import { describe, expect, it } from 'vitest';
import type { App, TFile } from 'obsidian';
import { hasSubmissionCategory, readSubmissionFields, withSubmissionFrontMatter } from '../src/doc-authoring/front-matter';

/**
 * The string operation that decides what a note's front matter says when it is
 * sent and lacks a title or a category.
 *
 * It exists because `FileManager.processFrontMatter` re-serializes the whole
 * block, which would rewrite a stranger's quoting and key order. This edits the
 * text instead, and the failure mode that buys — a key written twice — is what
 * most of this file is about. It writes no `doc_id`: a note's identity is what
 * git knows about it, and one an older version wrote is the author's and stays
 * exactly as it is.
 */

describe('completing the front matter when a note is sent', () => {
	it('adds the title and category when the block carries neither, and no identity', () => {
		const content = '---\nowner: ivan\ncreated: 2026-01-02\n---\n\nBody.\n';

		expect(withSubmissionFrontMatter(content, { title: 'Setup', category: 'SOP' })).toBe(
			'---\nowner: ivan\ncreated: 2026-01-02\ntitle: "Setup"\ncategory: SOP\n---\n\nBody.\n'
		);
	});

	it('adds no doc_id property to a note that has none', () => {
		const merged = withSubmissionFrontMatter('---\nowner: ivan\n---\nBody\n', { title: 'T', category: 'SOP' });

		expect(merged).not.toMatch(/doc_id/);
	});

	it('leaves a doc_id the note already carries exactly where it was, neither moved nor removed nor repeated', () => {
		const content = '---\ntitle: "Old"\nowner: ivan\ndoc_id: Contribution-Guide\n---\n\nBody.\n';

		const merged = withSubmissionFrontMatter(content, { title: 'Contribution Guide', category: 'SOP' });

		expect(merged.match(/^doc_id:/gm)).toHaveLength(1);
		expect(merged).toBe('---\nowner: ivan\ndoc_id: Contribution-Guide\ntitle: "Contribution Guide"\ncategory: SOP\n---\n\nBody.\n');
	});

	it('keeps every field it does not own, in the order it found them', () => {
		// The shape `docs/ce-verification.md` §E2 actually found.
		const content =
			'---\ntype: process\naudience: internal\nowner: Production Service Team (SDM)\n' +
			'status: published\nlast_reviewed: 2026-07-22\ntags:\n  - governance\n---\n\nBody.\n';

		const merged = withSubmissionFrontMatter(content, { title: 'How to Contribute', category: 'SOP' });

		expect(merged).toBe(
			'---\ntype: process\naudience: internal\nowner: Production Service Team (SDM)\n' +
				'status: published\nlast_reviewed: 2026-07-22\ntags:\n  - governance\n' +
				'title: "How to Contribute"\ncategory: SOP\n---\n\nBody.\n'
		);
	});

	it('escapes a title carrying a quote', () => {
		const merged = withSubmissionFrontMatter('---\nowner: ivan\n---\n', { title: 'The "Quick" Guide', category: 'SOP' });

		expect(merged).toContain('title: "The \\"Quick\\" Guide"');
	});
});

describe('reading the title and category a note already carries', () => {
	const noteWith = (frontmatter: Record<string, unknown> | undefined): { app: App; file: TFile } => {
		const file = { path: 'a.md' } as TFile;
		const app = {
			metadataCache: { getFileCache: () => (frontmatter === undefined ? null : { frontmatter }) },
		} as unknown as App;
		return { app, file };
	};

	it('gives both when they are there and the category is one of the nine, trimming the title', () => {
		const { app, file } = noteWith({ title: '  Printer setup  ', category: 'SOP' });

		expect(readSubmissionFields(app, file)).toEqual({ title: 'Printer setup', category: 'SOP' });
	});

	it('gives nothing when the title is missing, blank or not text', () => {
		for (const title of [undefined, '', '   ', 5]) {
			const { app, file } = noteWith({ title, category: 'SOP' });
			expect(readSubmissionFields(app, file), String(title)).toBeNull();
		}
	});

	it('gives nothing when the category is missing or not one of the nine', () => {
		for (const category of [undefined, '', 'Notes', 'sop', 7]) {
			const { app, file } = noteWith({ title: 'T', category });
			expect(readSubmissionFields(app, file), String(category)).toBeNull();
		}
	});

	it('gives nothing for a note with no front matter at all', () => {
		const { app, file } = noteWith(undefined);

		expect(readSubmissionFields(app, file)).toBeNull();
	});

	it('knows a note has been through a first send by its category, whatever the title says now', () => {
		expect(hasSubmissionCategory(noteWith({ category: 'Runbook' }).app, { path: 'a.md' } as TFile)).toBe(true);
		expect(hasSubmissionCategory(noteWith({ title: 'T' }).app, { path: 'a.md' } as TFile)).toBe(false);
		expect(hasSubmissionCategory(noteWith({ category: '  ' }).app, { path: 'a.md' } as TFile)).toBe(false);
		expect(hasSubmissionCategory(noteWith(undefined).app, { path: 'a.md' } as TFile)).toBe(false);
	});
});
