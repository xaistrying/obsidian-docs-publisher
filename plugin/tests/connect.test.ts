import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTHOR_MESSAGES } from '../src/author-messages';
import type { GitRunner } from '../src/git-publishing/git-runner';
import { CONNECTED_REF, SYNCED_REF, fetchedDefaultRef } from '../src/git-publishing/ref-names';
import { readRef } from '../src/git-publishing/repo';
import type { RepoContext } from '../src/git-publishing/repo';
import { connectVault } from '../src/vault-sync/connect';
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

/** Every file in the vault outside `.git`, by content, so "no file changed" is one comparison. */
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

const vg = (...args: string[]): string => remote.git(vault, ...args);

/** What a repository holds that connecting must not change when it refuses: refs, settings, index and ignore file. */
function repositoryState(): string {
	if (!existsSync(join(vault, '.git'))) {
		return 'none';
	}
	const exclude = existsSync(join(vault, '.git', 'info', 'exclude')) ? readFileSync(join(vault, '.git', 'info', 'exclude'), 'utf8') : '';
	let head = 'unborn';
	try {
		head = vg('rev-parse', 'HEAD').trim();
	} catch {
		// Nothing there yet.
	}
	return [vg('for-each-ref'), vg('config', '--local', '--list'), vg('ls-files', '-s'), head, exclude].join('\n---\n');
}

const SAME = AUTHOR_MESSAGES.vaultConnected;

describe('connecting a vault that is not a repository', () => {
	it('works for an empty vault, writes nothing, and records both refs as nothing synced yet', async () => {
		mkdirSync(join(vault, '.obsidian'));
		writeFileSync(join(vault, '.obsidian', 'app.json'), '{"mine":true}');
		const before = checksums(vault);

		const result = await connectVault(ctx, remote.address);

		expect(result).toEqual({ ok: true, message: SAME });
		// The same commit for both, and a commit of nothing: every file the project
		// holds then differs from the base, so the first update downloads it.
		const synced = await readRef(ctx, SYNCED_REF);
		expect(synced.ok && synced.value).toBeTruthy();
		expect(await readRef(ctx, CONNECTED_REF)).toEqual(synced);
		expect(vg('rev-parse', `${SYNCED_REF}^{tree}`).trim()).toBe('4b825dc642cb6eb9a060e54bf8d69288fbee4904');
		expect(checksums(vault)).toEqual(before);
	});

	it('leaves the project waiting to be downloaded, not already received', async () => {
		await connectVault(ctx, remote.address);

		const { deriveStates } = await import('../src/submission-tracking/derive-state');
		const states = await deriveStates(ctx, []);

		expect(states.ok && states.value?.updatesAvailable).toBe(1);
	});

	it('points HEAD and the index at the project and writes the ignore lines', async () => {
		await connectVault(ctx, remote.address);

		expect(vg('rev-parse', 'HEAD').trim()).toBe(vg('rev-parse', 'refs/remotes/origin/main').trim());
		expect(vg('symbolic-ref', '--short', 'HEAD').trim()).toBe('main');
		const exclude = readFileSync(join(vault, '.git', 'info', 'exclude'), 'utf8');
		expect(exclude).toContain('.obsidian/');
		expect(exclude).toContain('.trash/');
		expect(existsSync(join(vault, '.gitignore'))).toBe(false);
	});

	it('uses the default branch the project has, never assuming main', async () => {
		const other = createLocalRemote({ defaultBranch: 'master' });
		try {
			const result = await connectVault({ git: other.runner(), cwd: vault }, other.address);

			expect(result.ok).toBe(true);
			expect(vg('symbolic-ref', '--short', 'HEAD').trim()).toBe('master');
		} finally {
			other.dispose();
		}
	});

	// The fourth experiment, as a named test: a folder that already holds notes.
	describe('adopting a non-empty folder (experiment E4)', () => {
		beforeEach(() => {
			remote.publish('main', {
				'Docs/same.md': 'identical\r\n',
				'Docs/differs.md': 'the project\'s text\n',
				'Docs/project-only.md': 'only on the project\n',
				'img/shared.png': Buffer.from([0, 1, 2, 3, 255]),
			});
			mkdirSync(join(vault, 'Docs'), { recursive: true });
			mkdirSync(join(vault, 'img'), { recursive: true });
			writeFileSync(join(vault, 'Docs/same.md'), 'identical\r\n');
			writeFileSync(join(vault, 'Docs/differs.md'), 'the author\'s own text\n');
			writeFileSync(join(vault, 'Docs/vault-only.md'), 'only in the vault\n');
			writeFileSync(join(vault, 'img/shared.png'), Buffer.from([0, 1, 2, 3, 255]));
		});

		it('leaves every file byte-identical, including the one the project has nothing like', async () => {
			const before = checksums(vault);

			const result = await connectVault(ctx, remote.address);

			expect(result.ok).toBe(true);
			expect(checksums(vault)).toEqual(before);
			expect(existsSync(join(vault, 'Docs/project-only.md'))).toBe(false);
		});

		it('leaves each file in one of four relations to the project', async () => {
			await connectVault(ctx, remote.address);

			const status = vg('status', '--porcelain').split('\n').filter((line) => line !== '').sort();
			expect(status).toEqual([
				' D Docs/project-only.md',
				' D README.md',
				' M Docs/differs.md',
				'?? Docs/vault-only.md',
			]);
		});
	});

	it('says it is connected, and changes nothing, when it is connected already', async () => {
		await connectVault(ctx, remote.address);
		const before = repositoryState();

		const again = await connectVault(ctx, remote.address);

		expect(again).toEqual({ ok: true, message: SAME });
		expect(repositoryState()).toBe(before);
	});

	describe('when it cannot', () => {
		it('leaves no repository behind for a project with nothing in it', async () => {
			const empty = createLocalRemote({ empty: true });
			try {
				const result = await connectVault({ git: empty.runner(), cwd: vault }, empty.address);

				expect(result).toEqual({ ok: false, kind: 'failed', failure: 'empty-repository' });
				expect(existsSync(join(vault, '.git'))).toBe(false);
			} finally {
				empty.dispose();
			}
		});

		it('leaves no repository behind when the project cannot be reached at the start', async () => {
			rmSync(remote.bare, { recursive: true, force: true });

			const result = await connectVault(ctx, remote.address);

			expect(result.ok).toBe(false);
			expect(existsSync(join(vault, '.git'))).toBe(false);
		});

		it('takes back the repository it made when the fetch fails part-way', async () => {
			const failing: GitRunner = {
				run: async (request) =>
					request.args[0] === 'fetch'
						? { exitCode: 255, stdout: Buffer.alloc(0), stderr: 'ssh: Could not resolve hostname gitlab.example.com', timedOut: false, truncated: false, spawnError: null }
						: ctx.git.run(request),
			};
			writeFileSync(join(vault, 'mine.md'), 'mine');

			const result = await connectVault({ ...ctx, git: failing }, remote.address);

			expect(result).toEqual({ ok: false, kind: 'failed', failure: 'server-unreachable' });
			expect(existsSync(join(vault, '.git'))).toBe(false);
			expect(readFileSync(join(vault, 'mine.md'), 'utf8')).toBe('mine');
		});

		it('refuses a project that uses the other kind of object identifier, and changes nothing', async () => {
			let other: LocalRemote;
			try {
				other = createLocalRemote({ sha256: true });
			} catch {
				return; // This git cannot make one.
			}
			try {
				const result = await connectVault({ git: other.runner(), cwd: vault }, other.address);

				expect(result).toEqual({ ok: false, kind: 'failed', failure: 'unexpected' });
				expect(existsSync(join(vault, '.git'))).toBe(false);
			} finally {
				other.dispose();
			}
		});
	});
});

describe('adopting a vault that is already a repository', () => {
	/** A repository for this project with one commit that is the project's own first commit. */
	function adoptable(): string {
		vg('init', '-q');
		vg('symbolic-ref', 'HEAD', 'refs/heads/main');
		vg('remote', 'add', 'origin', remote.address.sshUrl);
		vg('fetch', '-q', remote.bare, '+refs/heads/*:refs/remotes/origin/*');
		vg('reset', '-q', '--mixed', 'refs/remotes/origin/main');
		return vg('rev-parse', 'HEAD').trim();
	}

	it('moves nothing — not HEAD, not the index, not a file — and records HEAD as the synced version', async () => {
		const head = adoptable();
		remote.publish('main', { 'Docs/new.md': 'newer on the project' });
		writeFileSync(join(vault, 'Docs-note.md'), 'mine');
		const before = { files: checksums(vault), index: vg('ls-files', '-s') };

		const result = await connectVault(ctx, remote.address);

		expect(result).toEqual({ ok: true, message: SAME });
		expect(vg('rev-parse', 'HEAD').trim()).toBe(head);
		expect(vg('ls-files', '-s')).toBe(before.index);
		expect(checksums(vault)).toEqual(before.files);
		// HEAD and not the new tip, so the project's newer notes arrive by an update.
		expect(await readRef(ctx, SYNCED_REF)).toEqual({ ok: true, value: head });
		expect(await readRef(ctx, CONNECTED_REF)).toEqual({ ok: true, value: head });
	});

	it('adopts a repository whose HEAD is the fetched tip', async () => {
		const head = adoptable();

		const result = await connectVault(ctx, remote.address);

		expect(result.ok).toBe(true);
		expect(await readRef(ctx, SYNCED_REF)).toEqual({ ok: true, value: head });
	});

	it('adopts a repository with no commits yet, recording the fetched tip and leaving HEAD unborn', async () => {
		vg('init', '-q');
		vg('symbolic-ref', 'HEAD', 'refs/heads/main');
		vg('remote', 'add', 'origin', remote.address.sshUrl);

		const result = await connectVault(ctx, remote.address);

		expect(result.ok).toBe(true);
		const tip = await readRef(ctx, fetchedDefaultRef('main'));
		expect(await readRef(ctx, SYNCED_REF)).toEqual(tip);
		expect(() => vg('rev-parse', '--verify', '--quiet', 'HEAD')).toThrow();
	});

	it('adds a missing ignore line without disturbing the ones there', async () => {
		adoptable();
		writeFileSync(join(vault, '.git', 'info', 'exclude'), '# mine\n.trash/\n');

		await connectVault(ctx, remote.address);

		const lines = readFileSync(join(vault, '.git', 'info', 'exclude'), 'utf8').split('\n').filter((l) => l !== '');
		expect(lines).toEqual(['# mine', '.trash/', '.obsidian/']);
	});

	const refusals: Array<[string, () => void, keyof typeof AUTHOR_MESSAGES]> = [
		[
			'a different project',
			() => {
				adoptableWith('git@elsewhere.example.com:other/project.git');
			},
			'foreignOrigin',
		],
		[
			'no origin at all',
			() => {
				vg('init', '-q');
				vg('symbolic-ref', 'HEAD', 'refs/heads/main');
			},
			'foreignOrigin',
		],
		[
			'another branch checked out',
			() => {
				adoptable();
				vg('checkout', '-q', '-b', 'feature');
			},
			'differentVersion',
		],
		[
			'a commit that was never sent',
			() => {
				adoptable();
				writeFileSync(join(vault, 'local.md'), 'unsent');
				vg('add', '-A');
				vg('commit', '-q', '-m', 'unsent');
			},
			'unsentChanges',
		],
	];
	function adoptableWith(origin: string): void {
		vg('init', '-q');
		vg('symbolic-ref', 'HEAD', 'refs/heads/main');
		vg('remote', 'add', 'origin', origin);
	}
	for (const [label, arrange, reason] of refusals) {
		it(`refuses ${label}, in the words that say what to do, and changes nothing`, async () => {
			arrange();
			const before = { state: repositoryState(), files: checksums(vault) };

			const result = await connectVault(ctx, remote.address);

			expect(result).toEqual({ ok: false, kind: 'refused', reason, message: AUTHOR_MESSAGES[reason] });
			expect(repositoryState()).toBe(before.state);
			expect(checksums(vault)).toEqual(before.files);
		});
	}

	it('refuses a vault that is a folder inside another repository, and changes nothing', async () => {
		const outer = mkdtempSync(join(tmpdir(), 'outer-'));
		try {
			execFileSync('git', ['init', '-q', outer]);
			const nested = join(outer, 'vault');
			mkdirSync(nested);
			writeFileSync(join(nested, 'note.md'), 'n');

			const result = await connectVault({ ...ctx, cwd: nested }, remote.address);

			expect(result).toEqual({ ok: false, kind: 'refused', reason: 'nestedVault', message: AUTHOR_MESSAGES.nestedVault });
			expect(existsSync(join(nested, '.git'))).toBe(false);
			expect(readdirSync(join(outer, '.git', 'refs'))).not.toContain('docs-publisher');
		} finally {
			rmSync(outer, { recursive: true, force: true });
		}
	});

	it('refuses a repository that uses the other kind of object identifier, and changes nothing', async () => {
		try {
			vg('init', '-q', '--object-format=sha256');
		} catch {
			return; // This git cannot make one.
		}
		vg('remote', 'add', 'origin', remote.address.sshUrl);
		const before = repositoryState();

		const result = await connectVault(ctx, remote.address);

		expect(result).toEqual({ ok: false, kind: 'failed', failure: 'unexpected' });
		expect(repositoryState()).toBe(before);
	});

	it('accepts the same project written in another form', async () => {
		adoptableWith('ssh://git@gitlab.example.com/docs/kb.git');
		vg('fetch', '-q', remote.bare, '+refs/heads/*:refs/remotes/origin/*');
		vg('reset', '-q', '--mixed', 'refs/remotes/origin/main');

		const result = await connectVault(ctx, remote.address);

		expect(result.ok).toBe(true);
	});
});
