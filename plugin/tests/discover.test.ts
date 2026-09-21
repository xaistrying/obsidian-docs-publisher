import { afterEach, describe, expect, it } from 'vitest';
// From the stub by path rather than through the `obsidian` specifier — see
// the note in `submission-files.test.ts`.
import { setRequestUrlHandler, stubResponse } from './obsidian-stub';
import type { RequestUrlParam } from './obsidian-stub';
import {
	discoveryCandidates,
	isDiscoverableDocument,
	resolveDiscoverableDocuments,
} from '../src/submission-tracking/discover';

/**
 * The two rules that decide what Import offers, and the propagation of the
 * one fact that must never be lost on the way to the author.
 *
 * The candidate comparison and the exclusion rule are pure, so they are
 * tested as what they are. Truncation is not: it starts at the transport and
 * has to survive three layers to reach the surface, and the bug worth
 * catching is one of those layers quietly dropping it.
 */

const DETAILS = { host: 'https://gitlab.example.com', projectId: '42', token: 'x' };

let restore: (() => void) | null = null;

afterEach(() => {
	restore?.();
	restore = null;
});

describe('which remote paths are candidates for import', () => {
	it('offers a markdown document the vault has no file at', () => {
		expect(discoveryCandidates(['Guides/Setup.md'], new Set())).toEqual(['Guides/Setup.md']);
	});

	it('does not offer one the vault already holds at that path', () => {
		expect(discoveryCandidates(['Guides/Setup.md'], new Set(['Guides/Setup.md']))).toEqual([]);
	});

	it('compares case-sensitively', () => {
		// `Known-errors/` and `known-errors/` are different locations that
		// orphan each other, and no file explorer on Windows or macOS shows
		// the author as different (`docs/document-identity.md` §4). Folding
		// case here would hide a document the vault genuinely does not have.
		expect(discoveryCandidates(['Known-errors/A.md'], new Set(['known-errors/a.md']))).toEqual([
			'Known-errors/A.md',
		]);
	});

	it('still offers a document the vault holds at a DIFFERENT path', () => {
		// Someone moved it locally. It appears here, and importing it is
		// refused by the duplicate-`doc_id` check with the colliding note
		// named — a refusal the author can act on, rather than a document
		// silently missing from the list (design.md decision 4).
		expect(discoveryCandidates(['Guides/Setup.md'], new Set(['Moved/Setup.md']))).toEqual([
			'Guides/Setup.md',
		]);
	});

	it('ignores everything that is not markdown', () => {
		expect(discoveryCandidates(['Guides/assets/diagram.png', 'README'], new Set())).toEqual([]);
	});

	it('ignores markdown under a dot-folder, which the vault can never hold', () => {
		// OBSERVED on the target project 2026-09-14: the vault is committed
		// whole, so its own `.obsidian/` and `.claudian/` are on the default
		// branch. Obsidian's index contains no dot-folder, so such a path can
		// never match a vault path — it would be offered on every refresh
		// forever, and importing it could not work, since `vault.create`
		// writes into the vault and a hidden folder is not in it.
		expect(
			discoveryCandidates(
				[
					'.obsidian/plugins/realclaudian/notes.md',
					'.claudian/sessions/log.md',
					'Guides/Setup.md',
				],
				new Set()
			)
		).toEqual(['Guides/Setup.md']);
	});

	it('cedes a document whose record this vault holds with no note', () => {
		// The two-list contradiction, in one assertion. `test-007` has a
		// stored record and no note, so it belongs to "Documents you can
		// recover" — offering it here too put one document in two lists, and
		// recovery said "Not available" while this said "Import"
		// (`docs/panel-tracking-scope.md`, 2026-09-20).
		expect(
			discoveryCandidates(
				['test/test-007.md', 'Guides/Setup.md'],
				new Set(),
				new Set(['test-007'])
			)
		).toEqual(['Guides/Setup.md']);
	});

	it('still offers a document whose note the vault HAS, moved elsewhere', () => {
		// Only the ORPHANED set is ceded. A record whose note is in the vault
		// at another path is not recovery's business, and the submission-
		// tracking spec requires this document to stay discoverable so the
		// import-time duplicate check is what reports the collision.
		expect(
			discoveryCandidates(['Guides/Setup.md'], new Set(['Moved/Setup.md']), new Set())
		).toEqual(['Guides/Setup.md']);
	});

	it('does not mistake a dot inside a name for a hidden folder', () => {
		expect(discoveryCandidates(['Guides/v1.2/Setup.md'], new Set())).toEqual([
			'Guides/v1.2/Setup.md',
		]);
	});
});

describe('which remote files are documents at all', () => {
	it('excludes a file carrying no front matter', () => {
		expect(isDiscoverableDocument('# Service Doc KB\n\nAll the runbooks.\n')).toBe(false);
	});

	it('includes a document carrying only part of the contract', () => {
		// The fields it lacks — `doc_id`, `category`, `lifecycle` — are
		// precisely the ones this plugin itself writes, so requiring them
		// would empty the list against the real corpus
		// (`docs/ce-verification.md` §E2).
		const content = '---\ntitle: "Update Device Details"\nowner: ivan\n---\n\nSteps.\n';

		expect(isDiscoverableDocument(content)).toBe(true);
	});

	it('includes a file named like a placeholder when it carries front matter', () => {
		// Exclusion is decided by the absence of front matter and NEVER by the
		// filename: a denylist needs extending forever and would hide a real
		// document someone named badly (design.md decision 6).
		expect(isDiscoverableDocument('---\ntitle: "TBD"\n---\n')).toBe(true);
	});
});

/**
 * Answers the three reads a resolution makes: the project (for its default
 * branch), the repository tree, and each candidate's raw content.
 *
 * `treePages` is given as whole pages rather than a flat list, because
 * whether the listing is truncated is decided by page fullness and that is
 * the thing under test.
 */
function remote(params: { treePages: string[][]; files?: Record<string, string> }): void {
	const files = params.files ?? {};
	restore = setRequestUrlHandler((request: RequestUrlParam) => {
		const url = request.url;

		if (url.includes('/repository/tree')) {
			const page = Number(/[?&]page=(\d+)/.exec(url)?.[1] ?? '1');
			const entries = params.treePages[page - 1] ?? [];
			return stubResponse({
				status: 200,
				body: JSON.stringify(entries.map((path) => ({ type: 'blob', path }))),
			});
		}

		if (url.includes('/repository/files/')) {
			const path = decodeURIComponent(/\/repository\/files\/([^/]+)\/raw/.exec(url)?.[1] ?? '');
			const content = files[path];
			return content === undefined
				? stubResponse({ status: 404, body: '{"message":"404 File Not Found"}' })
				: stubResponse({ status: 200, body: content });
		}

		return stubResponse({ status: 200, body: JSON.stringify({ default_branch: 'main' }) });
	});
}

/** A page exactly full of files no candidate rule will pick up. */
function fullPageOfImages(page: number): string[] {
	return Array.from({ length: 100 }, (_, index) => `assets/p${page}-${index}.png`);
}

describe('resolving what the remote has and the vault does not', () => {
	it('reports a complete listing as complete', async () => {
		remote({
			treePages: [['Guides/Setup.md', 'README.md']],
			files: {
				'Guides/Setup.md': '---\ntitle: "Setup"\n---\n\nSteps.\n',
				'README.md': '# Repo\n',
			},
		});

		const result = await resolveDiscoverableDocuments(DETAILS, new Set());

		expect(result).toEqual({
			ok: true,
			value: {
				// README.md was listed and read, and excluded for carrying no
				// front matter — the exclusion runs on content, not on the name.
				documents: [{ path: 'Guides/Setup.md', content: '---\ntitle: "Setup"\n---\n\nSteps.\n' }],
				incomplete: false,
				ref: 'main',
				// The whole listing, kept for the attachment fetch to resolve
				// an imported note's embeds against — README.md included, since
				// being excluded as a DOCUMENT says nothing about whether some
				// document embeds it.
				paths: ['Guides/Setup.md', 'README.md'],
			},
		});
	});

	it('reports a truncated listing as incomplete rather than as the full set', async () => {
		// Twenty full pages: the cap is reached with a full page still coming
		// back, so there may be more. The documents it DID find are still
		// returned — the author is not left with nothing — but the answer says
		// it is partial, which is what stops a caller resolving "the corpus
		// does not have this" from it.
		const treePages = Array.from({ length: 21 }, (_, index) => fullPageOfImages(index + 1));
		treePages[0] = [...treePages[0].slice(1), 'Guides/Setup.md'];
		remote({ treePages, files: { 'Guides/Setup.md': '---\ntitle: "Setup"\n---\n' } });

		const result = await resolveDiscoverableDocuments(DETAILS, new Set());

		expect(result.ok).toBe(true);
		expect(result.ok && result.value.incomplete).toBe(true);
		expect(result.ok && result.value.documents.map((entry) => entry.path)).toEqual([
			'Guides/Setup.md',
		]);
	});

	it('carries a failed read out as a failure, never as an empty corpus', async () => {
		// The distinction the whole three-way answer exists for: "nothing to
		// import" and "the question could not be asked" must not arrive
		// looking the same.
		restore = setRequestUrlHandler(() => stubResponse({ status: 403, body: '{}' }));

		expect(await resolveDiscoverableDocuments(DETAILS, new Set())).toEqual({
			ok: false,
			failure: 'not-reachable',
		});
	});
});
