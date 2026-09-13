import { describe, expect, it } from 'vitest';
// The stub's own test helpers come from the stub BY PATH, not through the
// `obsidian` specifier: `tsc` resolves that specifier to the real package,
// where they do not exist. Vitest aliases `obsidian` to this very file, so the
// source modules under test and the import below are the same module instance
// and share its installed handler.
import { setRequestUrlHandler, stubResponse } from './obsidian-stub';
import type { RequestUrlParam } from './obsidian-stub';
import type { SubmissionFileReads } from '../src/doc-authoring/submission-files';
import { buildSubmissionFiles } from '../src/doc-authoring/submission-files';
import { createBranchWithCommit } from '../src/git-publishing/gitlab-client';
import type { CommitFileAction } from '../src/git-publishing/gitlab-client';

/**
 * THESE TESTS PIN SHAPE, NOT ACCEPTANCE (tasks.md 6.7).
 *
 * Every assertion below is about what this plugin BUILDS — which paths, which
 * verbs, where `encoding` and `last_commit_id` land. Not one of them says
 * GitLab accepts it, and none can: a test over a stub asserts this project's
 * belief about the API, and `docs/ce-verification.md` exists precisely because
 * that belief has been wrong before, expensively. The shape is pinned here so
 * it cannot change by accident; that the shape is RIGHT is settled by the
 * three checks in that document against the real instance. Different jobs,
 * neither substituting for the other (design.md decision 5).
 */

/** Paths present on the ref, mapped to the commit each currently carries. */
function reads(params: { present?: Record<string, string>; bytes?: Record<string, string> }): SubmissionFileReads {
	const present = params.present ?? {};
	const bytes = params.bytes ?? {};
	return {
		readAttachment: async (path) => bytes[path] ?? null,
		commitIdAt: async (path) => {
			const commitId = present[path];
			return {
				ok: true,
				value: commitId === undefined ? { exists: false } : { exists: true, commitId },
			};
		},
	};
}

async function build(
	params: { notePath: string; noteContent: string; attachmentPaths: string[] },
	source: SubmissionFileReads
): Promise<CommitFileAction[]> {
	const result = await buildSubmissionFiles(params, source);
	if (!result.ok) {
		throw new Error(`expected a built file set, got failure ${result.failure}`);
	}

	return result.value;
}

describe('the file set a submission carries', () => {
	it('leads with the note and follows with its attachments in order', async () => {
		const files = await build(
			{
				notePath: 'Guides/Setup.md',
				noteContent: '# Setup',
				attachmentPaths: ['Guides/assets/one.png', 'Guides/assets/two.png'],
			},
			reads({ bytes: { 'Guides/assets/one.png': 'AAAA', 'Guides/assets/two.png': 'BBBB' } })
		);

		expect(files.map((file) => file.filePath)).toEqual([
			'Guides/Setup.md',
			'Guides/assets/one.png',
			'Guides/assets/two.png',
		]);
	});

	it('declares base64 on the attachments and never on the note', async () => {
		const files = await build(
			{ notePath: 'Setup.md', noteContent: '# Setup', attachmentPaths: ['panel.png'] },
			reads({ bytes: { 'panel.png': 'AAAA' } })
		);

		expect(files[0]).toMatchObject({ filePath: 'Setup.md', content: '# Setup' });
		expect(files[0]).not.toHaveProperty('encoding');
		expect(files[1]).toMatchObject({ filePath: 'panel.png', content: 'AAAA', encoding: 'base64' });
	});

	it('creates a file the ref does not hold, with no commit id to be stale against', async () => {
		const files = await build(
			{ notePath: 'Setup.md', noteContent: '# Setup', attachmentPaths: ['new.png'] },
			reads({ bytes: { 'new.png': 'AAAA' } })
		);

		expect(files.every((file) => file.action === 'create')).toBe(true);
		expect(files.every((file) => file.lastCommitId === undefined)).toBe(true);
	});

	it('updates a file the ref already holds, carrying that file\'s own commit id', async () => {
		const files = await build(
			{ notePath: 'Setup.md', noteContent: '# Setup', attachmentPaths: ['logo.png'] },
			reads({
				present: { 'Setup.md': 'note-commit', 'logo.png': 'logo-commit' },
				bytes: { 'logo.png': 'AAAA' },
			})
		);

		expect(files[0]).toMatchObject({ action: 'update', lastCommitId: 'note-commit' });
		expect(files[1]).toMatchObject({ action: 'update', lastCommitId: 'logo-commit' });
	});

	it('mixes verbs in one commit for a new image beside a shared one', async () => {
		// The ordinary illustrated document: its note is under review, a logo
		// twenty documents already embed is on the remote, and a screenshot
		// nobody has published is not.
		const files = await build(
			{
				notePath: 'Setup.md',
				noteContent: '# Setup',
				attachmentPaths: ['shared/logo.png', 'Guides/screenshot.png'],
			},
			reads({
				present: { 'Setup.md': 'note-commit', 'shared/logo.png': 'logo-commit' },
				bytes: { 'shared/logo.png': 'AAAA', 'Guides/screenshot.png': 'BBBB' },
			})
		);

		expect(files).toEqual([
			{ filePath: 'Setup.md', content: '# Setup', action: 'update', lastCommitId: 'note-commit' },
			{
				filePath: 'shared/logo.png',
				content: 'AAAA',
				action: 'update',
				lastCommitId: 'logo-commit',
				encoding: 'base64',
			},
			{
				filePath: 'Guides/screenshot.png',
				content: 'BBBB',
				action: 'create',
				encoding: 'base64',
			},
		]);
	});

	it('produces exactly the one action for a note that embeds nothing', async () => {
		// The no-attachment case must be unchanged from what shipped before
		// attachments existed: one action, no encoding, nothing else.
		const files = await build(
			{ notePath: 'Setup.md', noteContent: '# Setup', attachmentPaths: [] },
			reads({})
		);

		expect(files).toEqual([{ filePath: 'Setup.md', content: '# Setup', action: 'create' }]);
	});

	it('submits without an attachment whose bytes cannot be read', async () => {
		const files = await build(
			{ notePath: 'Setup.md', noteContent: '# Setup', attachmentPaths: ['gone.png', 'here.png'] },
			reads({ bytes: { 'here.png': 'AAAA' } })
		);

		expect(files.map((file) => file.filePath)).toEqual(['Setup.md', 'here.png']);
	});

	it('never emits a delete, even for a file present on the ref', async () => {
		const files = await build(
			{ notePath: 'Setup.md', noteContent: '# Setup', attachmentPaths: ['logo.png'] },
			reads({ present: { 'Setup.md': 'a', 'logo.png': 'b' }, bytes: { 'logo.png': 'AAAA' } })
		);

		expect(files.map((file) => file.action).sort()).toEqual(['update', 'update']);
	});

	it('abandons the whole build when a file\'s verb cannot be established', async () => {
		// A failed read is never softened to absence: that would send a `create`
		// at a path that already holds a file, or an update with no guard at all.
		const result = await buildSubmissionFiles(
			{ notePath: 'Setup.md', noteContent: '# Setup', attachmentPaths: ['logo.png'] },
			{
				readAttachment: async () => 'AAAA',
				commitIdAt: async (path) =>
					path === 'logo.png'
						? { ok: false, failure: 'insufficient-permission' }
						: { ok: true, value: { exists: false } },
			}
		);

		expect(result).toEqual({ ok: false, failure: 'insufficient-permission' });
	});
});

describe('the commit payload those files become', () => {
	/** Captures the body `createBranchWithCommit` actually sends. */
	async function capturePayload(files: CommitFileAction[]): Promise<Record<string, unknown>> {
		const sent: RequestUrlParam[] = [];
		const restore = setRequestUrlHandler((request) => {
			sent.push(request);
			if (request.url.endsWith('/projects/42')) {
				return stubResponse({ status: 200, body: JSON.stringify({ default_branch: 'main' }) });
			}

			return stubResponse({ status: 201, body: JSON.stringify({ id: 'commit-sha' }) });
		});

		try {
			const result = await createBranchWithCommit(
				{ host: 'https://gitlab.example.com', projectId: '42', token: 'x' },
				{ branch: 'docs/setup', files }
			);
			expect(result).toEqual({ ok: true, value: { id: 'commit-sha' } });
		} finally {
			restore();
		}

		const commit = sent.find((request) => request.method === 'POST');
		return JSON.parse(commit?.body ?? '{}') as Record<string, unknown>;
	}

	it('sends one action per file, with the keys GitLab is told to read', async () => {
		const payload = await capturePayload([
			{ filePath: 'Setup.md', content: '# Setup', action: 'update', lastCommitId: 'note-commit' },
			{ filePath: 'logo.png', content: 'AAAA', action: 'create', encoding: 'base64' },
		]);

		expect(payload['branch']).toBe('docs/setup');
		expect(payload['start_branch']).toBe('main');
		expect(payload['actions']).toEqual([
			{
				action: 'update',
				file_path: 'Setup.md',
				content: '# Setup',
				last_commit_id: 'note-commit',
			},
			{
				action: 'create',
				file_path: 'logo.png',
				content: 'AAAA',
				encoding: 'base64',
			},
		]);
	});

	it('omits last_commit_id and encoding rather than sending them empty', async () => {
		const payload = await capturePayload([{ filePath: 'Setup.md', content: '# Setup', action: 'create' }]);

		const actions = payload['actions'] as Record<string, unknown>[];
		expect(Object.keys(actions[0] ?? {})).toEqual(['action', 'file_path', 'content']);
	});

	it('names the document rather than the pictures riding along with it', async () => {
		const payload = await capturePayload([
			{ filePath: 'Guides/Setup.md', content: '# Setup', action: 'create' },
			{ filePath: 'logo.png', content: 'AAAA', action: 'create', encoding: 'base64' },
		]);

		expect(payload['commit_message']).toBe('Add Guides/Setup.md');
	});
});
