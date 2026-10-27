import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitRunner } from '../src/git-publishing/git-runner';
import { blobId } from '../src/git-publishing/blob-id';
import {
	advanceHead,
	advanceSynced,
	branchExists,
	changedFiles,
	deleteRef,
	discardNewRepository,
	ensureExclude,
	fetchProject,
	headRelation,
	initRepository,
	inspectRepo,
	listFiles,
	listSent,
	projectUsesSha1,
	readDefaultBranch,
	readFileAt,
	readRef,
	readSent,
	writeRef,
	writeSent,
} from '../src/git-publishing/repo';
import type { RepoContext } from '../src/git-publishing/repo';
import { CONNECTED_REF, SYNCED_REF, fetchedBranchRef, fetchedDefaultRef, sentRef } from '../src/git-publishing/ref-names';
import { createLocalRemote } from './support/local-remote';
import type { LocalRemote } from './support/local-remote';

let remote: LocalRemote;
let vault: string;
let ctx: RepoContext;

beforeEach(() => {
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
	remote = createLocalRemote();
	vault = mkdtempSync(join(tmpdir(), 'vault-'));
	ctx = { git: remote.runner(), cwd: vault };
});
afterEach(() => {
	remote.dispose();
	rmSync(vault, { recursive: true, force: true });
	vi.restoreAllMocks();
});

/** A checksum of every file under a folder except `.git`, so "nothing in the vault changed" is a comparison. */
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

function vaultGit(...args: string[]): string {
	return remote.git(vault, ...args);
}

/** Connects the way Connect does, by hand, so the other operations have something to read. */
async function connected(): Promise<string> {
	const branch = await readDefaultBranch(ctx, remote.address);
	if (!branch.ok) {
		throw new Error('no default branch');
	}
	await initRepository(ctx, remote.address, branch.value);
	await fetchProject(ctx, remote.address);
	const tip = await readRef(ctx, fetchedDefaultRef(branch.value));
	if (!tip.ok || tip.value === null) {
		throw new Error('no tip');
	}
	return tip.value;
}

describe('blob identifiers computed in the plugin', () => {
	const cases: Array<[string, Buffer]> = [
		['an empty file', Buffer.alloc(0)],
		['text with LF', Buffer.from('one\ntwo\n')],
		['text with CRLF', Buffer.from('one\r\ntwo\r\n')],
		['text with accents', Buffer.from('Trần Phạm — đường\n', 'utf8')],
		['binary data', Buffer.from([0, 255, 1, 254, 0, 0, 7, 128])],
	];
	for (const [label, bytes] of cases) {
		it(`equal git's for ${label}`, () => {
			const file = join(vault, 'f');
			writeFileSync(file, bytes);

			const theirs = execFileSync('git', ['hash-object', '--no-filters', file], { encoding: 'utf8' }).trim();

			expect(blobId(bytes)).toBe(theirs);
		});
	}
});

describe('inspecting the vault', () => {
	it('says there is no repository, and that git can still be run', async () => {
		const report = await inspectRepo(ctx);

		expect(report).toEqual({
			ok: true,
			value: { present: false, topLevelIsVault: false, origin: null, branch: null, headUnborn: false, objectFormat: 'sha1' },
		});
	});

	it('reports a repository at the vault with its origin, branch and unborn HEAD', async () => {
		vaultGit('init', '-q');
		vaultGit('symbolic-ref', 'HEAD', 'refs/heads/trunk');
		vaultGit('remote', 'add', 'origin', 'git@gitlab.example.com:docs/kb.git');

		const report = await inspectRepo(ctx);

		expect(report.ok && report.value).toEqual({
			present: true,
			topLevelIsVault: true,
			origin: 'git@gitlab.example.com:docs/kb.git',
			branch: 'trunk',
			headUnborn: true,
			objectFormat: 'sha1',
		});
	});

	it('reports no branch for a detached HEAD', async () => {
		vaultGit('init', '-q');
		writeFileSync(join(vault, 'a.md'), 'a');
		vaultGit('add', '-A');
		vaultGit('commit', '-q', '-m', 'a');
		vaultGit('checkout', '-q', '--detach');

		const report = await inspectRepo(ctx);

		expect(report.ok && report.value.branch).toBeNull();
		expect(report.ok && report.value.headUnborn).toBe(false);
	});

	it('says a vault inside another repository is not at its own top level', async () => {
		vaultGit('init', '-q');
		const inner = join(vault, 'notes');
		mkdirSync(inner);

		const report = await inspectRepo({ ...ctx, cwd: inner });

		expect(report.ok && report.value.present).toBe(true);
		expect(report.ok && report.value.topLevelIsVault).toBe(false);
	});

	it('recognises the other object format', async () => {
		try {
			vaultGit('init', '-q', '--object-format=sha256');
		} catch {
			return; // This git cannot make one.
		}

		const report = await inspectRepo(ctx);

		expect(report.ok && report.value.objectFormat).toBe('other');
	});

	it('reports git itself being missing as a failure, not as "no repository"', async () => {
		const missing = { ...ctx, git: remoteRunnerWithoutGit() };

		expect(await inspectRepo(missing)).toEqual({ ok: false, failure: 'git-missing' });
	});

	function remoteRunnerWithoutGit(): GitRunner {
		return { run: async () => ({ exitCode: null, stdout: Buffer.alloc(0), stderr: '', timedOut: false, truncated: false, spawnError: 'ENOENT' }) };
	}
});

describe('how HEAD stands to a fetched commit', () => {
	it('is unborn in a repository with no commits', async () => {
		vaultGit('init', '-q');

		expect(await headRelation(ctx, 'a'.repeat(40))).toEqual({ ok: true, value: 'unborn' });
	});

	it('is equal, behind or ahead of it', async () => {
		vaultGit('init', '-q');
		writeFileSync(join(vault, 'a.md'), '1');
		vaultGit('add', '-A');
		vaultGit('commit', '-q', '-m', '1');
		const first = vaultGit('rev-parse', 'HEAD').trim();
		writeFileSync(join(vault, 'a.md'), '2');
		vaultGit('commit', '-q', '-am', '2');
		const second = vaultGit('rev-parse', 'HEAD').trim();

		expect(await headRelation(ctx, second)).toEqual({ ok: true, value: 'equal' });
		vaultGit('reset', '-q', '--hard', first);
		expect(await headRelation(ctx, second)).toEqual({ ok: true, value: 'ancestor' });
		writeFileSync(join(vault, 'b.md'), 'local only');
		vaultGit('add', '-A');
		vaultGit('commit', '-q', '-m', 'local');
		expect(await headRelation(ctx, second)).toEqual({ ok: true, value: 'diverged' });
	});
});

describe('initialising and linking, without touching a file', () => {
	it('makes an unborn repository on the default branch with the project as origin', async () => {
		writeFileSync(join(vault, 'note.md'), 'mine');
		const before = checksums(vault);

		const made = await initRepository(ctx, remote.address, 'main');

		expect(made.ok).toBe(true);
		const report = await inspectRepo(ctx);
		expect(report.ok && report.value).toMatchObject({
			present: true,
			topLevelIsVault: true,
			origin: 'git@gitlab.example.com:docs/kb.git',
			branch: 'main',
			headUnborn: true,
		});
		expect(checksums(vault)).toEqual(before);
	});

	it('keeps the settings and trash folders out of the repository without writing a committed ignore file', async () => {
		await initRepository(ctx, remote.address, 'main');

		const exclude = readFileSync(join(vault, '.git', 'info', 'exclude'), 'utf8').split('\n');

		expect(exclude).toContain('.obsidian/');
		expect(exclude).toContain('.trash/');
		expect(existsSync(join(vault, '.gitignore'))).toBe(false);
	});

	it('adds only the lines that are missing, and keeps what is there', async () => {
		await initRepository(ctx, remote.address, 'main');
		const file = join(vault, '.git', 'info', 'exclude');
		writeFileSync(file, '# mine\n.obsidian/\nscratch/');

		await ensureExclude(ctx);
		await ensureExclude(ctx);

		const lines = readFileSync(file, 'utf8').split('\n').filter((l) => l !== '');
		expect(lines).toEqual(['# mine', '.obsidian/', 'scratch/', '.trash/']);
	});

	it('refuses to initialise over an existing repository and changes nothing', async () => {
		vaultGit('init', '-q');
		vaultGit('remote', 'add', 'origin', 'git@elsewhere.example.com:a/b.git');

		const made = await initRepository(ctx, remote.address, 'main');

		expect(made.ok).toBe(false);
		expect(vaultGit('config', '--get', 'remote.origin.url').trim()).toBe('git@elsewhere.example.com:a/b.git');
	});

	it('takes back the repository it made when a later step fails, so the next attempt starts clean', async () => {
		const failing: GitRunner = {
			run: async (request) =>
				request.args[0] === 'remote'
					? { exitCode: 1, stdout: Buffer.alloc(0), stderr: 'boom', timedOut: false, truncated: false, spawnError: null }
					: ctx.git.run(request),
		};

		const made = await initRepository({ ...ctx, git: failing }, remote.address, 'main');

		expect(made.ok).toBe(false);
		expect(existsSync(join(vault, '.git'))).toBe(false);
	});

	it('can discard a repository it has just made', async () => {
		await initRepository(ctx, remote.address, 'main');

		await discardNewRepository(ctx);

		expect(existsSync(join(vault, '.git'))).toBe(false);
	});
});

describe('the project, and the fetched copy of it', () => {
	it('reads the default branch from the server, never assuming main', async () => {
		const other = createLocalRemote({ defaultBranch: 'master' });
		try {
			const read = await readDefaultBranch({ git: other.runner(), cwd: vault }, other.address);

			expect(read).toEqual({ ok: true, value: 'master' });
		} finally {
			other.dispose();
		}
	});

	it('says a project with nothing in it is empty', async () => {
		const empty = createLocalRemote({ empty: true });
		try {
			expect(await readDefaultBranch({ git: empty.runner(), cwd: vault }, empty.address)).toEqual({
				ok: false,
				failure: 'empty-repository',
			});
		} finally {
			empty.dispose();
		}
	});

	it('says the project uses 40-character identifiers', async () => {
		expect(await projectUsesSha1(ctx, remote.address)).toEqual({ ok: true, value: true });
	});

	it('makes every branch available to read, and removes one the project no longer has', async () => {
		remote.publish('doc/printer', { 'Printer.md': 'text' });
		await initRepository(ctx, remote.address, 'main');

		await fetchProject(ctx, remote.address);
		expect((await readRef(ctx, fetchedBranchRef('printer'))).ok).toBe(true);
		expect(await branchExists(ctx, 'printer', 'main')).toBe('exists');

		remote.deleteBranch('doc/printer');
		await fetchProject(ctx, remote.address);

		expect(await branchExists(ctx, 'printer', 'main')).toBe('absent');
	});

	it('leaves the previous fetched copy as it was when a fetch fails, and says why', async () => {
		await initRepository(ctx, remote.address, 'main');
		await fetchProject(ctx, remote.address);
		const before = await readRef(ctx, fetchedDefaultRef('main'));
		rmSync(remote.bare, { recursive: true, force: true });

		const failed = await fetchProject(ctx, remote.address);

		expect(failed.ok).toBe(false);
		expect(await readRef(ctx, fetchedDefaultRef('main'))).toEqual(before);
	});

	it('does not touch a file in the vault', async () => {
		writeFileSync(join(vault, 'mine.md'), 'mine');
		const before = checksums(vault);

		await connected();

		expect(checksums(vault)).toEqual(before);
	});
});

describe('whether a branch exists, as a three-way answer', () => {
	it('is "failed", not "absent", before any fetch has completed', async () => {
		await initRepository(ctx, remote.address, 'main');

		expect(await branchExists(ctx, 'printer', 'main')).toBe('failed');
	});

	it('is "failed" in a vault with no repository', async () => {
		expect(await branchExists(ctx, 'printer', 'main')).toBe('failed');
	});

	it('is "absent" once a fetch has completed and the branch is not in it', async () => {
		await connected();

		expect(await branchExists(ctx, 'printer', 'main')).toBe('absent');
	});
});

describe('listing a revision\'s files', () => {
	it('lists every file with the identifier git gives it', async () => {
		remote.publish('main', { 'Docs/a.md': 'a\r\n', 'img/p.png': Buffer.from([0, 1, 2, 255]) });
		const tip = await connected();

		const listed = await listFiles(ctx, tip);

		expect(listed.ok).toBe(true);
		const files = listed.ok ? listed.value : new Map<string, string>();
		expect(files.get('Docs/a.md')).toBe(blobId(Buffer.from('a\r\n')));
		expect(files.get('img/p.png')).toBe(blobId(Buffer.from([0, 1, 2, 255])));
		expect(files.get('README.md')).toBe(blobId(Buffer.from('Project\n')));
	});

	it('leaves out the settings folder and the repository folder, whatever the project holds there', async () => {
		remote.publish('main', { '.obsidian/app.json': '{}', 'Docs/a.md': 'a' });
		const tip = await connected();

		const listed = await listFiles(ctx, tip);

		expect(listed.ok && Array.from(listed.value.keys()).sort()).toEqual(['Docs/a.md', 'README.md']);
	});

	it('fails, and does not return an empty listing, for a revision it cannot read', async () => {
		await connected();

		expect((await listFiles(ctx, 'f'.repeat(40))).ok).toBe(false);
	});

	it('lists the last synced version, which can be older than the fetched one', async () => {
		const first = await connected();
		await advanceSynced(ctx, first);
		remote.publish('main', { 'New.md': 'new' });
		await fetchProject(ctx, remote.address);

		const synced = await listFiles(ctx, SYNCED_REF);

		expect(synced.ok && Array.from(synced.value.keys())).toEqual(['README.md']);
	});

	it('lists a path with spaces and accents whole', async () => {
		remote.publish('main', { 'Hướng dẫn/In máy in.md': 'x' });
		const tip = await connected();

		const listed = await listFiles(ctx, tip);

		expect(listed.ok && listed.value.has('Hướng dẫn/In máy in.md')).toBe(true);
	});
});

describe('reading one file at a fetched revision', () => {
	it('returns the bytes unchanged, line endings included', async () => {
		remote.publish('main', { 'a.md': Buffer.from('one\r\ntwo\r\n') });
		const tip = await connected();

		const read = await readFileAt(ctx, tip, 'a.md');

		expect(read.kind === 'file' && read.bytes.toString()).toBe('one\r\ntwo\r\n');
	});

	it('returns binary content unchanged', async () => {
		const bytes = Buffer.from([0, 255, 10, 13, 0, 7]);
		remote.publish('main', { 'p.png': bytes });
		const tip = await connected();

		const read = await readFileAt(ctx, tip, 'p.png');

		expect(read.kind === 'file' && read.bytes.equals(bytes)).toBe(true);
	});

	it('says absent for a path the revision does not hold', async () => {
		const tip = await connected();

		expect(await readFileAt(ctx, tip, 'nothing.md')).toEqual({ kind: 'absent' });
	});

	it('says failed, and not absent, for a revision that does not exist', async () => {
		await connected();

		expect(await readFileAt(ctx, 'refs/remotes/origin/nope', 'README.md')).toEqual({ kind: 'failed' });
	});

	it('says failed for a path in a folder the plugin never reads', async () => {
		const tip = await connected();

		expect(await readFileAt(ctx, tip, '.obsidian/app.json')).toEqual({ kind: 'failed' });
	});

	it('starts no network connection', async () => {
		const tip = await connected();
		rmSync(remote.bare, { recursive: true, force: true });

		expect((await readFileAt(ctx, tip, 'README.md')).kind).toBe('file');
	});
});

describe('the files a document branch changed', () => {
	it('names the one document, and lists the images beside it', async () => {
		remote.publish('doc/printer', {
			'Docs/Printer.md': 'text',
			'img/a.png': Buffer.from([1]),
			'img/b.png': Buffer.from([2]),
		});
		await connected();

		const changes = await changedFiles(ctx, 'printer', 'main');

		expect(changes.ok).toBe(true);
		if (changes.ok) {
			expect(changes.value.document).toBe('Docs/Printer.md');
			expect(changes.value.files.map((f) => f.path).sort()).toEqual(['Docs/Printer.md', 'img/a.png', 'img/b.png']);
			expect(changes.value.files.every((f) => f.branchBlob !== null && f.defaultBlob === null)).toBe(true);
		}
	});

	it('does not guess among several markdown files', async () => {
		remote.publish('doc/two', { 'a.md': 'a', 'b.md': 'b' });
		await connected();

		const changes = await changedFiles(ctx, 'two', 'main');

		expect(changes.ok && changes.value.document).toBeNull();
		expect(changes.ok && changes.value.files).toHaveLength(2);
	});

	it('has no document for a branch that changed only an image, and shows the image as different', async () => {
		remote.publish('main', { 'img/a.png': Buffer.from([1]) });
		remote.publish('doc/img', { 'img/a.png': Buffer.from([2]) });
		await connected();

		const changes = await changedFiles(ctx, 'img', 'main');

		expect(changes.ok && changes.value.document).toBeNull();
		expect(changes.ok && changes.value.files[0].branchBlob).not.toBe(changes.ok && changes.value.files[0].defaultBlob);
	});

	it('shows a branch squash-merged and left behind as identical on both sides', async () => {
		remote.publish('doc/printer', { 'Docs/Printer.md': 'text' });
		// The squash: the default branch gets the same content in a commit of its own.
		remote.publish('main', { 'Docs/Printer.md': 'text' }, 'squash');
		await connected();

		const changes = await changedFiles(ctx, 'printer', 'main');

		expect(changes.ok).toBe(true);
		if (changes.ok) {
			expect(changes.value.files).toHaveLength(1);
			expect(changes.value.files[0].branchBlob).toBe(changes.value.files[0].defaultBlob);
		}
	});

	it('fails for a branch that is not there, rather than returning no changes', async () => {
		await connected();

		expect((await changedFiles(ctx, 'nobody', 'main')).ok).toBe(false);
	});

	it('carries a deleted file as present on the default branch only', async () => {
		remote.publish('main', { 'Old.md': 'old', 'keep.md': 'k' });
		const clone = join(remote.root, 'gone');
		mkdirSync(clone);
		remote.git(clone, 'init', '-q');
		remote.git(clone, 'remote', 'add', 'origin', remote.bare);
		remote.git(clone, 'fetch', '-q', 'origin', '+refs/heads/main:refs/heads/main');
		remote.git(clone, 'checkout', '-q', '-b', 'doc/gone', 'main');
		rmSync(join(clone, 'Old.md'));
		remote.git(clone, 'commit', '-q', '-am', 'remove');
		remote.git(clone, 'push', '-q', 'origin', 'doc/gone:doc/gone');
		await connected();

		const changes = await changedFiles(ctx, 'gone', 'main');

		expect(changes.ok && changes.value.files).toEqual([{ path: 'Old.md', branchBlob: null, defaultBlob: blobId(Buffer.from('old')) }]);
		expect(changes.ok && changes.value.document).toBeNull();
	});
});

describe('the bookkeeping refs', () => {
	it('reports a ref that was never written as missing, not as an error', async () => {
		await connected();

		expect(await readSent(ctx, 'printer')).toEqual({ ok: true, value: null });
		expect(await readRef(ctx, CONNECTED_REF)).toEqual({ ok: true, value: null });
	});

	it('records and reads back the commit built for a document, and lists them', async () => {
		const tip = await connected();

		await writeSent(ctx, 'printer', tip);
		await writeSent(ctx, 'scanner', tip);

		expect(await readSent(ctx, 'printer')).toEqual({ ok: true, value: tip });
		const all = await listSent(ctx);
		expect(all.ok && Array.from(all.value.keys()).sort()).toEqual(['printer', 'scanner']);
	});

	it('deletes a ref, and then reports it missing', async () => {
		const tip = await connected();
		await writeRef(ctx, CONNECTED_REF, tip);

		await deleteRef(ctx, CONNECTED_REF);

		expect(await readRef(ctx, CONNECTED_REF)).toEqual({ ok: true, value: null });
	});

	it('refuses an identity that is not usable in a ref name, before any command', async () => {
		await connected();

		await expect(readSent(ctx, 'a b')).rejects.toThrow(/not usable/);
		expect(() => sentRef('a..b')).toThrow();
		expect(() => sentRef('-x')).toThrow();
		expect(() => sentRef('a@{1}')).toThrow();
		expect(() => sentRef('x.lock')).toThrow();
	});

	it('is never pushed: a document branch push leaves no bookkeeping ref on the project', async () => {
		const tip = await connected();
		await writeSent(ctx, 'printer', tip);

		const refs = remote.git(remote.bare, 'for-each-ref', '--format=%(refname)');

		expect(refs).not.toContain('docs-publisher');
	});
});

describe('the last synced version', () => {
	it('equals the fetched commit\'s tree when nothing is held back, and moves no file, HEAD or index', async () => {
		remote.publish('main', { 'Docs/a.md': 'a' });
		writeFileSync(join(vault, 'mine.md'), 'mine');
		const tip = await connected();
		const before = checksums(vault);

		const synced = await advanceSynced(ctx, tip);

		expect(synced.ok).toBe(true);
		expect(remote.git(vault, 'rev-parse', `${SYNCED_REF}^{tree}`)).toBe(remote.git(vault, 'rev-parse', `${tip}^{tree}`));
		expect(checksums(vault)).toEqual(before);
		expect(() => vaultGit('rev-parse', '--verify', '--quiet', 'HEAD')).toThrow();
	});

	it('keeps a held-back path as it was, so the next update sees it again, and takes the rest', async () => {
		remote.publish('main', { 'Docs/a.md': 'a1', 'Docs/b.md': 'b1' });
		const first = await connected();
		await advanceSynced(ctx, first);
		remote.publish('main', { 'Docs/a.md': 'a2', 'Docs/b.md': 'b2' });
		await fetchProject(ctx, remote.address);
		const second = await readRef(ctx, fetchedDefaultRef('main'));

		await advanceSynced(ctx, second.ok && second.value ? second.value : '', ['Docs/a.md']);

		const synced = await listFiles(ctx, SYNCED_REF);
		expect(synced.ok && synced.value.get('Docs/a.md')).toBe(blobId(Buffer.from('a1')));
		expect(synced.ok && synced.value.get('Docs/b.md')).toBe(blobId(Buffer.from('b2')));
	});

	it('keeps a held-back path that was never synced absent', async () => {
		const first = await connected();
		await advanceSynced(ctx, first);
		remote.publish('main', { 'Docs/new.md': 'n' });
		await fetchProject(ctx, remote.address);
		const second = await readRef(ctx, fetchedDefaultRef('main'));

		await advanceSynced(ctx, second.ok && second.value ? second.value : '', ['Docs/new.md']);

		const synced = await listFiles(ctx, SYNCED_REF);
		expect(synced.ok && synced.value.has('Docs/new.md')).toBe(false);
		expect(synced.ok && synced.value.has('README.md')).toBe(true);
	});

	it('is only a bookkeeping ref, kept alive without a parent', async () => {
		const tip = await connected();

		await advanceSynced(ctx, tip);

		expect(vaultGit('rev-list', '--count', SYNCED_REF).trim()).toBe('1');
	});
});

describe('moving HEAD without touching a file', () => {
	it('fast-forwards an unborn HEAD to the fetched tip and leaves every file as it was', async () => {
		writeFileSync(join(vault, 'Docs-a.md'), 'my own text');
		const tip = await connected();
		const before = checksums(vault);

		const moved = await advanceHead(ctx, tip);

		expect(moved).toEqual({ ok: true, value: 'moved' });
		expect(vaultGit('rev-parse', 'HEAD').trim()).toBe(tip);
		expect(checksums(vault)).toEqual(before);
	});

	it('says it is already there when HEAD is the tip', async () => {
		const tip = await connected();
		await advanceHead(ctx, tip);

		expect(await advanceHead(ctx, tip)).toEqual({ ok: true, value: 'already' });
	});

	it('moves a HEAD that is behind', async () => {
		const first = await connected();
		await advanceHead(ctx, first);
		remote.publish('main', { 'Docs/a.md': 'a' });
		await fetchProject(ctx, remote.address);
		const second = await readRef(ctx, fetchedDefaultRef('main'));

		const moved = await advanceHead(ctx, second.ok && second.value ? second.value : '');

		expect(moved).toEqual({ ok: true, value: 'moved' });
	});

	it('does not move HEAD or the index when HEAD carries a commit that was never sent', async () => {
		const first = await connected();
		await advanceHead(ctx, first);
		writeFileSync(join(vault, 'local.md'), 'unsent');
		vaultGit('add', '-A');
		vaultGit('commit', '-q', '-m', 'unsent');
		const head = vaultGit('rev-parse', 'HEAD').trim();
		remote.publish('main', { 'Docs/a.md': 'a' });
		await fetchProject(ctx, remote.address);
		const second = await readRef(ctx, fetchedDefaultRef('main'));

		const moved = await advanceHead(ctx, second.ok && second.value ? second.value : '');

		expect(moved).toEqual({ ok: true, value: 'not-fast-forward' });
		expect(vaultGit('rev-parse', 'HEAD').trim()).toBe(head);
		expect(statSync(join(vault, 'local.md')).isFile()).toBe(true);
	});
});
