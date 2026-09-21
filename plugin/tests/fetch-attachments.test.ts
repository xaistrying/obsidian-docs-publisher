import { describe, expect, it } from 'vitest';
import type { EmbedReference } from '../src/doc-authoring/embeds';
import type { AttachmentSource } from '../src/doc-authoring/fetch-attachments';
import { fetchDocumentAttachments } from '../src/doc-authoring/fetch-attachments';

/**
 * Bringing an imported or recovered document's images down with it.
 *
 * THE TEST THAT MATTERS MOST HERE IS THE FIRST ONE. design.md decision 3
 * specified resolving an imported note's embeds through
 * `resolveEmbeddedAttachments` backed by the VAULT — and that resolves
 * nothing at all for a note whose images are not in the vault yet, which is
 * every imported note by construction. The correction was to keep the
 * function and change the index it reads. A regression to the vault-backed
 * index would make every assertion below return an empty report, so these
 * stand guard over the correction rather than merely over the code.
 */

/**
 * The four answers fetching asks for, and a record of everything written.
 *
 * `remote` maps a remote path to its bytes; a path absent from it is a file
 * the listing named and the server would not deliver.
 */
function source(params: {
	embeds?: EmbedReference[];
	vault?: string[];
	remote?: Record<string, string>;
	unwritable?: string[];
}) {
	const held = new Set(params.vault ?? []);
	const remote = params.remote ?? {};
	const unwritable = new Set(params.unwritable ?? []);
	const written: { path: string; base64: string }[] = [];

	const source: AttachmentSource = {
		embedsFor: () => params.embeds ?? [],
		heldInVault: (path) => held.has(path),
		readRemote: async (path) => {
			const base64 = remote[path];
			return base64 === undefined
				? { ok: true, value: { exists: false } }
				: { ok: true, value: { exists: true, base64 } };
		},
		write: async (path, base64) => {
			if (unwritable.has(path)) {
				return false;
			}
			written.push({ path, base64 });
			held.add(path);
			return true;
		},
	};

	return { source, written };
}

function wikilink(link: string): EmbedReference {
	return { link, original: `![[${link}]]` };
}

function markdownLink(link: string): EmbedReference {
	return { link, original: `![](${link})` };
}

describe('fetching what an imported document embeds', () => {
	it('fetches a wikilink target that is NOT in the vault yet', async () => {
		// The whole correction, in one assertion. The vault holds nothing; the
		// remote listing is what places the link.
		const { source: fake, written } = source({
			embeds: [wikilink('diagram.png')],
			remote: { 'Guides/assets/diagram.png': 'AAAA' },
		});

		const report = await fetchDocumentAttachments(
			{ notePath: 'Guides/Setup.md', remotePaths: ['Guides/Setup.md', 'Guides/assets/diagram.png'] },
			fake
		);

		expect(report.fetched).toEqual(['Guides/assets/diagram.png']);
		expect(written).toEqual([{ path: 'Guides/assets/diagram.png', base64: 'AAAA' }]);
	});

	it('resolves a markdown-style embed as a path relative to the note', async () => {
		const { source: fake, written } = source({
			embeds: [markdownLink('assets/diagram.png')],
			remote: { 'Guides/assets/diagram.png': 'AAAA' },
		});

		const report = await fetchDocumentAttachments(
			{ notePath: 'Guides/Setup.md', remotePaths: ['Guides/assets/diagram.png'] },
			fake
		);

		expect(report.fetched).toEqual(['Guides/assets/diagram.png']);
		expect(written).toHaveLength(1);
	});

	it('writes each attachment at its own remote path', async () => {
		const { source: fake, written } = source({
			embeds: [wikilink('one.png'), wikilink('two.png')],
			remote: { 'Guides/assets/one.png': 'AA', 'shared/two.png': 'BB' },
		});

		await fetchDocumentAttachments(
			{
				notePath: 'Guides/Setup.md',
				remotePaths: ['Guides/assets/one.png', 'shared/two.png'],
			},
			fake
		);

		expect(written.map((entry) => entry.path)).toEqual(['Guides/assets/one.png', 'shared/two.png']);
	});

	it('leaves a file the vault already holds at that path alone', async () => {
		// A shared logo twenty documents embed is fetched once, by whichever
		// import got there first. Overwriting it would destroy whatever the
		// author has at that path for no gain.
		const { source: fake, written } = source({
			embeds: [wikilink('logo.svg')],
			vault: ['shared/logo.svg'],
			remote: { 'shared/logo.svg': 'AA' },
		});

		const report = await fetchDocumentAttachments(
			{ notePath: 'Guides/Setup.md', remotePaths: ['shared/logo.svg'] },
			fake
		);

		expect(report.kept).toEqual(['shared/logo.svg']);
		expect(report.fetched).toEqual([]);
		expect(written).toEqual([]);
	});
});

describe('what the author is told when an image does not arrive', () => {
	it('reports an attachment the listing named but the server would not deliver', async () => {
		const { source: fake } = source({ embeds: [wikilink('diagram.png')], remote: {} });

		const report = await fetchDocumentAttachments(
			{ notePath: 'Guides/Setup.md', remotePaths: ['Guides/assets/diagram.png'] },
			fake
		);

		expect(report.failed).toEqual(['Guides/assets/diagram.png']);
		expect(report.fetched).toEqual([]);
	});

	it('reports an attachment whose bytes arrived but could not be written', async () => {
		const { source: fake } = source({
			embeds: [wikilink('diagram.png')],
			remote: { 'Guides/assets/diagram.png': 'AA' },
			unwritable: ['Guides/assets/diagram.png'],
		});

		const report = await fetchDocumentAttachments(
			{ notePath: 'Guides/Setup.md', remotePaths: ['Guides/assets/diagram.png'] },
			fake
		);

		expect(report.failed).toEqual(['Guides/assets/diagram.png']);
	});

	it('reports an ambiguous wikilink rather than guessing which file it means', async () => {
		// Two folders hold a `diagram.png`. Only Obsidian's own shortest-path
		// rule decides which one THIS note means, and reimplementing that rule
		// is what add-attachment-sync rejected — so this declines to choose and
		// says so. Handing over the wrong image would be worse than handing
		// over none.
		const { source: fake, written } = source({
			embeds: [wikilink('diagram.png')],
			remote: { 'Guides/assets/diagram.png': 'AA', 'Errors/assets/diagram.png': 'BB' },
		});

		const report = await fetchDocumentAttachments(
			{
				notePath: 'Guides/Setup.md',
				remotePaths: ['Guides/assets/diagram.png', 'Errors/assets/diagram.png'],
			},
			fake
		);

		expect(report.unresolved).toEqual(['diagram.png']);
		expect(written).toEqual([]);
	});

	it('reports an embed the remote listing holds nothing for', async () => {
		const { source: fake } = source({ embeds: [wikilink('missing.png')], remote: {} });

		const report = await fetchDocumentAttachments(
			{ notePath: 'Guides/Setup.md', remotePaths: ['Guides/Setup.md'] },
			fake
		);

		expect(report.unresolved).toEqual(['missing.png']);
		expect(report.failed).toEqual([]);
	});

	it('says nothing about a link to another NOTE', async () => {
		// Transclusion is out of scope project-wide and `embeds.ts` already
		// skips it silently on the vault side. Reporting it here would turn a
		// deliberate non-feature into a failure message on every document that
		// uses one.
		const { source: fake } = source({
			embeds: [wikilink('Other Document'), wikilink('Other Document.md')],
			remote: {},
		});

		const report = await fetchDocumentAttachments(
			{ notePath: 'Guides/Setup.md', remotePaths: ['Guides/Other Document.md'] },
			fake
		);

		expect(report.unresolved).toEqual([]);
		expect(report.failed).toEqual([]);
	});
});
