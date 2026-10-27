import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { blobId } from '../src/git-publishing/blob-id';
import { buildCommit, isCommittablePath } from '../src/git-publishing/plumbing-commit';
import { fetchedDefaultRef } from '../src/git-publishing/ref-names';
import { fetchProject, readRef } from '../src/git-publishing/repo';
import type { RepoContext } from '../src/git-publishing/repo';
import { connectReceived } from './support/connect-received';
import { createLocalRemote } from './support/local-remote';
import type { LocalRemote } from './support/local-remote';

let remote: LocalRemote;
let vault: string;
let ctx: RepoContext;
let parent: string;

const ME = { name: 'Ana Nguyen', email: 'ana@example.com' };

beforeEach(async () => {
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
	remote = createLocalRemote();
	vault = mkdtempSync(join(tmpdir(), 'vault-'));
	ctx = { git: remote.runner(), cwd: vault };
	await connectReceived(ctx, remote.address);
	const tip = await readRef(ctx, fetchedDefaultRef('main'));
	parent = tip.ok && tip.value !== null ? tip.value : '';
});
afterEach(() => {
	remote.dispose();
	rmSync(vault, { recursive: true, force: true });
	vi.restoreAllMocks();
});

const vg = (...args: string[]): string => remote.git(vault, ...args);
const bytes = (text: string): Uint8Array => new Uint8Array(Buffer.from(text));

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

async function built(files: Array<{ path: string; bytes: Uint8Array }>, message = 'docs: add a note') {
	const result = await buildCommit(ctx, parent, files, ME, message);
	if (!result.ok) {
		throw new Error(`could not build: ${result.failure}`);
	}
	return result.value;
}

describe('building a commit from files, without touching the vault', () => {
	// The second experiment (E2), as a named test. The first (E1) is why this is
	// done with a throwaway index: switching to a branch and back reverts the note
	// being sent to what that branch holds, which is the author's own text.
	it('commits a note and two images, with the vault\'s files, index and HEAD exactly as they were (E2)', async () => {
		writeFileSync(join(vault, 'Printer.md'), 'my note, still unsent\r\n');
		mkdirSync(join(vault, 'img'));
		writeFileSync(join(vault, 'img', 'a.png'), Buffer.from([0, 1, 2]));
		const before = { files: checksums(vault), index: vg('ls-files', '-s'), head: vg('rev-parse', 'HEAD') };

		const commit = await built([
			{ path: 'Docs/Printer.md', bytes: bytes('my note, still unsent\r\n') },
			{ path: 'img/a.png', bytes: new Uint8Array([0, 1, 2]) },
			{ path: 'img/b.png', bytes: new Uint8Array([255, 254, 0]) },
		]);

		expect(commit.commit).toMatch(/^[0-9a-f]{40}$/);
		expect(checksums(vault)).toEqual(before.files);
		expect(vg('ls-files', '-s')).toBe(before.index);
		expect(vg('rev-parse', 'HEAD')).toBe(before.head);
	});

	it('makes a tree that is the parent\'s plus those files, and never deletes', async () => {
		const commit = await built([{ path: 'Docs/Printer.md', bytes: bytes('text') }]);

		const listing = vg('ls-tree', '-r', '--name-only', commit.commit).split('\n').filter((l) => l !== '').sort();

		expect(listing).toEqual(['Docs/Printer.md', 'README.md']);
		expect(vg('rev-parse', `${commit.commit}^`).trim()).toBe(parent);
	});

	it('replaces a file the parent has with the new bytes and leaves every other path as it was', async () => {
		const commit = await built([{ path: 'README.md', bytes: bytes('changed\n') }]);

		expect(vg('show', `${commit.commit}:README.md`)).toBe('changed\n');
		expect(commit.blobs.get('README.md')).toBe(blobId(Buffer.from('changed\n')));
	});

	it('still builds when a file is byte-identical to the parent\'s, and the path is unchanged', async () => {
		const commit = await built([{ path: 'README.md', bytes: bytes('Project\n') }]);

		expect(vg('rev-parse', `${commit.commit}^{tree}`)).toBe(vg('rev-parse', `${parent}^{tree}`));
	});

	it('writes the author and committer it is given, in a repository that has neither set', async () => {
		const commit = await built([{ path: 'a.md', bytes: bytes('a') }]);

		expect(vg('log', '-1', '--format=%an <%ae> | %cn <%ce>', commit.commit).trim()).toBe(
			'Ana Nguyen <ana@example.com> | Ana Nguyen <ana@example.com>'
		);
	});

	it('does not use the repository\'s own name and email when it has some', async () => {
		vg('config', '--local', 'user.name', 'Someone Else');
		vg('config', '--local', 'user.email', 'else@example.com');

		const commit = await built([{ path: 'a.md', bytes: bytes('a') }]);

		expect(vg('log', '-1', '--format=%ae', commit.commit).trim()).toBe('ana@example.com');
	});

	it('keeps Windows line endings, whatever the repository does with them', async () => {
		vg('config', '--local', 'core.autocrlf', 'true');
		const crlf = 'one\r\ntwo\r\n';

		const commit = await built([{ path: 'a.md', bytes: bytes(crlf) }]);

		expect(commit.blobs.get('a.md')).toBe(blobId(Buffer.from(crlf)));
		expect(vg('show', `${commit.commit}:a.md`)).toBe(crlf);
	});

	it('keeps an image byte for byte', async () => {
		const image = new Uint8Array([0, 255, 10, 13, 0, 7, 128, 13, 10]);

		const commit = await built([{ path: 'img/p.png', bytes: image }]);

		expect(commit.blobs.get('img/p.png')).toBe(blobId(Buffer.from(image)));
	});

	it('does not run a clean filter the repository names, so what is stored is what is in the note', async () => {
		writeFileSync(join(vault, '.gitattributes'), '*.md filter=evil\n');
		vg('config', '--local', 'filter.evil.clean', `sh -c 'touch ${join(vault, 'filter-ran')}; cat'`);

		const commit = await built([{ path: 'a.md', bytes: bytes('exact bytes') }]);

		expect(existsSync(join(vault, 'filter-ran'))).toBe(false);
		expect(commit.blobs.get('a.md')).toBe(blobId(Buffer.from('exact bytes')));
	});

	it('builds in one commit a note and an image that reach the project intact', async () => {
		const commit = await built([
			{ path: 'Docs/Printer.md', bytes: bytes('t\r\n') },
			{ path: 'img/a.png', bytes: new Uint8Array([9, 8, 7]) },
		]);

		expect(vg('cat-file', '-p', `${commit.commit}:img/a.png`).length).toBeGreaterThan(0);
		expect(commit.blobs.size).toBe(2);
	});

	it('does not leave its scratch index behind', async () => {
		// A temp folder of its own, so other tests running at the same time cannot be counted.
		const privateTmp = mkdtempSync(join(tmpdir(), 'private-tmp-'));
		const saved = process.env.TMPDIR;
		process.env.TMPDIR = privateTmp;
		try {
			await built([{ path: 'a.md', bytes: bytes('a') }]);

			expect(readdirSync(privateTmp)).toEqual([]);
		} finally {
			if (saved === undefined) {
				delete process.env.TMPDIR;
			} else {
				process.env.TMPDIR = saved;
			}
			rmSync(privateTmp, { recursive: true, force: true });
		}
	});
});

describe('what it refuses before any process is started', () => {
	const bad = [
		'../escape.md',
		'a/../../escape.md',
		'/absolute.md',
		'a\\b.md',
		'a/./b.md',
		'a//b.md',
		'.git/config',
		'a/.git/hooks/x',
		'.obsidian/app.json',
		'a\nb.md',
		'a\0b.md',
		'',
	];
	for (const path of bad) {
		it(`refuses the path ${JSON.stringify(path)}`, async () => {
			await expect(buildCommit(ctx, parent, [{ path, bytes: bytes('x') }], ME, 'docs: x')).rejects.toThrow(/not a path that can be committed/);
		});
	}

	it('refuses a parent that is not a full commit identifier', async () => {
		await expect(buildCommit(ctx, 'main', [], ME, 'docs: x')).rejects.toThrow(/full commit/);
		await expect(buildCommit(ctx, parent.slice(0, 10), [], ME, 'docs: x')).rejects.toThrow(/full commit/);
	});

	it('refuses a message that would be read as an option', async () => {
		await expect(buildCommit(ctx, parent, [], ME, '--amend')).rejects.toThrow(/dash/);
		await expect(buildCommit(ctx, parent, [], ME, '')).rejects.toThrow();
	});

	it('accepts the ordinary paths a vault has, accents and spaces included', () => {
		for (const good of ['a.md', 'Docs/Hướng dẫn/In máy in.md', 'img/a b.png', '.hidden-note.md', 'a/.keep']) {
			expect(isCommittablePath(good)).toBe(true);
		}
	});
});

describe('removing the old path of a document that moved', () => {
	let base: string;

	beforeEach(async () => {
		remote.publish('main', { 'Docs/A.md': 'a\n', 'Docs/B.md': 'b\n', 'img/x.png': Buffer.from([1, 2]) });
		await fetchProject(ctx, remote.address);
		const tip = await readRef(ctx, fetchedDefaultRef('main'));
		base = tip.ok && tip.value !== null ? tip.value : '';
	});

	const listing = (commit: string): string[] => vg('ls-tree', '-r', '--name-only', commit).split('\n').filter((l) => l !== '');

	it('adds the new path and removes only the one old path, leaving every other file in the tree', async () => {
		const result = await buildCommit(ctx, base, [{ path: 'Archive/A.md', bytes: bytes('a\n') }], ME, 'docs: move a note', ['Docs/A.md']);

		if (!result.ok) {
			throw new Error('could not build');
		}
		expect(listing(result.value.commit)).toEqual(['Archive/A.md', 'Docs/B.md', 'README.md', 'img/x.png']);
	});

	it('leaves the vault\'s files, index and HEAD exactly as they were', async () => {
		const before = { files: checksums(vault), index: vg('ls-files', '-s'), head: vg('rev-parse', 'HEAD') };

		await buildCommit(ctx, base, [{ path: 'Archive/A.md', bytes: bytes('a\n') }], ME, 'docs: move a note', ['Docs/A.md']);

		expect(checksums(vault)).toEqual(before.files);
		expect(vg('ls-files', '-s')).toBe(before.index);
		expect(vg('rev-parse', 'HEAD')).toBe(before.head);
	});

	it('does nothing for an old path the parent does not hold', async () => {
		const result = await buildCommit(ctx, base, [{ path: 'Archive/A.md', bytes: bytes('a\n') }], ME, 'docs: move a note', ['Docs/Missing.md']);

		if (!result.ok) {
			throw new Error('could not build');
		}
		expect(listing(result.value.commit)).toEqual(['Archive/A.md', 'Docs/A.md', 'Docs/B.md', 'README.md', 'img/x.png']);
	});

	it('reads a path as a name even when it looks like an option', async () => {
		const result = await buildCommit(ctx, base, [{ path: 'Archive/A.md', bytes: bytes('a\n') }], ME, 'docs: move a note', ['--cacheinfo.md']);

		if (!result.ok) {
			throw new Error('could not build');
		}
		expect(listing(result.value.commit)).toContain('Docs/A.md');
	});

	it('refuses to remove an image, since a file other documents may share is never removed', async () => {
		await expect(buildCommit(ctx, base, [], ME, 'docs: x', ['img/x.png'])).rejects.toThrow(/not a path that can be removed/);
	});

	it('refuses to remove a path it is also adding, or one that cannot be committed', async () => {
		await expect(buildCommit(ctx, base, [{ path: 'Docs/A.md', bytes: bytes('a') }], ME, 'docs: x', ['Docs/A.md'])).rejects.toThrow(/removed/);
		await expect(buildCommit(ctx, base, [], ME, 'docs: x', ['../escape.md'])).rejects.toThrow(/removed/);
		await expect(buildCommit(ctx, base, [], ME, 'docs: x', ['.git/x.md'])).rejects.toThrow(/removed/);
	});
});
