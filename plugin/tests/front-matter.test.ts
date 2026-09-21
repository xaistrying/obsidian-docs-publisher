import { describe, expect, it } from 'vitest';
import { withDocId, withSubmissionFrontMatter } from '../src/doc-authoring/front-matter';

/**
 * The string operations that decide what an imported document's front matter
 * ends up saying.
 *
 * Both exist because `FileManager.processFrontMatter` re-serializes the whole
 * block, which would rewrite a stranger's quoting and key order. These edit
 * the text instead, and the failure mode that buys — a key written twice —
 * is what most of this file is about. An imported document already carries
 * `doc_id`, so a first submit that appended blindly would commit a document
 * giving two answers to the question of what it is.
 */

describe('freezing doc_id at import', () => {
	it('appends doc_id and changes nothing else', () => {
		const content = '---\ntitle: "Setup"\nowner: ivan\n---\n\n# Steps\n';

		expect(withDocId(content, 'BS-SOP-001')).toBe(
			'---\ntitle: "Setup"\nowner: ivan\ndoc_id: BS-SOP-001\n---\n\n# Steps\n'
		);
	});

	it('leaves content with no front matter block untouched', () => {
		expect(withDocId('# Just a heading\n', 'X')).toBe('# Just a heading\n');
	});

	it('preserves a list-valued field as written', () => {
		// The real corpus carries `tags` as a list. Nothing here may reflow it.
		const content = '---\ntitle: "Setup"\ntags:\n  - contribution\n  - process\n---\n\nBody.\n';

		expect(withDocId(content, 'Setup')).toBe(
			'---\ntitle: "Setup"\ntags:\n  - contribution\n  - process\ndoc_id: Setup\n---\n\nBody.\n'
		);
	});
});

describe('completing the front matter at a first submit', () => {
	it('adds all three when the block carries none of them', () => {
		const content = '---\nowner: ivan\ncreated: 2026-01-02\n---\n\nBody.\n';

		expect(
			withSubmissionFrontMatter(content, { title: 'Setup', category: 'SOP', docId: 'Setup' })
		).toBe(
			'---\nowner: ivan\ncreated: 2026-01-02\ntitle: "Setup"\ncategory: SOP\ndoc_id: Setup\n---\n\nBody.\n'
		);
	});

	it('does NOT duplicate a doc_id the note already carries', () => {
		// The imported-document case, and the one that would have shipped
		// broken: import freezes `doc_id`, then the first submit merges the
		// three fields in. Appending blindly writes a second `doc_id` key.
		const content = '---\ntitle: "Old"\nowner: ivan\ndoc_id: Contribution-Guide\n---\n\nBody.\n';

		const merged = withSubmissionFrontMatter(content, {
			title: 'Contribution Guide',
			category: 'SOP',
			docId: 'Contribution-Guide',
		});

		expect(merged.match(/^doc_id:/gm)).toHaveLength(1);
		expect(merged).toBe(
			'---\nowner: ivan\ntitle: "Contribution Guide"\ncategory: SOP\ndoc_id: Contribution-Guide\n---\n\nBody.\n'
		);
	});

	it('keeps every field it does not own, in the order it found them', () => {
		// The shape `docs/ce-verification.md` §E2 actually found, plus the
		// `doc_id` import adds.
		const content =
			'---\ntype: process\naudience: internal\nowner: Production Service Team (SDM)\n' +
			'status: published\nlast_reviewed: 2026-07-22\ntags:\n  - governance\n' +
			'doc_id: Contribution-Guide\n---\n\nBody.\n';

		const merged = withSubmissionFrontMatter(content, {
			title: 'How to Contribute',
			category: 'SOP',
			docId: 'Contribution-Guide',
		});

		expect(merged).toBe(
			'---\ntype: process\naudience: internal\nowner: Production Service Team (SDM)\n' +
				'status: published\nlast_reviewed: 2026-07-22\ntags:\n  - governance\n' +
				'title: "How to Contribute"\ncategory: SOP\ndoc_id: Contribution-Guide\n---\n\nBody.\n'
		);
	});

	it('escapes a title carrying a quote', () => {
		const merged = withSubmissionFrontMatter('---\nowner: ivan\n---\n', {
			title: 'The "Quick" Guide',
			category: 'SOP',
			docId: 'Guide',
		});

		expect(merged).toContain('title: "The \\"Quick\\" Guide"');
	});
});
