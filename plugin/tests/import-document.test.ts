import { describe, expect, it } from 'vitest';
import type { App } from 'obsidian';
import type { ConnectionState } from '../src/platform-config/connection-state';
import { deriveDocId } from '../src/doc-authoring/doc-id';
import {
	IMPORT_OCCUPIED_MESSAGE,
	importDocument,
	importDuplicateMessage,
} from '../src/doc-authoring/import-document';

/**
 * What Import writes, and what it refuses to write.
 *
 * The two refusals are the reason this module exists at the size it does:
 * an import that collided would produce a second note claiming one identity,
 * and nothing would notice until a submit much later
 * (`docs/panel-tracking-scope.md`). Both are asserted to write NOTHING, not
 * merely to report — a refusal that half-wrote would be worse than no check.
 */

const DETAILS = { host: 'https://gitlab.example.com', projectId: 'group/docs', token: 'x' };

/**
 * A document that embeds nothing, read from the default branch. The
 * attachment fetch has tests of its own over its own fake
 * (`fetch-attachments.test.ts`); here it is inert so these assertions stay
 * about what Import writes and refuses.
 */
const SOURCE = { ref: 'main', remotePaths: [] };

/** Developer, which is the floor `requireAuthoringGate` asks for. */
const VERIFIED: ConnectionState = {
	kind: 'verified',
	identity: { id: 1, name: 'Ivan', username: 'ivan' },
	access: { accessLevel: 30, accessLabel: 'Developer' },
};

/**
 * A vault, as much of one as the import write asks about: which paths are
 * occupied, which notes carry which `doc_id`, and a record of everything
 * created.
 *
 * Built here rather than in `obsidian-stub.ts` on that file's own standing
 * instruction: a stub that starts modelling the vault becomes a second,
 * unverified Obsidian.
 */
function vault(params: { notes?: Record<string, string | null>; folders?: string[] }) {
	const notes = params.notes ?? {};
	const paths = new Set([...Object.keys(notes), ...(params.folders ?? [])]);
	const created: { path: string; content: string }[] = [];
	const createdFolders: string[] = [];

	const files = Object.keys(notes).map((path) => ({
		path,
		basename: path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, ''),
		extension: 'md',
	}));

	const app = {
		vault: {
			getMarkdownFiles: () => files,
			getAbstractFileByPath: (path: string) => (paths.has(path) ? { path } : null),
			createFolder: async (path: string) => {
				createdFolders.push(path);
				paths.add(path);
			},
			create: async (path: string, content: string) => {
				created.push({ path, content });
				paths.add(path);
				return { path };
			},
		},
		metadataCache: {
			getFileCache: (file: { path: string }) => {
				const docId = notes[file.path];
				return docId === null || docId === undefined ? {} : { frontmatter: { doc_id: docId } };
			},
			// Non-null so `awaitNoteIndexed` takes its already-parsed fast path:
			// its other exit waits on a real Obsidian event loop, which is not
			// what any assertion here is about.
			getCache: () => ({ embeds: [] }),
		},
	} as unknown as App;

	return { app, created, createdFolders };
}

describe('importing a discovered document', () => {
	it('writes the note at exactly its remote path, creating missing folders', async () => {
		const { app, created, createdFolders } = vault({});

		const outcome = await importDocument(app, DETAILS, VERIFIED, {
			path: 'Products/Barcode-Scanner/SOPs/BS-SOP-001_Help-Customer-Setup.md',
			content: '---\ntitle: "Help Customer Setup"\n---\n\nSteps.\n',
		}, SOURCE);

		expect(outcome.ok).toBe(true);
		expect(created.map((entry) => entry.path)).toEqual([
			'Products/Barcode-Scanner/SOPs/BS-SOP-001_Help-Customer-Setup.md',
		]);
		expect(createdFolders).toEqual(['Products/Barcode-Scanner/SOPs']);
	});

	it('freezes the doc_id first submit would have derived from the same name', async () => {
		// The SAME rule, asserted against the same function submit uses rather
		// than against a literal: an imported document whose `doc_id` differed
		// from the one its first submit would have snapshotted would resolve
		// to a branch nothing else ever writes to.
		const { app, created } = vault({});

		await importDocument(app, DETAILS, VERIFIED, {
			path: 'Known-errors/SBT-KE-001_EG95-mTLS-Socket.md',
			content: '---\ntitle: "EG95 mTLS"\n---\n',
		}, SOURCE);

		expect(created[0].content).toContain(`doc_id: ${deriveDocId('SBT-KE-001_EG95-mTLS-Socket')}`);
		expect(created[0].content).toContain('doc_id: SBT-KE-001_EG95-mTLS-Socket');
	});

	it('ASCII-folds a name carrying Vietnamese diacritics, as first submit does', async () => {
		const { app, created } = vault({});

		await importDocument(app, DETAILS, VERIFIED, {
			path: 'Huong-dan/HD-001_Cài-đặt-thiết-bị.md',
			content: '---\ntitle: "Cài đặt"\n---\n',
		}, SOURCE);

		expect(created[0].content).toContain(`doc_id: ${deriveDocId('HD-001_Cài-đặt-thiết-bị')}`);
		expect(created[0].content).toContain('doc_id: HD-001_Cai-dat-thiet-bi');
	});

	it('keeps every front matter field it arrived with and adds only doc_id', async () => {
		// Byte for byte, in the order and the spelling someone else wrote
		// them. Re-serializing a stranger's front matter would rewrite their
		// quoting and key order for no reason the author asked for.
		const { app, created } = vault({});
		const content =
			'---\ntitle: "Update Device Details"\nowner: ivan\nlast_reviewed: 2025-11-02\n---\n\n# Steps\n\nOne.\n';

		await importDocument(app, DETAILS, VERIFIED, { path: 'SOPs/BOA-SOP-001.md', content }, SOURCE);

		expect(created[0].content).toBe(
			'---\ntitle: "Update Device Details"\nowner: ivan\nlast_reviewed: 2025-11-02\n' +
				'doc_id: BOA-SOP-001\n---\n\n# Steps\n\nOne.\n'
		);
	});

	it('leaves a doc_id the document already carries exactly as it is', async () => {
		// A document this plugin published carries its own frozen identity.
		// Deriving over the top would write a second `doc_id` key into the
		// block and give the document two answers to the same question.
		const { app, created } = vault({});
		const content = '---\ntitle: "Setup"\ndoc_id: LEGACY-ID-007\n---\n\nSteps.\n';

		await importDocument(app, DETAILS, VERIFIED, { path: 'Guides/Renamed-Since.md', content }, SOURCE);

		expect(created[0].content).toBe(content);
	});
});

describe('what import refuses, before writing anything', () => {
	it('refuses when a note in the vault already carries this doc_id', async () => {
		// Including the case the path comparison deliberately does not hide:
		// the vault holds this document, moved to a folder of its own.
		const { app, created, createdFolders } = vault({ notes: { 'Moved/Setup.md': 'Guides-Setup' } });

		const outcome = await importDocument(app, DETAILS, VERIFIED, {
			path: 'Guides/Guides-Setup.md',
			content: '---\ntitle: "Setup"\n---\n',
		}, SOURCE);

		expect(outcome).toEqual({
			ok: false,
			path: 'Guides/Guides-Setup.md',
			reason: importDuplicateMessage('Guides-Setup', 'Moved/Setup.md'),
		});
		expect(created).toEqual([]);
		expect(createdFolders).toEqual([]);
	});

	it('refuses when a note already occupies the target path', async () => {
		const { app, created } = vault({ notes: { 'Guides/Setup.md': null } });

		const outcome = await importDocument(app, DETAILS, VERIFIED, {
			path: 'Guides/Setup.md',
			content: '---\ntitle: "Setup"\n---\n',
		}, SOURCE);

		expect(outcome).toEqual({
			ok: false,
			path: 'Guides/Setup.md',
			reason: IMPORT_OCCUPIED_MESSAGE,
		});
		expect(created).toEqual([]);
	});

	it('refuses a remote name that cannot become a document ID', async () => {
		const { app, created } = vault({});

		const outcome = await importDocument(app, DETAILS, VERIFIED, {
			path: 'Guides/Setup Guide v2.md',
			content: '---\ntitle: "Setup"\n---\n',
		}, SOURCE);

		expect(outcome.ok).toBe(false);
		expect(created).toEqual([]);
	});

	it('writes nothing at all when the connection cannot author', async () => {
		const { app, created } = vault({});
		const reporter: ConnectionState = {
			kind: 'verified',
			identity: { id: 1, name: 'Ivan', username: 'ivan' },
			access: { accessLevel: 20, accessLabel: 'Reporter' },
		};

		const outcome = await importDocument(app, DETAILS, reporter, {
			path: 'Guides/Setup.md',
			content: '---\ntitle: "Setup"\n---\n',
		}, SOURCE);

		expect(outcome.ok).toBe(false);
		expect(created).toEqual([]);
	});
});

describe('the names a document ID can be derived from', () => {
	/**
	 * Pinned against the real refusals of 2026-09-15
	 * (`docs/ce-verification.md` §E6). Both files that were rejected carried a
	 * SPACE, and both would have been accepted with their parentheses intact —
	 * which is why the refusal message names the space rather than telling the
	 * author to strip punctuation that was never the problem.
	 */
	it('refuses a name carrying a space, parentheses and all', async () => {
		const { app, created } = vault({});

		const outcome = await importDocument(
			app,
			DETAILS,
			VERIFIED,
			{
				path: 'Products/Smart Buddy POS/SOPs/SB-SOP-001_Terminal-Offline (SAMPLE).md',
				content: '---\ntitle: "Sample"\n---\n',
			},
			SOURCE
		);

		expect(outcome.ok).toBe(false);
		expect(created).toEqual([]);
	});

	it('accepts the same name with the space removed', async () => {
		const { app, created } = vault({});

		const outcome = await importDocument(
			app,
			DETAILS,
			VERIFIED,
			{
				path: 'Products/SOPs/SB-SOP-001_Terminal-Offline(SAMPLE).md',
				content: '---\ntitle: "Sample"\n---\n',
			},
			SOURCE
		);

		expect(outcome.ok).toBe(true);
		expect(created[0].content).toContain('doc_id: SB-SOP-001_Terminal-Offline(SAMPLE)');
	});

	it('refuses the second of two files sharing a basename across folders', async () => {
		// The corpus case: three READMEs deriving one `doc_id`. The folder is
		// not part of the identity, so the second collides with the first.
		const { app, created } = vault({ notes: { 'Products/Back-Office-Administration/README.md': 'README' } });

		const outcome = await importDocument(
			app,
			DETAILS,
			VERIFIED,
			{ path: 'Products/Barcode-Scanner/README.md', content: '---\ntitle: "Readme"\n---\n' },
			SOURCE
		);

		expect(outcome).toEqual({
			ok: false,
			path: 'Products/Barcode-Scanner/README.md',
			reason: importDuplicateMessage('README', 'Products/Back-Office-Administration/README.md'),
		});
		expect(created).toEqual([]);
	});
});
