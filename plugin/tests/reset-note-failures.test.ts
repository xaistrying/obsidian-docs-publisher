import { sendDefaults } from './support/send-defaults';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTHOR_MESSAGES } from '../src/author-messages';
import { readVersionUnderReview } from '../src/doc-authoring/reset-note';
import { planAndSend } from '../src/doc-authoring/submit-plan';
import type { GitRequest, GitRunner, ProcessResult } from '../src/git-publishing/git-runner';
import { fetchedBranchRef } from '../src/git-publishing/ref-names';
import type { RepoContext } from '../src/git-publishing/repo';
import { connectReceived } from './support/connect-received';
import { createLocalRemote } from './support/local-remote';
import type { LocalRemote } from './support/local-remote';

/**
 * Reset reads the version under review in three answers and never softens them:
 * a read that failed is not "the review finished", and a path the branch does
 * not hold is never answered from the default branch. These make each read in
 * turn say something else.
 */
let remote: LocalRemote;
let vault: string;
let local: RepoContext;

beforeEach(async () => {
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
	remote = createLocalRemote();
	remote.setHook('pre-receive', 'true');
	vault = mkdtempSync(join(tmpdir(), 'vault-'));
	local = { git: remote.runner(), cwd: vault };
	await connectReceived(local, remote.address);
	const sent = await planAndSend(
		{ local, network: local, address: remote.address, identity: { name: 'Ana', email: 'ana@example.com' } },
		{
			notePath: 'Docs/Printer.md',
			basename: 'Printer',
			noteText: '---\nowner: ana\n---\nmy text\n',
			existingDocId: null,
			fields: { title: 'Printer', category: 'SOP' },
			title: 'Printer',
			attachments: [],
			...sendDefaults('Docs/Printer.md'),
		}
	);
	expect(sent.kind).toBe('sent');
});
afterEach(() => {
	remote.dispose();
	rmSync(vault, { recursive: true, force: true });
	vi.restoreAllMocks();
});

const broken = (): ProcessResult => ({ exitCode: 128, stdout: Buffer.alloc(0), stderr: 'fatal: broken on purpose', timedOut: false, truncated: false, spawnError: null });
const empty = (): ProcessResult => ({ exitCode: 0, stdout: Buffer.alloc(0), stderr: '', timedOut: false, truncated: false, spawnError: null });

/** Replaces the answer to the calls `matches` picks out, and runs everything else as normal. */
function answering(matches: (request: GitRequest) => boolean, answer: () => ProcessResult): RepoContext {
	const git: GitRunner = { run: async (request) => (matches(request) ? answer() : local.git.run(request)) };
	return { ...local, git };
}

describe('reading the version under review', () => {
	it('gives the content, and the commit it is from, when everything can be read', async () => {
		const plan = await readVersionUnderReview(local, 'Printer');

		expect(plan.kind).toBe('ready');
		expect(plan.kind === 'ready' && plan.content).toContain('my text');
	});

	it('says it could not read, and is not "finished", when the fetched copy cannot be listed', async () => {
		const ctx = answering((r) => r.args[0] === 'for-each-ref', broken);

		expect(await readVersionUnderReview(ctx, 'Printer')).toEqual({ kind: 'refused', message: AUTHOR_MESSAGES.resetReadFailed });
	});

	it('says it could not read when the branch\'s tip cannot be read', async () => {
		const ctx = answering((r) => r.args[0] === 'rev-parse' && r.args.some((a) => a.indexOf(fetchedBranchRef('Printer')) === 0), broken);

		expect(await readVersionUnderReview(ctx, 'Printer')).toEqual({ kind: 'refused', message: AUTHOR_MESSAGES.resetReadFailed });
	});

	it('says it could not read when the file\'s bytes cannot be read', async () => {
		const ctx = answering((r) => r.args[0] === 'cat-file', broken);

		expect(await readVersionUnderReview(ctx, 'Printer')).toEqual({ kind: 'refused', message: AUTHOR_MESSAGES.resetReadFailed });
	});

	it('says the review has finished, and reads nothing from the default branch, when the branch does not hold the path', async () => {
		const ctx = answering((r) => r.args[0] === 'ls-tree' && r.args.indexOf('-r') === -1 && r.args.indexOf('--') !== -1, empty);

		expect(await readVersionUnderReview(ctx, 'Printer')).toEqual({ kind: 'refused', message: AUTHOR_MESSAGES.resetFinished });
	});

	it('says the review has finished for a document that was never sent', async () => {
		expect(await readVersionUnderReview(local, 'NeverSent')).toEqual({ kind: 'refused', message: AUTHOR_MESSAGES.resetFinished });
	});
});
