import { sendDefaults } from './support/send-defaults';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTHOR_MESSAGES } from '../src/author-messages';
import { planAndSend } from '../src/doc-authoring/submit-plan';
import type { SubmitContext, SubmitResult } from '../src/doc-authoring/submit-plan';
import { blobId } from '../src/git-publishing/blob-id';
import type { GitRunner } from '../src/git-publishing/git-runner';
import { readRef, fetchProject } from '../src/git-publishing/repo';
import type { RepoContext } from '../src/git-publishing/repo';
import { readVersionUnderReview, recordSeen } from '../src/doc-authoring/reset-note';
import { deriveStates, isEdited } from '../src/submission-tracking/derive-state';
import { connectReceived } from './support/connect-received';
import { createLocalRemote } from './support/local-remote';
import type { LocalRemote } from './support/local-remote';

let remote: LocalRemote;
let vault: string;
let local: RepoContext;
let ctx: SubmitContext;

beforeEach(async () => {
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
	remote = createLocalRemote();
	remote.setHook('pre-receive', 'true');
	vault = mkdtempSync(join(tmpdir(), 'vault-'));
	local = { git: remote.runner(), cwd: vault };
	ctx = { local, network: local, address: remote.address, identity: { name: 'Ana', email: 'ana@example.com' } };
	await connectReceived(local, remote.address);
});
afterEach(() => {
	remote.dispose();
	rmSync(vault, { recursive: true, force: true });
	vi.restoreAllMocks();
});

async function sendFirst(text = '---\nowner: ana\n---\nmy text\r\n'): Promise<Extract<SubmitResult, { kind: 'sent' }>> {
	const result = await planAndSend(ctx, {
		notePath: 'Docs/Printer.md',
		basename: 'Printer',
		noteText: text,
		existingDocId: null,
		fields: { title: 'Printer', category: 'SOP' },
		title: 'Printer',
		attachments: [],
		...sendDefaults('Docs/Printer.md'),
	});
	if (result.kind !== 'sent') {
		throw new Error(`not sent: ${JSON.stringify(result)}`);
	}
	return result;
}

describe('reading the version under review', () => {
	it('is the content on the document\'s own branch, front matter and line endings and all', async () => {
		const sent = await sendFirst();

		const plan = await readVersionUnderReview(local, 'Printer');

		expect(plan).toEqual({ kind: 'ready', docId: 'Printer', content: sent.committedText, tip: sent.commit });
		expect(sent.committedText).toContain('\r\n');
	});

	it('brings in a reviewer\'s change once it has been fetched', async () => {
		await sendFirst();
		const reviewer = remote.publish('doc/Printer', { 'Docs/Printer.md': 'a reviewer rewrote this\n' }, 'reviewer');
		await fetchProject(local, remote.address);

		const plan = await readVersionUnderReview(local, 'Printer');

		expect(plan).toMatchObject({ kind: 'ready', content: 'a reviewer rewrote this\n', tip: reviewer });
	});

	it('does not see a reviewer\'s change until it has been fetched', async () => {
		const sent = await sendFirst();
		remote.publish('doc/Printer', { 'Docs/Printer.md': 'not fetched yet\n' }, 'reviewer');

		const plan = await readVersionUnderReview(local, 'Printer');

		expect(plan).toMatchObject({ kind: 'ready', content: sent.committedText });
	});

	it('is refused, with the review-finished message, once the review has been merged and fetched', async () => {
		const sent = await sendFirst();
		remote.publish('main', { 'Docs/Printer.md': sent.committedText }, 'merge');
		remote.deleteBranch('doc/Printer');
		await fetchProject(local, remote.address);

		expect(await readVersionUnderReview(local, 'Printer')).toEqual({ kind: 'refused', message: AUTHOR_MESSAGES.resetFinished });
	});

	it('is refused for a document whose review was never opened, and does not read the default branch instead', async () => {
		remote.publish('main', { 'Docs/Printer.md': 'a different round\'s text\n' });
		await fetchProject(local, remote.address);

		expect(await readVersionUnderReview(local, 'Printer')).toEqual({ kind: 'refused', message: AUTHOR_MESSAGES.resetFinished });
	});

	it('is refused, not guessed, in a vault where nothing has been fetched', async () => {
		const empty = mkdtempSync(join(tmpdir(), 'empty-'));
		try {
			const plan = await readVersionUnderReview({ git: remote.runner(), cwd: empty }, 'Printer');

			expect(plan.kind).toBe('refused');
		} finally {
			rmSync(empty, { recursive: true, force: true });
		}
	});

	it('says it could not read, and is not told the review has finished, when the copy cannot be read', async () => {
		await sendFirst();
		const broken: GitRunner = {
			run: async (request) =>
				request.args[0] === 'ls-tree'
					? { exitCode: 128, stdout: Buffer.alloc(0), stderr: 'fatal: broken', timedOut: false, truncated: false, spawnError: null }
					: local.git.run(request),
		};

		const plan = await readVersionUnderReview({ ...local, git: broken }, 'Printer');

		expect(plan).toEqual({ kind: 'refused', message: AUTHOR_MESSAGES.resetReadFailed });
	});

	it('makes no request', async () => {
		await sendFirst();
		rmSync(remote.bare, { recursive: true, force: true });

		expect((await readVersionUnderReview(local, 'Printer')).kind).toBe('ready');
	});
});

describe('after a reset', () => {
	it('the note that now matches the branch is not edited, and is edited again once changed', async () => {
		const sent = await sendFirst();
		const plan = await readVersionUnderReview(local, 'Printer');
		if (plan.kind !== 'ready') {
			throw new Error('not ready');
		}
		await recordSeen(local, plan.docId, plan.tip);
		const states = await deriveStates(local, ['Printer']);
		const document = states.ok ? states.value?.documents.get('Printer') : undefined;

		expect(isEdited(document, blobId(Buffer.from(plan.content)))).toBe(false);
		expect(isEdited(document, blobId(Buffer.from(`${plan.content}more`)))).toBe(true);
		expect(sent.commit).toBe(plan.tip);
	});

	it('records the branch tip as seen, so the next update is not refused for the commits that came in', async () => {
		await sendFirst();
		remote.publish('doc/Printer', { 'Docs/Printer.md': 'a reviewer rewrote this\n' }, 'reviewer');
		await fetchProject(local, remote.address);
		const refused = await planAndSend(ctx, {
			notePath: 'Docs/Printer.md',
			basename: 'Printer',
			noteText: 'my edit\n',
			existingDocId: 'Printer',
			fields: null,
			title: 'Printer',
			attachments: [],
			...sendDefaults('Docs/Printer.md'),
		});
		expect(refused).toEqual({ kind: 'refused', message: AUTHOR_MESSAGES.reviewHasChanges });

		const plan = await readVersionUnderReview(local, 'Printer');
		if (plan.kind !== 'ready') {
			throw new Error('not ready');
		}
		await recordSeen(local, plan.docId, plan.tip);
		const sent = await planAndSend(ctx, {
			notePath: 'Docs/Printer.md',
			basename: 'Printer',
			noteText: 'a reviewer rewrote this\nand then my addition\n',
			existingDocId: 'Printer',
			fields: null,
			title: 'Printer',
			attachments: [],
			...sendDefaults('Docs/Printer.md'),
		});

		expect(sent.kind).toBe('sent');
		const tip = await readRef(local, 'refs/remotes/origin/doc/Printer');
		expect(tip.ok && tip.value).toBeTruthy();
	});
});
