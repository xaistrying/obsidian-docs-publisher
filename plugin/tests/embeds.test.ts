import { describe, expect, it } from 'vitest';
import type { EmbedReference, VaultEmbedIndex } from '../src/doc-authoring/embeds';
import { resolveEmbeddedAttachments } from '../src/doc-authoring/embeds';

/**
 * A vault, as much of one as resolution asks about: which embeds a note
 * carries, what the resolver makes of a wikilink, and which paths hold files.
 *
 * `resolver` is given explicitly rather than derived from `files`, which is
 * the point of the fake. Obsidian's shortest-path rule is what decides WHICH
 * `diagram.png` a note means, this code must not reimplement it, and a fake
 * that guessed on the resolver's behalf would let a reimplementation pass.
 */
function vault(params: {
	embeds: Record<string, EmbedReference[]>;
	files?: string[];
	resolver?: Record<string, string>;
}): VaultEmbedIndex {
	const files = new Set(params.files ?? []);
	const resolver = params.resolver ?? {};
	return {
		embedsFor: (notePath) => params.embeds[notePath] ?? [],
		resolveLinkpath: (linkpath, fromNotePath) => resolver[`${fromNotePath}::${linkpath}`] ?? null,
		fileAt: (path) => (files.has(path) ? path : null),
	};
}

function wikilink(link: string): EmbedReference {
	return { link, original: `![[${link}]]` };
}

function markdownLink(link: string): EmbedReference {
	return { link, original: `![](${link})` };
}

describe('resolving what a note embeds', () => {
	it('resolves a wikilink through the vault resolver rather than by name', () => {
		const index = vault({
			embeds: { 'Guides/Setup.md': [wikilink('diagram.png')] },
			resolver: { 'Guides/Setup.md::diagram.png': 'Guides/assets/diagram.png' },
			files: ['Guides/assets/diagram.png'],
		});

		expect(resolveEmbeddedAttachments('Guides/Setup.md', index)).toEqual(['Guides/assets/diagram.png']);
	});

	it('takes the resolver-selected file when two folders hold the same name', () => {
		// Both exist; only the resolver knows which one THIS note means. A
		// filename match over the vault would have equal claim to either, which
		// is the bug this test exists to keep out.
		const index = vault({
			embeds: {
				'Guides/Setup.md': [wikilink('diagram.png')],
				'Errors/Faults.md': [wikilink('diagram.png')],
			},
			resolver: {
				'Guides/Setup.md::diagram.png': 'Guides/assets/diagram.png',
				'Errors/Faults.md::diagram.png': 'Errors/assets/diagram.png',
			},
			files: ['Guides/assets/diagram.png', 'Errors/assets/diagram.png'],
		});

		expect(resolveEmbeddedAttachments('Guides/Setup.md', index)).toEqual(['Guides/assets/diagram.png']);
		expect(resolveEmbeddedAttachments('Errors/Faults.md', index)).toEqual(['Errors/assets/diagram.png']);
	});

	it('resolves a markdown-style embed relative to the note', () => {
		const index = vault({
			embeds: { 'Guides/Setup.md': [markdownLink('assets/panel.png')] },
			files: ['Guides/assets/panel.png'],
		});

		expect(resolveEmbeddedAttachments('Guides/Setup.md', index)).toEqual(['Guides/assets/panel.png']);
	});

	it('resolves a markdown-style embed that climbs out of the note folder', () => {
		const index = vault({
			embeds: { 'Guides/Setup.md': [markdownLink('../Shared/logo.png')] },
			files: ['Shared/logo.png'],
		});

		expect(resolveEmbeddedAttachments('Guides/Setup.md', index)).toEqual(['Shared/logo.png']);
	});

	it('decodes a percent-encoded markdown path', () => {
		const index = vault({
			embeds: { 'Guides/Setup.md': [markdownLink('assets/wiring%20diagram.png')] },
			files: ['Guides/assets/wiring diagram.png'],
		});

		expect(resolveEmbeddedAttachments('Guides/Setup.md', index)).toEqual([
			'Guides/assets/wiring diagram.png',
		]);
	});

	it('carries each file once, however many times it is embedded', () => {
		const index = vault({
			embeds: {
				'Guides/Setup.md': [markdownLink('assets/panel.png'), markdownLink('assets/panel.png')],
			},
			files: ['Guides/assets/panel.png'],
		});

		expect(resolveEmbeddedAttachments('Guides/Setup.md', index)).toEqual(['Guides/assets/panel.png']);
	});

	it('keeps the order the note embeds them in', () => {
		const index = vault({
			embeds: {
				'Setup.md': [markdownLink('b.png'), markdownLink('a.png')],
			},
			files: ['a.png', 'b.png'],
		});

		expect(resolveEmbeddedAttachments('Setup.md', index)).toEqual(['b.png', 'a.png']);
	});
});

describe('an embed that cannot be carried', () => {
	it('skips an unresolvable wikilink without failing', () => {
		const index = vault({
			embeds: { 'Setup.md': [wikilink('missing.png'), markdownLink('real.png')] },
			files: ['real.png'],
		});

		expect(resolveEmbeddedAttachments('Setup.md', index)).toEqual(['real.png']);
	});

	it('skips a markdown embed naming no file in the vault', () => {
		const index = vault({
			embeds: { 'Setup.md': [markdownLink('assets/typo.png')] },
			files: [],
		});

		expect(resolveEmbeddedAttachments('Setup.md', index)).toEqual([]);
	});

	it('skips an embed that climbs above the vault root', () => {
		const index = vault({
			embeds: { 'Guides/Setup.md': [markdownLink('../../outside/secret.png')] },
			files: ['outside/secret.png'],
		});

		expect(resolveEmbeddedAttachments('Guides/Setup.md', index)).toEqual([]);
	});

	it('skips an embed addressed by URL', () => {
		const index = vault({
			embeds: {
				'Setup.md': [markdownLink('https://example.com/logo.png'), markdownLink('local.png')],
			},
			files: ['local.png'],
		});

		expect(resolveEmbeddedAttachments('Setup.md', index)).toEqual(['local.png']);
	});

	it('skips an embed of the note itself', () => {
		const index = vault({
			embeds: { 'Setup.md': [wikilink('Setup')] },
			resolver: { 'Setup.md::Setup': 'Setup.md' },
			files: ['Setup.md'],
		});

		expect(resolveEmbeddedAttachments('Setup.md', index)).toEqual([]);
	});

	it('skips a transcluded note, which keeps the changed-path rule exact', () => {
		// Not tidiness: `getMergeRequestChangedPath` identifies a document as
		// the single markdown file its submission changed. Carrying a second
		// note would make this document's own path unresolvable and take the
		// path-mismatch check, Reset and recovery's fallback down with it.
		const index = vault({
			embeds: { 'Setup.md': [wikilink('Other Document'), markdownLink('panel.png')] },
			resolver: { 'Setup.md::Other Document': 'Guides/Other Document.md' },
			files: ['Guides/Other Document.md', 'panel.png'],
		});

		expect(resolveEmbeddedAttachments('Setup.md', index)).toEqual(['panel.png']);
	});

	it('carries nothing for a note that embeds nothing', () => {
		expect(resolveEmbeddedAttachments('Setup.md', vault({ embeds: {} }))).toEqual([]);
	});
});
