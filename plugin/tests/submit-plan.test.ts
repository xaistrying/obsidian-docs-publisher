import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTHOR_MESSAGES } from '../src/author-messages';
import { blobId } from '../src/git-publishing/blob-id';
import type { GitRequest, GitRunner } from '../src/git-publishing/git-runner';
import { fetchedBranchRef, sentRef } from '../src/git-publishing/ref-names';
import { fetchProject, readRef, writeSent } from '../src/git-publishing/repo';
import type { RepoContext } from '../src/git-publishing/repo';
import { planAndSend, replacesPublishedVersion } from '../src/doc-authoring/submit-plan';
import type { SubmitContext, SubmitInput, SubmitResult } from '../src/doc-authoring/submit-plan';
import { connectReceived } from './support/connect-received';
import { createLocalRemote } from './support/local-remote';
import type { LocalRemote } from './support/local-remote';

let remote: LocalRemote;
let vault: string;
let local: RepoContext;
let ctx: SubmitContext;
let pushesFile: string;

const ME = { name: 'Ana Nguyen', email: 'ana@example.com' };
const CREATED = 'echo "View merge request for doc/Printer:" >&2\necho "  https://gitlab.example.com/docs/kb/-/merge_requests/1" >&2';

async function setUp(published: Record<string, string | Buffer> = {}): Promise<void> {
	remote = createLocalRemote();
	if (Object.keys(published).length > 0) {
		remote.publish('main', published, 'earlier');
	}
	vault = mkdtempSync(join(tmpdir(), 'vault-'));
	local = { git: remote.runner(), cwd: vault };
	ctx = { local, network: local, address: remote.address, identity: ME };
	pushesFile = join(remote.root, 'pushes');
	remote.setHook('pre-receive', `echo pushed >> '${pushesFile}'\n${CREATED}`);
	await connectReceived(local, remote.address);
}

beforeEach(() => {
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
	remote.dispose();
	rmSync(vault, { recursive: true, force: true });
	vi.restoreAllMocks();
});

const bytes = (text: string): Uint8Array => new Uint8Array(Buffer.from(text));
const vg = (...args: string[]): string => remote.git(vault, ...args);
const pushes = (): number => (existsSync(pushesFile) ? readFileSync(pushesFile, 'utf8').split('\n').filter((l) => l !== '').length : 0);

function firstSend(over: Partial<SubmitInput> = {}): SubmitInput {
	const notePath = over.notePath ?? 'Docs/Printer.md';
	return {
		notePath,
		basename: 'Printer',
		noteText: '---\nowner: ana\n---\nThe note\n',
		existingDocId: null,
		fields: { title: 'Printer setup', category: 'SOP' },
		title: 'Printer setup',
		attachments: [],
		// The vault holds the note where it is, and a move, were one asked about, is confirmed.
		vaultPaths: new Set([notePath]),
		knownNotes: [],
		confirmMove: async () => true,
		...over,
	};
}

function resend(text: string, over: Partial<SubmitInput> = {}): SubmitInput {
	return { ...firstSend({ noteText: text, existingDocId: 'Printer', fields: null }), ...over };
}

async function send(input: SubmitInput, context: SubmitContext = ctx): Promise<SubmitResult> {
	return planAndSend(context, input);
}

function sentOf(result: SubmitResult) {
	if (result.kind !== 'sent') {
		throw new Error(`expected a send, got ${JSON.stringify(result)}`);
	}
	return result;
}

function checksums(dir: string, prefix = ''): Record<string, string> {
	const sums: Record<string, string> = {};
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (prefix === '' && entry.name === '.git') {
			continue;
		}
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			Object.assign(sums, checksums(full, `${prefix}${entry.name}/`));
		} else {
			sums[`${prefix}${entry.name}`] = createHash('sha256').update(readFileSync(full)).digest('hex');
		}
	}
	return sums;
}

/** Everything a refusal must leave alone: the project's branches, the sent record and the vault's files. */
function untouched(): { remote: string; sent: string; files: Record<string, string> } {
	return {
		remote: remote.git(remote.bare, 'for-each-ref', '--format=%(refname) %(objectname)'),
		sent: vg('for-each-ref', 'refs/docs-publisher/sent'),
		files: checksums(vault),
	};
}

describe('a first submission', () => {
	beforeEach(async () => {
		await setUp();
	});

	it('puts the note on the document branch with its identity merged in, and tells what it committed', async () => {
		const result = sentOf(await send(firstSend()));

		expect(result).toMatchObject({ docId: 'Printer', remotePath: 'Docs/Printer.md', update: false, reviewRequest: 'created' });
		expect(remote.tip('doc/Printer')).toBe(result.commit);
		const onBranch = remote.git(remote.bare, 'show', 'doc/Printer:Docs/Printer.md');
		expect(onBranch).toBe(result.committedText);
		expect(onBranch).toContain('title: "Printer setup"');
		expect(onBranch).toContain('category: SOP');
		// The note carries no identity property: git knows it by its path.
		expect(onBranch).not.toContain('doc_id');
		expect(onBranch).toContain('owner: ana');
	});

	it('leaves the default branch alone, and every file in the vault, its index and HEAD exactly as they were', async () => {
		writeFileSync(join(vault, 'mine.md'), 'my own note');
		const before = { files: checksums(vault), index: vg('ls-files', '-s'), head: vg('rev-parse', 'HEAD'), main: remote.tip('main') };

		await send(firstSend());

		expect(checksums(vault)).toEqual(before.files);
		expect(vg('ls-files', '-s')).toBe(before.index);
		expect(vg('rev-parse', 'HEAD')).toBe(before.head);
		expect(remote.tip('main')).toBe(before.main);
	});

	it('commits blob for blob what it says it committed, so the written-back note will equal the pushed file', async () => {
		const result = sentOf(await send(firstSend()));

		const pushedBlob = remote.git(remote.bare, 'rev-parse', 'doc/Printer:Docs/Printer.md').trim();
		expect(pushedBlob).toBe(blobId(Buffer.from(result.committedText)));
	});

	it('records the commit as sent before it is pushed, and as the author\'s name', async () => {
		const result = sentOf(await send(firstSend()));

		expect(await readRef(local, sentRef('Printer'))).toEqual({ ok: true, value: result.commit });
		expect(remote.git(remote.bare, 'log', '-1', '--format=%an <%ae>', 'doc/Printer').trim()).toBe('Ana Nguyen <ana@example.com>');
	});

	it('carries the images the note embeds, byte for byte, with the note first', async () => {
		const image = new Uint8Array([0, 255, 10, 13, 7]);

		const result = sentOf(await send(firstSend({ attachments: [{ path: 'img/a.png', bytes: image }] })));

		expect(remote.git(remote.bare, 'ls-tree', '-r', '--name-only', `doc/Printer`)).toContain('img/a.png');
		expect(remote.git(remote.bare, 'rev-parse', 'doc/Printer:img/a.png').trim()).toBe(blobId(Buffer.from(image)));
		expect(result.commit).toBe(remote.tip('doc/Printer'));
	});

	it('makes no change to a shared image that is identical on the project', async () => {
		await connectVaultAgain({ 'img/shared.png': Buffer.from([1, 2, 3]) });

		await send(firstSend({ attachments: [{ path: 'img/shared.png', bytes: new Uint8Array([1, 2, 3]) }] }));

		const changed = remote.git(remote.bare, 'diff', '--name-only', 'main', 'doc/Printer');
		expect(changed.split('\n').filter((l) => l !== '')).toEqual(['Docs/Printer.md']);
	});

	it('adds an image nobody has published', async () => {
		await send(firstSend({ attachments: [{ path: 'img/new.png', bytes: new Uint8Array([9]) }] }));

		const changed = remote.git(remote.bare, 'diff', '--name-only', 'main', 'doc/Printer');
		expect(changed.split('\n').filter((l) => l !== '').sort()).toEqual(['Docs/Printer.md', 'img/new.png']);
	});

	it('does not send the note twice when it is also listed among its own attachments', async () => {
		const result = sentOf(await send(firstSend({ attachments: [{ path: 'Docs/Printer.md', bytes: bytes('other') }] })));

		expect(remote.git(remote.bare, 'show', 'doc/Printer:Docs/Printer.md')).toBe(result.committedText);
	});

	/** Publishes to the project after connecting and brings the vault up to date, as getting updates would. */
	async function connectVaultAgain(files: Record<string, string | Buffer>): Promise<void> {
		remote.publish('main', files, 'shared');
		await fetchProject(local, remote.address);
		const tip = await readRef(local, 'refs/remotes/origin/main');
		if (tip.ok && tip.value !== null) {
			const { advanceSynced } = await import('../src/git-publishing/repo');
			await advanceSynced(local, tip.value);
		}
	}
});

describe('a first submission that is refused', () => {
	beforeEach(async () => {
		await setUp();
	});

	it('refuses a file name that cannot be an identity, and changes nothing', async () => {
		const before = untouched();

		const result = await send(firstSend({ basename: 'my note' }));

		expect(result).toEqual({ kind: 'refused', message: AUTHOR_MESSAGES.invalidFilename });
		expect(untouched()).toEqual(before);
	});

	it('refuses an identity read from a note that cannot be a branch name', async () => {
		const before = untouched();

		const result = await send(resend('x', { existingDocId: 'a..b' }));

		expect(result).toEqual({ kind: 'refused', message: AUTHOR_MESSAGES.invalidIdentity });
		expect(untouched()).toEqual(before);
		expect(pushes()).toBe(0);
	});

	it('refuses when someone else\'s branch already has this identity, and replaces nothing', async () => {
		const theirs = remote.publish('doc/Printer', { 'Docs/Printer.md': 'a colleague sent this' });
		const before = untouched();

		const result = await send(firstSend());

		expect(result).toEqual({ kind: 'refused', message: AUTHOR_MESSAGES.alreadyWaiting });
		expect(remote.tip('doc/Printer')).toBe(theirs);
		expect(untouched()).toEqual(before);
	});

	it('counts a branch the same person pushed from another computer as someone else\'s', async () => {
		remote.publish('doc/Printer', { 'Docs/Printer.md': 'sent from my other laptop' });
		const before = untouched();

		expect((await send(firstSend())).kind).toBe('refused');
		expect(untouched()).toEqual(before);
	});

	it('refuses a path where the project has a document the vault has not received', async () => {
		remote.publish('main', { 'Docs/Printer.md': 'published by someone since the last update' });
		const before = untouched();

		const result = await send(firstSend());

		expect(result).toEqual({ kind: 'refused', message: AUTHOR_MESSAGES.pathNotReceived });
		expect(untouched()).toEqual(before);
	});

	it('refuses a file name another document in the project already has, whatever folder it is in', async () => {
		remote.publish('main', { 'Archive/Printer.md': 'someone else, same name' });
		const before = untouched();

		const result = await send(firstSend());

		expect(result).toEqual({ kind: 'refused', message: AUTHOR_MESSAGES.identityNotUnique });
		expect(untouched()).toEqual(before);
	});

	it('refuses a different note with the file name of one whose review is open, and leaves that review alone', async () => {
		sentOf(await send(firstSend({ notePath: 'L1/Setup.md', basename: 'Setup', noteText: 'the first Setup\n' })));
		const tip = remote.tip('doc/Setup');
		const before = untouched();

		const result = await send(firstSend({ notePath: 'L2/Setup.md', basename: 'Setup', noteText: 'a different Setup\n' }));

		expect(result).toEqual({ kind: 'refused', message: AUTHOR_MESSAGES.identityNotUnique });
		expect(remote.tip('doc/Setup')).toBe(tip);
		expect(untouched()).toEqual(before);
	});

	it('refuses, and writes nothing, when the project cannot be fetched', async () => {
		rmSync(remote.bare, { recursive: true, force: true });
		const files = checksums(vault);

		const result = await send(firstSend());

		expect(result.kind).toBe('failed');
		expect(checksums(vault)).toEqual(files);
		expect(vg('for-each-ref', 'refs/docs-publisher/sent')).toBe('');
	});

	it('is told the key is no longer accepted when the fetch is refused for it', async () => {
		const refusing: GitRunner = {
			run: async (request: GitRequest) =>
				request.args[0] === 'fetch'
					? { exitCode: 128, stdout: Buffer.alloc(0), stderr: 'git@h: Permission denied (publickey).', timedOut: false, truncated: false, spawnError: null }
					: local.git.run(request),
		};

		const result = await send(firstSend(), { ...ctx, network: { ...local, git: refusing } });

		expect(result).toEqual({ kind: 'failed', failure: 'key-rejected' });
	});
});

describe('a note at a path the vault has received', () => {
	beforeEach(async () => {
		await setUp({ 'Docs/Printer.md': 'the published text\n' });
	});

	it('is a revision of that document: not refused for the path, and a new round from the default branch', async () => {
		const result = sentOf(await send(firstSend({ noteText: 'the published text, edited\n', fields: { title: 'Printer', category: 'SOP' } })));

		expect(result.update).toBe(false);
		expect(remote.git(remote.bare, 'rev-parse', `${result.commit}^`).trim()).toBe(remote.tip('main'));
	});

	it('says in advance that it replaces the published version, for a note at a path the vault has received', async () => {
		expect(await replacesPublishedVersion(local, 'Docs/Printer.md')).toBe(true);
		expect(await replacesPublishedVersion(local, 'Docs/New.md')).toBe(false);
	});

	it('keeps the other front matter someone else wrote, adding only what it completes', async () => {
		const original = '---\ntitle: Old\nowner: someone\nlast_reviewed: 2026-01-01\n---\nBody edited\n';

		const result = sentOf(await send(firstSend({ noteText: original, fields: { title: 'New title', category: 'SOP' } })));

		expect(result.committedText).toContain('owner: someone');
		expect(result.committedText).toContain('last_reviewed: 2026-01-01');
		expect(result.committedText).toContain('title: "New title"');
		expect(result.committedText.match(/^title:/gm)).toHaveLength(1);
	});
});

describe('submitting a note again after it was sent', () => {
	beforeEach(async () => {
		await setUp();
	});

	it('is an update on top of the open review, because git knows the note by the send it made', async () => {
		const first = sentOf(await send(firstSend({ noteText: 'text from the first send\n' })));

		const second = sentOf(await send(firstSend({ noteText: 'text as edited since\n' })));

		expect(second.docId).toBe('Printer');
		expect(second.update).toBe(true);
		expect(remote.git(remote.bare, 'rev-parse', `${second.commit}^`).trim()).toBe(first.commit);
		expect(remote.git(remote.bare, 'show', 'doc/Printer:Docs/Printer.md')).toContain('text as edited since');
	});

	it('completes an interrupted attempt that never reached the project, replacing nothing and starting a new round', async () => {
		const first = sentOf(await send(firstSend({ noteText: 'text from the interrupted attempt\n' })));
		// The push is the thing that did not arrive: the record is there, the branch is not.
		remote.deleteBranch('doc/Printer');

		const second = sentOf(await send(firstSend({ noteText: 'text as edited since\n' })));

		expect(second.commit).not.toBe(first.commit);
		expect(remote.tip('doc/Printer')).toBe(second.commit);
		expect(remote.git(remote.bare, 'show', 'doc/Printer:Docs/Printer.md')).not.toContain('interrupted attempt');
		expect(second.update).toBe(false);
	});
});

describe('revising a document that has an identity', () => {
	beforeEach(async () => {
		await setUp();
	});

	it('sends an update on top of the open review, keeping a reviewer\'s commit', async () => {
		sentOf(await send(firstSend()));
		const reviewer = remote.publish('doc/Printer', { 'Docs/Printer.md': remote.git(remote.bare, 'show', 'doc/Printer:Docs/Printer.md'), 'Docs/Notes.md': 'reviewer\'s note' }, 'reviewer');
		await fetchProject(local, remote.address);
		// The reviewer's commit touches another file, so the author may go on; the author has seen the branch.
		const result = sentOf(await send(resend('---\nowner: ana\n---\nThe note, revised\n')));

		expect(result.update).toBe(true);
		expect(remote.git(remote.bare, 'rev-parse', `${result.commit}^`).trim()).toBe(reviewer);
		expect(remote.git(remote.bare, 'log', '--format=%s', 'doc/Printer')).toContain('reviewer');
	});

	it('opens a new round from the default branch for a published document', async () => {
		remote.publish('main', { 'Docs/Printer.md': 'v1\n' });
		await fetchAndSync();

		const result = sentOf(await send(resend('v2\n')));

		expect(result.update).toBe(false);
		expect(remote.git(remote.bare, 'rev-parse', `${result.commit}^`).trim()).toBe(remote.tip('main'));
	});

	it('opens a new round for a document that was not accepted', async () => {
		const result = sentOf(await send(resend('a second attempt\n')));

		expect(result.update).toBe(false);
		expect(remote.tip('doc/Printer')).toBe(result.commit);
	});

	it('refuses when there is nothing new to send', async () => {
		remote.publish('main', { 'Docs/Printer.md': 'v1\n' });
		await fetchAndSync();
		const before = untouched();
		const pushesBefore = pushes();

		const result = await send(resend('v1\n'));

		expect(result).toEqual({ kind: 'refused', message: AUTHOR_MESSAGES.nothingToSend });
		expect(untouched()).toEqual(before);
		expect(pushes()).toBe(pushesBefore);
	});

	async function fetchAndSync(): Promise<void> {
		await fetchProject(local, remote.address);
		const tip = await readRef(local, 'refs/remotes/origin/main');
		const { advanceSynced } = await import('../src/git-publishing/repo');
		if (tip.ok && tip.value !== null) {
			await advanceSynced(local, tip.value);
		}
	}
});

describe('moving a document', () => {
	let confirmed: number;
	const answer = { yes: true };
	const confirm = async (): Promise<boolean> => {
		confirmed += 1;
		return answer.yes;
	};

	beforeEach(async () => {
		confirmed = 0;
		answer.yes = true;
		await setUp({ 'Docs/Printer.md': 'v1\n', 'img/a.png': Buffer.from([1]) });
	});

	const moved = (over: Partial<SubmitInput> = {}): SubmitInput =>
		firstSend({ notePath: 'Archive/Printer.md', noteText: 'v1\n', fields: null, confirmMove: confirm, ...over });

	const changes = (branch: string): string[] =>
		remote.git(remote.bare, 'diff', '--no-renames', '--name-status', 'main', branch).split('\n').filter((l) => l !== '');

	it('adds the new path and removes the old one in one review, after the author confirms, with no identity written', async () => {
		const result = sentOf(await send(moved()));

		expect(result).toMatchObject({ docId: 'Printer', remotePath: 'Archive/Printer.md', moved: true, update: false });
		expect(confirmed).toBe(1);
		expect(changes('doc/Printer')).toEqual(['A\tArchive/Printer.md', 'D\tDocs/Printer.md']);
		expect(remote.git(remote.bare, 'show', 'doc/Printer:Archive/Printer.md')).not.toContain('doc_id');
	});

	it('never removes an image, shared or not', async () => {
		sentOf(await send(moved({ attachments: [{ path: 'img/a.png', bytes: new Uint8Array([1]) }] })));

		expect(remote.git(remote.bare, 'ls-tree', '-r', '--name-only', 'doc/Printer')).toContain('img/a.png');
		expect(changes('doc/Printer').some((line) => line.endsWith('img/a.png'))).toBe(false);
	});

	it('sends nothing, writes nothing and records nothing when the author declines', async () => {
		answer.yes = false;
		const before = untouched();

		const result = await send(moved());

		expect(result).toEqual({ kind: 'declined' });
		expect(confirmed).toBe(1);
		expect(untouched()).toEqual(before);
		expect(pushes()).toBe(0);
	});

	it('moves a note that was also edited, when an older identity property still ties it to its document', async () => {
		const result = sentOf(await send(moved({ noteText: 'v2, edited while moving\n', existingDocId: 'Printer' })));

		expect(result).toMatchObject({ docId: 'Printer', moved: true });
		expect(changes('doc/Printer')).toEqual(['A\tArchive/Printer.md', 'D\tDocs/Printer.md']);
	});

	it('does not ask when the note has not moved', async () => {
		sentOf(await send(firstSend({ notePath: 'Docs/Printer.md', noteText: 'v2\n', fields: null, confirmMove: confirm })));

		expect(confirmed).toBe(0);
	});

	it('refuses, asking nothing, when the new path already holds a different document on the project', async () => {
		remote.publish('main', { 'Archive/Other.md': 'someone else\n' });
		await fetchProject(local, remote.address);
		const tip = await readRef(local, 'refs/remotes/origin/main');
		const { advanceSynced } = await import('../src/git-publishing/repo');
		if (tip.ok && tip.value !== null) {
			await advanceSynced(local, tip.value);
		}
		const before = untouched();

		const result = await send(moved({ notePath: 'Archive/Other.md', existingDocId: 'Printer' }));

		expect(result).toEqual({ kind: 'refused', message: AUTHOR_MESSAGES.pathNotReceived });
		expect(confirmed).toBe(0);
		expect(untouched()).toEqual(before);
	});

	it('refuses, asking nothing, when someone changed the document at its old path since the author last got updates', async () => {
		remote.publish('main', { 'Docs/Printer.md': 'v2 by a reviewer\n' });
		const before = untouched();

		const result = await send(moved());

		expect(result).toEqual({ kind: 'refused', message: AUTHOR_MESSAGES.changedSinceUpdates });
		expect(confirmed).toBe(0);
		expect(untouched()).toEqual(before);
	});

	it('does not take a note for the moved one when another note in the vault has the same bytes, as the panel does not', async () => {
		const bytesOfV1 = blobId(Buffer.from('v1\n'));
		const both = [
			{ path: 'B/x.md', blob: bytesOfV1 },
			{ path: 'B/x_1.md', blob: bytesOfV1 },
		];

		const result = sentOf(
			await send(
				firstSend({
					notePath: 'B/x_1.md',
					basename: 'x_1',
					noteText: 'v1\n',
					fields: null,
					confirmMove: confirm,
					vaultPaths: new Set(['B/x.md', 'B/x_1.md']),
					knownNotes: both,
				})
			)
		);

		expect(result).toMatchObject({ docId: 'x_1', moved: false });
		expect(confirmed).toBe(0);
		expect(remote.git(remote.bare, 'ls-tree', '-r', '--name-only', 'doc/x_1')).toContain('Docs/Printer.md');
	});

	it('does not move a document another note still stands for: a copy at the old path is not a move', async () => {
		// The old path is still in the vault, so the note at the new path is a different note.
		const result = await send(moved({ vaultPaths: new Set(['Archive/Printer.md', 'Docs/Printer.md']) }));

		expect(confirmed).toBe(0);
		expect(result).toEqual({ kind: 'refused', message: AUTHOR_MESSAGES.identityNotUnique });
	});
});

describe('renaming a note while its review is open', () => {
	it('continues the same review on the same branch, adding the new name and removing the old', async () => {
		await setUp();
		const first = sentOf(await send(firstSend({ notePath: 'Docs/Guide.md', basename: 'Guide' })));

		const result = sentOf(
			await send(firstSend({ notePath: 'Docs/Renamed.md', basename: 'Renamed', noteText: first.committedText, fields: null }))
		);

		expect(result).toMatchObject({ docId: 'Guide', moved: true, update: true });
		expect(remote.git(remote.bare, 'rev-parse', `${result.commit}^`).trim()).toBe(first.commit);
		expect(remote.git(remote.bare, 'ls-tree', '-r', '--name-only', 'doc/Guide')).toContain('Docs/Renamed.md');
		expect(remote.git(remote.bare, 'ls-tree', '-r', '--name-only', 'doc/Guide')).not.toContain('Docs/Guide.md');
		expect(remote.tip('doc/Renamed')).toBeNull();
	});
});

describe('a document someone else changed since the author last got updates', () => {
	beforeEach(async () => {
		await setUp({ 'Docs/Printer.md': 'v1\n', 'img/shared.png': Buffer.from([1]) });
	});

	it('is never overwritten', async () => {
		remote.publish('main', { 'Docs/Printer.md': 'v2 by a reviewer\n' });
		const before = untouched();

		const result = await send(resend('v1, edited by me\n'));

		expect(result).toEqual({ kind: 'refused', message: AUTHOR_MESSAGES.changedSinceUpdates });
		expect(untouched()).toEqual(before);
	});

	it('does not block when the note already equals the newer version, and has nothing left to send', async () => {
		remote.publish('main', { 'Docs/Printer.md': 'v2\n' });

		const result = await send(resend('v2\n'));

		expect(result).toEqual({ kind: 'refused', message: AUTHOR_MESSAGES.nothingToSend });
	});

	it('does not block when the change on the project is the author\'s own, merged', async () => {
		const mine = (await send(resend('v1, my revision\n'))) as SubmitResult;
		expect(mine.kind).toBe('sent');
		// The reviewer merges it unchanged, and the author edits again before getting updates.
		remote.publish('main', { 'Docs/Printer.md': 'v1, my revision\n' }, 'merge');

		const result = await send(resend('v1, my revision, edited again\n'));

		expect(result.kind).toBe('sent');
	});

	it('refuses when a shared image changed on the project', async () => {
		remote.publish('main', { 'img/shared.png': Buffer.from([2]) });

		const result = await send(resend('v1, edited\n', { attachments: [{ path: 'img/shared.png', bytes: new Uint8Array([1, 9]) }] }));

		expect(result).toEqual({ kind: 'refused', message: AUTHOR_MESSAGES.changedSinceUpdates });
	});
});

describe('a reviewer\'s commit on the branch under review', () => {
	beforeEach(async () => {
		await setUp();
		sentOf(await send(firstSend()));
	});

	it('stops an update from a note written before it, and says what to do', async () => {
		remote.publish('doc/Printer', { 'Docs/Printer.md': 'a reviewer rewrote it\n' }, 'reviewer');
		await fetchProject(local, remote.address);
		const before = untouched();

		const result = await send(resend('my next edit\n'));

		expect(result).toEqual({ kind: 'refused', message: AUTHOR_MESSAGES.reviewHasChanges });
		expect(untouched()).toEqual(before);
	});

	it('does not stop an update because of a commit on some other file', async () => {
		const current = remote.git(remote.bare, 'show', 'doc/Printer:Docs/Printer.md');
		remote.publish('doc/Printer', { 'Docs/Printer.md': current, 'Docs/Other.md': 'unrelated' }, 'reviewer on another file');
		await fetchProject(local, remote.address);

		expect((await send(resend('my next edit\n'))).kind).toBe('sent');
	});

	it('does not stop an update once a reset has recorded the commits as seen', async () => {
		const reviewer = remote.publish('doc/Printer', { 'Docs/Printer.md': 'a reviewer rewrote it\n' }, 'reviewer');
		await fetchProject(local, remote.address);
		await writeSent(local, 'Printer', reviewer);

		expect((await send(resend('a reviewer rewrote it\nand then my addition\n'))).kind).toBe('sent');
	});

	it('does not compare emails: an author who changed theirs is still the author', async () => {
		const changed = { ...ctx, identity: { name: 'Ana Nguyen', email: 'ana-new@example.com' } };

		expect((await send(resend('my next edit\n'), changed)).kind).toBe('sent');
	});
});

describe('when the push does not go through', () => {
	beforeEach(async () => {
		await setUp();
	});

	it('is told the server\'s rules forbid it, with nothing changed on the project and the sent record put back', async () => {
		remote.setHook('pre-receive', 'echo "You are not allowed to push code to this project." >&2\nexit 1');

		const result = await send(firstSend());

		expect(result).toEqual({ kind: 'failed', failure: 'not-allowed' });
		expect(remote.tip('doc/Printer')).toBeNull();
		expect(vg('for-each-ref', 'refs/docs-publisher/sent')).toBe('');
	});

	it('puts back the earlier sent record, not none, when an attempt after a first one is refused', async () => {
		const first = sentOf(await send(firstSend()));
		remote.setHook('pre-receive', 'echo "You are not allowed to push code to this project." >&2\nexit 1');

		await send(firstSend({ noteText: 'second attempt\n' }));

		expect(await readRef(local, sentRef('Printer'))).toEqual({ ok: true, value: first.commit });
	});

	it('does not overwrite a branch that moved between the fetch and the push', async () => {
		let moved = '';
		const racing: GitRunner = {
			run: async (request: GitRequest) => {
				if (request.args[0] === 'push' && moved === '') {
					moved = remote.publish('doc/Printer', { 'Docs/Printer.md': 'a reviewer got there first\n' });
				}
				return local.git.run(request);
			},
		};
		sentOf(await send(firstSend()));
		const raced = { ...ctx, network: { ...local, git: racing } };

		const result = await send(resend('my next edit\n'), raced);

		expect(result).toEqual({ kind: 'failed', failure: 'changed-meanwhile' });
		expect(remote.tip('doc/Printer')).toBe(moved);
	});

	it('keeps the sent record when the outcome is unknown, so the branch is still recognised as the author\'s', async () => {
		const confused: GitRunner = {
			run: async (request: GitRequest) =>
				request.args[0] === 'push'
					? { exitCode: 1, stdout: Buffer.alloc(0), stderr: 'something nobody has seen', timedOut: false, truncated: false, spawnError: null }
					: local.git.run(request),
		};

		const result = await send(firstSend(), { ...ctx, network: { ...local, git: confused } });

		expect(result).toEqual({ kind: 'failed', failure: 'unexpected' });
		expect(vg('for-each-ref', 'refs/docs-publisher/sent')).toContain('refs/docs-publisher/sent/Printer');
	});

	it('succeeds without a review request when the server only offers a link', async () => {
		remote.setHook(
			'pre-receive',
			'echo "To create a merge request for doc/Printer, visit:" >&2\necho "  https://gitlab.example.com/docs/kb/-/merge_requests/new?x=1" >&2'
		);

		const result = sentOf(await send(firstSend()));

		expect(result.reviewRequest).toBe('link-only');
		expect(result.link).toBe('https://gitlab.example.com/docs/kb/-/merge_requests/new?x=1');
	});

	it('leaves the fetched copy as it was after a failed push, and holds the new tip after a good one', async () => {
		remote.setHook('pre-receive', 'echo "You are not allowed to push" >&2\nexit 1');
		await send(firstSend());
		expect(await readRef(local, fetchedBranchRef('Printer'))).toEqual({ ok: true, value: null });

		remote.setHook('pre-receive', CREATED);
		const result = sentOf(await send(firstSend()));

		expect(await readRef(local, fetchedBranchRef('Printer'))).toEqual({ ok: true, value: result.commit });
	});
});
