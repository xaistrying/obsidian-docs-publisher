import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitRequest, GitRunner } from '../src/git-publishing/git-runner';
import { buildCommit } from '../src/git-publishing/plumbing-commit';
import { parsePushReply, pushDocumentBranch, pushTitle } from '../src/git-publishing/push';
import type { PushRequest } from '../src/git-publishing/push';
import { fetchedBranchRef, fetchedDefaultRef } from '../src/git-publishing/ref-names';
import { branchExists, fetchProject, readRef } from '../src/git-publishing/repo';
import type { RepoContext } from '../src/git-publishing/repo';
import { connectReceived } from './support/connect-received';
import { createLocalRemote } from './support/local-remote';
import type { LocalRemote } from './support/local-remote';

let remote: LocalRemote;
let vault: string;
let ctx: RepoContext;
let tip: string;
let optionsFile: string;
let pushesFile: string;

const ME = { name: 'Ana Nguyen', email: 'ana@example.com' };

/** The review-request lines GitLab prints when it opened one. */
const CREATED_REPLY = [
	'echo "" >&2',
	'echo "View merge request for doc/Printer:" >&2',
	'echo "  https://gitlab.example.com/docs/kb/-/merge_requests/12" >&2',
].join('\n');

/** And when it only offers a link. */
const LINK_REPLY = [
	'echo "" >&2',
	'echo "To create a merge request for doc/Printer, visit:" >&2',
	'echo "  https://gitlab.example.com/docs/kb/-/merge_requests/new?merge_request%5Bsource_branch%5D=doc%2FPrinter" >&2',
].join('\n');

async function setUp(options: { advertisePushOptions?: boolean } = {}): Promise<void> {
	remote = createLocalRemote(options);
	vault = mkdtempSync(join(tmpdir(), 'vault-'));
	ctx = { git: remote.runner(), cwd: vault };
	optionsFile = join(remote.root, 'push-options');
	pushesFile = join(remote.root, 'pushes');
	await connectReceived(ctx, remote.address);
	const read = await readRef(ctx, fetchedDefaultRef('main'));
	tip = read.ok && read.value !== null ? read.value : '';
	// Records every push option and how many pushes arrived, then prints the reply.
	remote.setHook(
		'pre-receive',
		[
			`echo pushed >> '${pushesFile}'`,
			'i=0',
			'while [ "$i" -lt "${GIT_PUSH_OPTION_COUNT:-0}" ]; do',
			'  eval "printf \'%s\\n\' \\"\\$GIT_PUSH_OPTION_$i\\""',
			'  i=$((i+1))',
			`done >> '${optionsFile}'`,
			CREATED_REPLY,
		].join('\n')
	);
}

beforeEach(() => {
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
	remote.dispose();
	rmSync(vault, { recursive: true, force: true });
	vi.restoreAllMocks();
});

async function commitOnDefault(text = 'the note'): Promise<string> {
	const built = await buildCommit(ctx, tip, [{ path: 'Docs/Printer.md', bytes: new Uint8Array(Buffer.from(text)) }], ME, 'docs: Printer');
	if (!built.ok) {
		throw new Error('could not build');
	}
	return built.value.commit;
}

function request(commit: string, over: Partial<PushRequest> = {}): PushRequest {
	return { address: remote.address, docId: 'Printer', commit, expectedTip: null, title: 'Printer setup', defaultBranch: 'main', ...over };
}

const pushes = (): number => (existsSync(pushesFile) ? readFileSync(pushesFile, 'utf8').split('\n').filter((l) => l !== '').length : 0);
const optionsSeen = (): string[] => (existsSync(optionsFile) ? readFileSync(optionsFile, 'utf8').split('\n').filter((l) => l !== '') : []);

describe('sending a document to its branch', () => {
	beforeEach(async () => {
		await setUp();
	});

	it('creates the branch with the commit, and asks for a review request into the default branch', async () => {
		const commit = await commitOnDefault();

		const result = await pushDocumentBranch(ctx, request(commit));

		expect(result).toEqual({ ok: true, value: { reviewRequest: 'created', link: null } });
		expect(remote.tip('doc/Printer')).toBe(commit);
		expect(optionsSeen()).toEqual([
			'merge_request.create',
			'merge_request.target=main',
			'merge_request.title=Printer setup',
			'merge_request.remove_source_branch',
		]);
	});

	it('says only a link was offered when the server did not open the review request', async () => {
		remote.setHook('pre-receive', LINK_REPLY);
		const commit = await commitOnDefault();

		const result = await pushDocumentBranch(ctx, request(commit));

		expect(result).toEqual({
			ok: true,
			value: {
				reviewRequest: 'link-only',
				link: 'https://gitlab.example.com/docs/kb/-/merge_requests/new?merge_request%5Bsource_branch%5D=doc%2FPrinter',
			},
		});
		expect(remote.tip('doc/Printer')).toBe(commit);
	});

	it('treats a server that says nothing about a review request as partial success', async () => {
		remote.setHook('pre-receive', 'true');
		const commit = await commitOnDefault();

		const result = await pushDocumentBranch(ctx, request(commit));

		expect(result).toEqual({ ok: true, value: { reviewRequest: 'link-only', link: null } });
	});

	it('advances a branch on top of a reviewer\'s commit, keeping theirs', async () => {
		const first = await commitOnDefault('mine');
		await pushDocumentBranch(ctx, request(first));
		const reviewer = remote.publish('doc/Printer', { 'Docs/Printer.md': 'mine', 'Docs/Notes.md': 'a reviewer\'s note' }, 'reviewer');
		await fetchProject(ctx, remote.address);
		const built = await buildCommit(ctx, reviewer, [{ path: 'Docs/Printer.md', bytes: new Uint8Array(Buffer.from('mine, revised')) }], ME, 'docs: Printer');
		if (!built.ok) {
			throw new Error('could not build');
		}

		const result = await pushDocumentBranch(ctx, request(built.value.commit, { expectedTip: reviewer }));

		expect(result.ok).toBe(true);
		expect(remote.tip('doc/Printer')).toBe(built.value.commit);
		expect(remote.git(remote.bare, 'log', '--format=%s', 'refs/heads/doc/Printer')).toContain('reviewer');
	});

	it('replaces an abandoned branch in one step when the lease is exactly what was seen', async () => {
		const old = remote.publish('doc/Printer', { 'Docs/Printer.md': 'the abandoned attempt' });
		await fetchProject(ctx, remote.address);
		const fresh = await commitOnDefault('a new cycle from the default branch');

		const result = await pushDocumentBranch(ctx, request(fresh, { expectedTip: old }));

		expect(result.ok).toBe(true);
		expect(remote.tip('doc/Printer')).toBe(fresh);
	});

	it('does not overwrite a branch that moved since it was fetched', async () => {
		const seen = remote.publish('doc/Printer', { 'Docs/Printer.md': 'v1' });
		await fetchProject(ctx, remote.address);
		const moved = remote.publish('doc/Printer', { 'Docs/Printer.md': 'v2 by a reviewer' });
		const commit = await commitOnDefault();

		const result = await pushDocumentBranch(ctx, request(commit, { expectedTip: seen }));

		expect(result).toEqual({ ok: false, failure: 'changed-meanwhile' });
		expect(remote.tip('doc/Printer')).toBe(moved);
	});

	it('refuses to replace an existing branch when it was told there was none', async () => {
		const existing = remote.publish('doc/Printer', { 'Docs/Printer.md': 'someone else sent this' });
		const commit = await commitOnDefault();

		const result = await pushDocumentBranch(ctx, request(commit, { expectedTip: null }));

		expect(result).toEqual({ ok: false, failure: 'changed-meanwhile' });
		expect(remote.tip('doc/Printer')).toBe(existing);
	});

	it('is told when the server\'s rules forbid the push, and nothing on the remote changed', async () => {
		remote.setHook('pre-receive', 'echo "GitLab: You are not allowed to push code to protected branches on this project." >&2\nexit 1');
		const commit = await commitOnDefault();

		const result = await pushDocumentBranch(ctx, request(commit));

		expect(result).toEqual({ ok: false, failure: 'not-allowed' });
		expect(remote.tip('doc/Printer')).toBeNull();
	});

	it('sends to the verified address even when the repository\'s origin pushes elsewhere', async () => {
		remote.git(vault, 'config', '--local', 'remote.origin.pushurl', 'ssh://git@elsewhere.example.com/other/project.git');
		const commit = await commitOnDefault();

		const result = await pushDocumentBranch(ctx, request(commit));

		expect(result.ok).toBe(true);
		expect(remote.tip('doc/Printer')).toBe(commit);
	});

	it('is stopped, and sends nothing, when a setting would send the address elsewhere', async () => {
		remote.git(vault, 'config', '--local', 'url.ssh://elsewhere.example.com/.pushInsteadOf', remote.address.sshUrl);
		const commit = await commitOnDefault();

		const result = await pushDocumentBranch(ctx, request(commit));

		expect(result).toEqual({ ok: false, failure: 'address-rewritten' });
		expect(remote.tip('doc/Printer')).toBeNull();
		expect(pushes()).toBe(0);
	});

	it('sends the title on one line, and no more than 200 characters of it', async () => {
		const commit = await commitOnDefault();

		await pushDocumentBranch(ctx, request(commit, { title: `Printer\nsetup\r\n${'x'.repeat(300)}` }));

		const title = optionsSeen().find((line) => line.indexOf('merge_request.title=') === 0) ?? '';
		expect(title).not.toMatch(/[\r\n]/);
		expect(Array.from(title.slice('merge_request.title='.length)).length).toBe(200);
		expect(title.startsWith('merge_request.title=Printer setup xxx')).toBe(true);
	});
});

describe('the fetched copy after a push', () => {
	beforeEach(async () => {
		await setUp();
	});

	it('holds the pushed commit as the branch\'s tip at once, so the document reads as waiting without a fetch', async () => {
		const commit = await commitOnDefault();
		expect(await branchExists(ctx, 'Printer', 'main')).toBe('absent');

		await pushDocumentBranch(ctx, request(commit));

		expect(await branchExists(ctx, 'Printer', 'main')).toBe('exists');
		expect(await readRef(ctx, fetchedBranchRef('Printer'))).toEqual({ ok: true, value: commit });
	});

	it('is unchanged after a push that failed', async () => {
		remote.setHook('pre-receive', 'echo "You are not allowed to push" >&2\nexit 1');
		const commit = await commitOnDefault();

		await pushDocumentBranch(ctx, request(commit));

		expect(await branchExists(ctx, 'Printer', 'main')).toBe('absent');
	});
});

describe('a server that does not take push options', () => {
	beforeEach(async () => {
		await setUp({ advertisePushOptions: false });
	});

	it('is sent the commit once, without them, and told it went through without a review request', async () => {
		const commit = await commitOnDefault();

		const result = await pushDocumentBranch(ctx, request(commit));

		expect(result.ok && result.value.reviewRequest).toBe('link-only');
		expect(remote.tip('doc/Printer')).toBe(commit);
		expect(pushes()).toBe(1);
		expect(optionsSeen()).toEqual([]);
	});
});

describe('what is refused before any process is started', () => {
	beforeEach(async () => {
		await setUp();
	});

	function counting(): { ctx: RepoContext; calls: string[] } {
		const calls: string[] = [];
		const git: GitRunner = {
			run: (r: GitRequest) => {
				calls.push(r.args[0]);
				return ctx.git.run(r);
			},
		};
		return { ctx: { ...ctx, git }, calls };
	}

	const commit = 'a'.repeat(40);

	for (const docId of ['a b', 'a..b', 'a~1', 'a^', 'a:b', 'a?', 'a*', 'a[0]', 'a\\b', '.hidden', 'x.lock', '-x', '']) {
		it(`refuses an identity that cannot be in a branch name (${JSON.stringify(docId)})`, async () => {
			const c = counting();

			await expect(pushDocumentBranch(c.ctx, request(commit, { docId }))).rejects.toThrow(/not usable/);
			expect(c.calls).toEqual([]);
		});
	}

	it('refuses to push to the default branch', async () => {
		const c = counting();

		await expect(pushDocumentBranch(c.ctx, request(commit, { docId: 'x', defaultBranch: 'doc/x' }))).rejects.toThrow(/default branch/);
		expect(c.calls).toEqual([]);
	});

	it('refuses a default branch name that is not an ordinary one', async () => {
		const c = counting();

		await expect(pushDocumentBranch(c.ctx, request(commit, { defaultBranch: '--force' }))).rejects.toThrow(/not a usable name/);
		expect(c.calls).toEqual([]);
	});

	for (const bad of ['main', 'abc', 'A'.repeat(40), `${'a'.repeat(39)}`, `${'a'.repeat(41)}`]) {
		it(`refuses a commit that is not a full identifier (${bad.slice(0, 12)})`, async () => {
			const c = counting();

			await expect(pushDocumentBranch(c.ctx, request(bad))).rejects.toThrow(/full commit identifiers/);
			expect(c.calls).toEqual([]);
		});
	}

	it('refuses a lease that is not a full identifier', async () => {
		const c = counting();

		await expect(pushDocumentBranch(c.ctx, request(commit, { expectedTip: 'main' }))).rejects.toThrow(/full commit identifiers/);
		expect(c.calls).toEqual([]);
	});
});

describe('the title', () => {
	it('is one line, trimmed, and falls back to the identity when nothing is left', () => {
		expect(pushTitle('  Printer\n setup \t ', 'Printer')).toBe('Printer setup');
		expect(pushTitle('\n\r\t ', 'Printer')).toBe('Printer');
		expect(pushTitle('', 'Printer')).toBe('Printer');
	});

	it('counts characters and not code units, so an emoji is not cut in half', () => {
		const title = pushTitle('😀'.repeat(250), 'x');

		expect(Array.from(title)).toHaveLength(200);
		expect(title).not.toMatch(/\ud83d$/);
	});
});

describe('reading the server\'s reply', () => {
	it('knows a review request was created from the line GitLab prints', () => {
		expect(parsePushReply('remote: \nremote: View merge request for doc/x:\nremote:   https://h/-/merge_requests/3\nremote: \n')).toEqual({
			reviewRequest: 'created',
			link: null,
		});
	});

	it('takes the link GitLab offers when it did not create one', () => {
		expect(
			parsePushReply('remote: To create a merge request for doc/x, visit:\nremote:   https://h/-/merge_requests/new?x=1\n')
		).toEqual({ reviewRequest: 'link-only', link: 'https://h/-/merge_requests/new?x=1' });
	});

	it('calls anything else partial success with no link', () => {
		expect(parsePushReply('To h:docs/kb.git\n * [new branch]      abc -> doc/x\n')).toEqual({ reviewRequest: 'link-only', link: null });
		expect(parsePushReply('')).toEqual({ reviewRequest: 'link-only', link: null });
	});
});
