import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { foreignCommitTouching, tipBuiltHere } from '../src/git-publishing/branch-ownership';
import type { GitRunner } from '../src/git-publishing/git-runner';
import { buildCommit } from '../src/git-publishing/plumbing-commit';
import { pushDocumentBranch } from '../src/git-publishing/push';
import { fetchedDefaultRef } from '../src/git-publishing/ref-names';
import { fetchProject, readRef, writeSent } from '../src/git-publishing/repo';
import type { RepoContext } from '../src/git-publishing/repo';
import { connectReceived } from './support/connect-received';
import { createLocalRemote } from './support/local-remote';
import type { LocalRemote } from './support/local-remote';

let remote: LocalRemote;
let vault: string;
let ctx: RepoContext;
let tip: string;

const EARLIER = { name: 'Ana Nguyen', email: 'ana-old@example.com' };

beforeEach(async () => {
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
	remote = createLocalRemote();
	vault = mkdtempSync(join(tmpdir(), 'vault-'));
	ctx = { git: remote.runner(), cwd: vault };
	await connectReceived(ctx, remote.address);
	const read = await readRef(ctx, fetchedDefaultRef('main'));
	tip = read.ok && read.value !== null ? read.value : '';
});
afterEach(() => {
	remote.dispose();
	rmSync(vault, { recursive: true, force: true });
	vi.restoreAllMocks();
});

/** What this vault does when it sends: build, record as sent, push, and the fetched copy follows. */
async function sendFromHere(files: Record<string, string>, parent = tip, expected: string | null = null): Promise<string> {
	const built = await buildCommit(
		ctx,
		parent,
		Object.keys(files).map((path) => ({ path, bytes: new Uint8Array(Buffer.from(files[path])) })),
		EARLIER,
		'docs: Printer'
	);
	if (!built.ok) {
		throw new Error('could not build');
	}
	await writeSent(ctx, 'Printer', built.value.commit);
	const pushed = await pushDocumentBranch(ctx, {
		address: remote.address,
		docId: 'Printer',
		commit: built.value.commit,
		expectedTip: expected,
		title: 'Printer',
		defaultBranch: 'main',
	});
	if (!pushed.ok) {
		throw new Error(`could not push: ${pushed.failure}`);
	}
	return built.value.commit;
}

describe('whether the branch\'s tip is one this vault built', () => {
	it('is yes for the commit this vault sent', async () => {
		await sendFromHere({ 'Docs/Printer.md': 'mine' });

		expect(await tipBuiltHere(ctx, 'Printer')).toBe('yes');
	});

	it('is yes for an older commit of its own that the tip was built on, even under another email', async () => {
		// The author's own earlier send, recorded, and then a second send on top of it.
		const first = await sendFromHere({ 'Docs/Printer.md': 'v1' });
		await sendFromHere({ 'Docs/Printer.md': 'v2' }, first, first);

		expect(await tipBuiltHere(ctx, 'Printer')).toBe('yes');
	});

	it('is no when someone else added a commit on top', async () => {
		const mine = await sendFromHere({ 'Docs/Printer.md': 'mine' });
		remote.publish('doc/Printer', { 'Docs/Printer.md': 'mine, then a reviewer\'s edit' }, 'reviewer');
		await fetchProject(ctx, remote.address);

		expect(await tipBuiltHere(ctx, 'Printer')).toBe('no');
		// What was recorded is untouched; it is only no longer the tip.
		expect((await readRef(ctx, 'refs/docs-publisher/sent/Printer')).ok).toBe(true);
		expect(mine).toBeTruthy();
	});

	it('is no for a branch someone else created, with nothing recorded here', async () => {
		remote.publish('doc/Printer', { 'Docs/Printer.md': 'a colleague sent this' });
		await fetchProject(ctx, remote.address);

		expect(await tipBuiltHere(ctx, 'Printer')).toBe('no');
	});

	it('fails, and is not "no", when the branch is not in the fetched copy', async () => {
		expect(await tipBuiltHere(ctx, 'Printer')).toBe('failed');
	});

	it('fails when the fetched copy cannot be read', async () => {
		const broken: GitRunner = {
			run: async () => ({ exitCode: 128, stdout: Buffer.alloc(0), stderr: 'fatal: broken', timedOut: false, truncated: false, spawnError: null }),
		};

		expect(await tipBuiltHere({ ...ctx, git: broken }, 'Printer')).toBe('failed');
	});
});

describe('whether anyone else changed the files this send carries', () => {
	it('is yes when a commit not built here changes one of them', async () => {
		await sendFromHere({ 'Docs/Printer.md': 'mine' });
		remote.publish('doc/Printer', { 'Docs/Printer.md': 'a reviewer rewrote it' }, 'reviewer');
		await fetchProject(ctx, remote.address);

		expect(await foreignCommitTouching(ctx, 'Printer', 'main', ['Docs/Printer.md'])).toEqual({ ok: true, value: true });
	});

	it('is no when the only commit not built here changes some other file', async () => {
		await sendFromHere({ 'Docs/Printer.md': 'mine' });
		remote.publish('doc/Printer', { 'Docs/Printer.md': 'mine', 'Docs/Other.md': 'a reviewer\'s unrelated note' }, 'reviewer');
		await fetchProject(ctx, remote.address);

		expect(await foreignCommitTouching(ctx, 'Printer', 'main', ['Docs/Printer.md'])).toEqual({ ok: true, value: false });
	});

	it('is no when every commit on the branch was built here, whatever email it was built under', async () => {
		const first = await sendFromHere({ 'Docs/Printer.md': 'v1' });
		await sendFromHere({ 'Docs/Printer.md': 'v2' }, first, first);

		expect(await foreignCommitTouching(ctx, 'Printer', 'main', ['Docs/Printer.md'])).toEqual({ ok: true, value: false });
	});

	it('counts every commit as not built here when nothing is recorded', async () => {
		remote.publish('doc/Printer', { 'Docs/Printer.md': 'sent from another computer' });
		await fetchProject(ctx, remote.address);

		expect(await foreignCommitTouching(ctx, 'Printer', 'main', ['Docs/Printer.md'])).toEqual({ ok: true, value: true });
	});

	it('does not count a commit that is already on the default branch', async () => {
		// The default branch gets a commit that changes the note; the document branch
		// is cut from it and adds another file. The first commit is on both, so it is
		// the default branch's and nobody's work on this branch.
		remote.publish('main', { 'Docs/Printer.md': 'merged' }, 'merged');
		remote.publish('doc/Printer', { 'Docs/Other.md': 'added on the branch' }, 'on the branch');
		await fetchProject(ctx, remote.address);

		const answer = await foreignCommitTouching(ctx, 'Printer', 'main', ['Docs/Printer.md']);

		expect(answer).toEqual({ ok: true, value: false });
	});

	it('is no without looking when there are no paths to look at', async () => {
		expect(await foreignCommitTouching(ctx, 'Printer', 'main', [])).toEqual({ ok: true, value: false });
	});

	it('fails, and is not "no", when the fetched copy cannot be read', async () => {
		const answer = await foreignCommitTouching(ctx, 'Printer', 'main', ['Docs/Printer.md']);

		expect(answer.ok).toBe(false);
	});
});
