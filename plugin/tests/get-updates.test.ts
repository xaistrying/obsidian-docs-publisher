import { sendDefaults } from './support/send-defaults';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTHOR_MESSAGES, AUTHOR_TEMPLATES } from '../src/author-messages';
import { planAndSend } from '../src/doc-authoring/submit-plan';
import type { GitRequest, GitRunner } from '../src/git-publishing/git-runner';
import { CONNECTED_REF, SYNCED_REF } from '../src/git-publishing/ref-names';
import { readRef } from '../src/git-publishing/repo';
import type { RepoContext } from '../src/git-publishing/repo';
import { getUpdates } from '../src/vault-sync/get-updates';
import type { Prompts, TwoVersions, UpdateDeps, UpdateResult } from '../src/vault-sync/get-updates';
import { connectVault } from '../src/vault-sync/connect';
import { connectReceived } from './support/connect-received';
import { fsVault } from './support/fs-vault';
import type { FsVault, FsVaultOptions } from './support/fs-vault';
import { createLocalRemote } from './support/local-remote';
import type { LocalRemote } from './support/local-remote';

let remote: LocalRemote;
let root: string;
let local: RepoContext;

beforeEach(() => {
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
	remote.dispose();
	rmSync(root, { recursive: true, force: true });
	vi.restoreAllMocks();
});

/** What the author answers, and what they were asked. */
interface Script {
	summary: boolean;
	two: TwoVersions[];
	removedThere: Array<'mine' | 'remove' | 'skip'>;
	removedHere: Array<'keep-removed' | 'get-back' | 'skip'>;
	asked: string[];
	/** Called at the moment a dialog is open, so a test can look at the vault then. */
	during?: () => void;
}

function script(over: Partial<Script> = {}): Script {
	return { summary: true, two: [], removedThere: [], removedHere: [], asked: [], ...over };
}

function prompts(s: Script): Prompts {
	return {
		confirmSummary: async (counts) => {
			s.asked.push(`summary ${counts.download}/${counts.update}/${counts.decide}`);
			return s.summary;
		},
		twoVersions: async (name) => {
			s.asked.push(`two ${name}`);
			s.during?.();
			return s.two.shift() ?? 'skip';
		},
		removedThere: async (name) => {
			s.asked.push(`removed-there ${name}`);
			return s.removedThere.shift() ?? 'skip';
		},
		removedHere: async (name) => {
			s.asked.push(`removed-here ${name}`);
			return s.removedHere.shift() ?? 'skip';
		},
	};
}

/**
 * A connected vault. `projectFiles` are on the project when connecting; `vaultFiles`
 * are in the vault beforehand, so connecting adopts a folder that already has notes.
 */
async function setUp(
	projectFiles: Record<string, string | Buffer> = {},
	vaultFiles: Record<string, string | Buffer> = {},
	options: FsVaultOptions = {},
	/** True to stop right after connecting, before anything has been received: the state the first update starts from. */
	firstUpdate = false
): Promise<FsVault> {
	remote = createLocalRemote();
	remote.setHook('pre-receive', 'true');
	if (Object.keys(projectFiles).length > 0) {
		remote.publish('main', projectFiles, 'earlier');
	}
	root = mkdtempSync(join(tmpdir(), 'vault-'));
	for (const path of Object.keys(vaultFiles)) {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), vaultFiles[path]);
	}
	local = { git: remote.runner(), cwd: root };
	if (firstUpdate) {
		await connectVault(local, remote.address);
	} else {
		await connectReceived(local, remote.address);
		// A vault that has received the project holds it. Without this the vault
		// would lack every file the project has, and each of them, being unchanged
		// since the last update, would come back as a file the author deleted.
		const held: Record<string, string | Buffer> = { 'README.md': 'Project\n', ...projectFiles };
		for (const path of Object.keys(held)) {
			if (!existsSync(join(root, path))) {
				mkdirSync(dirname(join(root, path)), { recursive: true });
				writeFileSync(join(root, path), held[path]);
			}
		}
	}
	return fsVault(root, options);
}

function deps(vault: FsVault, s: Script, over: Partial<UpdateDeps> = {}): UpdateDeps {
	return {
		local,
		network: local,
		address: remote.address,
		vault,
		prompts: prompts(s),
		now: () => new Date(2026, 9, 23, 14, 5, 9),
		...over,
	};
}

async function update(vault: FsVault, s: Script = script(), over: Partial<UpdateDeps> = {}): Promise<UpdateResult> {
	return getUpdates(deps(vault, s, over));
}

function done(result: UpdateResult): Extract<UpdateResult, { kind: 'done' }> {
	if (result.kind !== 'done') {
		throw new Error(`expected done, got ${JSON.stringify(result)}`);
	}
	return result;
}

const vg = (...args: string[]): string => remote.git(root, ...args);
const read = (path: string): string => readFileSync(join(root, path), 'utf8');
const trashCopy = (path: string): string[] => {
	const base = join(root, '.trash', 'Docs Publisher');
	return existsSync(base) ? readdirSync(base).map((stamp) => readFileSync(join(base, stamp, path), 'utf8')) : [];
};
const para = (n: number, tag = ''): string => `paragraph ${n}${tag}\n`;
const doc = (...p: string[]): string => p.join('\n');
const PARAGRAPHS = [1, 2, 3, 4, 5].map((n) => para(n));
const BASE = doc(...PARAGRAPHS);

function checksums(dir: string, prefix = ''): Record<string, string> {
	const sums: Record<string, string> = {};
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (prefix === '' && entry.name.startsWith('.')) {
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

describe('getting updates, one direction, for the whole project', () => {
	it('writes new documents and images where the project has them, with the folders they need', async () => {
		const vault = await setUp({ 'README.md': 'readme', 'Docs/Hướng dẫn/Mạng.md': 'a', 'img/p.png': Buffer.from([0, 255, 1]) });
		remote.publish('main', { 'Docs/New.md': 'new', 'img/q.png': Buffer.from([9, 8]) });

		const result = done(await update(vault));

		expect(result).toMatchObject({ added: 2, updated: 0, removed: 0, skipped: [] });
		expect(read('Docs/New.md')).toBe('new');
		expect(readFileSync(join(root, 'img/q.png')).equals(Buffer.from([9, 8]))).toBe(true);
		expect(result.messages).toEqual([AUTHOR_TEMPLATES.gotUpdates(2, 0, 0)]);
	});

	it('brings a README with no front matter like any other file', async () => {
		const vault = await setUp({ 'Docs/a.md': 'a' });
		remote.publish('main', { 'Docs/README.md': '# Project, no front matter\n' });

		done(await update(vault));

		expect(read('Docs/README.md')).toBe('# Project, no front matter\n');
	});

	it('says what it did when it adds, changes and removes', async () => {
		const vault = await setUp({ 'a.md': '1', 'b.md': '1', 'c.md': '1' }, { 'a.md': '1', 'b.md': '1', 'c.md': '1' });
		const clone = join(remote.root, 'clone');
		remote.git(remote.root, 'clone', '-q', remote.bare, clone);
		writeFileSync(join(clone, 'b.md'), '2');
		writeFileSync(join(clone, 'd.md'), 'd');
		writeFileSync(join(clone, 'e.md'), 'e');
		remote.git(clone, 'rm', '-q', 'c.md');
		remote.git(clone, 'add', '-A');
		remote.git(clone, 'commit', '-q', '-m', 'change');
		remote.git(clone, 'push', '-q', 'origin', 'main');

		const result = done(await update(vault));

		expect(result).toMatchObject({ added: 2, updated: 1, removed: 1 });
		expect(result.messages[0]).toBe('Got the latest documents: 2 added, 1 updated, 1 removed.');
	});

	it('says there is nothing to get, and changes nothing, when the project has not changed', async () => {
		const vault = await setUp({ 'a.md': 'a' }, { 'a.md': 'a' });
		done(await update(vault));
		vault.writes.length = 0;

		const result = done(await update(vault));

		expect(result.messages).toEqual([AUTHOR_MESSAGES.alreadyLatest]);
		expect(vault.writes).toEqual([]);
	});

	it('sends nothing to the project', async () => {
		const vault = await setUp({ 'a.md': 'a' });
		remote.publish('main', { 'b.md': 'b' });
		const before = remote.git(remote.bare, 'for-each-ref', '--format=%(refname) %(objectname)');

		done(await update(vault));

		expect(remote.git(remote.bare, 'for-each-ref', '--format=%(refname) %(objectname)')).toBe(before);
	});

	it('never writes the settings folder, whatever the project holds', async () => {
		const vault = await setUp({ 'a.md': 'a' });
		remote.publish('main', { '.obsidian/app.json': '{"theirs":true}', 'b.md': 'b' });

		done(await update(vault));

		expect(existsSync(join(root, '.obsidian'))).toBe(false);
		expect(vault.writes).toEqual(['b.md']);
	});

	it('neither counts, asks about nor downloads a hidden folder another tool put on the project', async () => {
		const vault = await setUp({ 'a.md': 'a' });
		remote.publish('main', { '.claudian/settings.json': '{}', 'b.md': 'b' });

		const result = done(await update(vault));

		expect(result.added).toBe(1);
		expect(result.skipped).toEqual([]);
		expect(existsSync(join(root, '.claudian'))).toBe(false);
	});

	it('refuses to write a path from the project that could leave the vault, and carries on with the rest', async () => {
		const vault = await setUp({ 'a.md': 'a' });
		remote.publish('main', { 'back\\slash.md': 'x', 'b.md': 'b' });

		const result = done(await update(vault));

		expect(result.skipped).toEqual(['back\\slash.md']);
		expect(vault.writes).toEqual(['b.md']);
	});
});

describe('the first update after connecting', () => {
	it('shows a summary and waits; cancelling writes nothing and leaves the updates waiting', async () => {
		const vault = await setUp({ 'a.md': 'a' }, {}, {}, true);
		remote.publish('main', { 'b.md': 'b', 'c.md': 'c' });
		const s = script({ summary: false });
		const synced = await readRef(local, SYNCED_REF);

		const result = await update(vault, s);

		expect(result).toEqual({ kind: 'cancelled' });
		// The project's first file, README.md, is downloaded too.
		expect(s.asked).toEqual(['summary 4/0/0']);
		expect(vault.writes).toEqual([]);
		expect(await readRef(local, SYNCED_REF)).toEqual(synced);
	});

	it('counts what it would download, update and need a decision about', async () => {
		// Nothing has been received yet, so a path both sides have with different
		// text is one both added, and is asked about; one that is the same is not.
		const vault = await setUp({ 'a.md': 'a', 'u.md': '1', 'd.md': 'theirs' }, { 'a.md': 'a', 'u.md': '1', 'd.md': 'mine' }, {}, true);
		remote.publish('main', { 'n.md': 'new', 'u.md': '2', 'd.md': 'theirs, changed' });
		const s = script({ two: ['skip', 'skip'] });

		await update(vault, s);

		// Downloads: README.md and n.md. To decide: u.md and d.md.
		expect(s.asked[0]).toBe('summary 2/0/2');
	});

	it('applies on confirming, and does not ask again for the next update', async () => {
		const vault = await setUp({ 'a.md': 'a' }, {}, {}, true);
		remote.publish('main', { 'b.md': 'b' });
		const first = script();
		done(await update(vault, first));
		remote.publish('main', { 'c.md': 'c' });
		const second = script();

		done(await update(vault, second));

		expect(first.asked).toEqual(['summary 3/0/0']);
		expect(second.asked).toEqual([]);
		expect(read('c.md')).toBe('c');
	});

	it('does not ask when there is nothing to change', async () => {
		const vault = await setUp({ 'a.md': 'a' }, { 'a.md': 'a', 'README.md': 'Project\n' }, {}, true);
		const s = script();

		done(await update(vault, s));

		expect(s.asked).toEqual([]);
	});
});

describe('the third experiment: a note already equal to the merged text', () => {
	// What plain `git merge --ff-only` does here is to refuse ("local changes would
	// be overwritten"), so every published document would hit it. This is not asserted.
	it('succeeds, writes nothing, and advances the synced version and HEAD', async () => {
		const vault = await setUp({ 'Docs/Printer.md': 'v1\n' }, { 'Docs/Printer.md': 'v1\n' });
		// A reviewer merges the author's own revision; the vault copy is already that text.
		remote.publish('main', { 'Docs/Printer.md': 'v2, merged\n' });
		writeFileSync(join(root, 'Docs/Printer.md'), 'v2, merged\n');
		const before = checksums(root);

		const result = done(await update(vault));

		expect(vault.writes).toEqual([]);
		expect(checksums(root)).toEqual(before);
		const tip = vg('rev-parse', 'refs/remotes/origin/main').trim();
		expect(vg('rev-parse', 'HEAD').trim()).toBe(tip);
		expect(vg('rev-parse', `${SYNCED_REF}^{tree}`)).toBe(vg('rev-parse', `${tip}^{tree}`));
		expect(result.skipped).toEqual([]);
	});
});

describe('each row of the table, end to end', () => {
	it('row 3: takes the project\'s version of a note that has not been changed', async () => {
		const vault = await setUp({ 'a.md': 'v1' }, { 'a.md': 'v1' });
		remote.publish('main', { 'a.md': 'v2' });

		done(await update(vault));

		expect(read('a.md')).toBe('v2');
	});

	it('row 3: moves a note the project removed, which the author did not change, to the vault\'s own trash', async () => {
		const vault = await setUp({ 'a.md': 'v1', 'keep.md': 'k' }, { 'a.md': 'v1', 'keep.md': 'k' });
		const clone = join(remote.root, 'rm');
		remote.git(remote.root, 'clone', '-q', remote.bare, clone);
		remote.git(clone, 'rm', '-q', 'a.md');
		remote.git(clone, 'commit', '-q', '-m', 'rm');
		remote.git(clone, 'push', '-q', 'origin', 'main');

		const result = done(await update(vault));

		expect(vault.trashed).toEqual(['a.md']);
		expect(existsSync(join(root, 'a.md'))).toBe(false);
		expect(result.removed).toBe(1);
	});

	it('row 3: follows a reorganisation, the note leaving its old folder and arriving in the new one', async () => {
		const vault = await setUp({ 'Old/a.md': 'text' }, { 'Old/a.md': 'text' });
		const clone = join(remote.root, 'mv');
		remote.git(remote.root, 'clone', '-q', remote.bare, clone);
		mkdirSync(join(clone, 'New'));
		remote.git(clone, 'mv', 'Old/a.md', 'New/a.md');
		remote.git(clone, 'commit', '-q', '-m', 'move');
		remote.git(clone, 'push', '-q', 'origin', 'main');

		done(await update(vault));

		expect(existsSync(join(root, 'Old/a.md'))).toBe(false);
		expect(read('New/a.md')).toBe('text');
	});

	it('row 2: leaves the author\'s further edits to a revision that was merged unchanged, and does not ask', async () => {
		const vault = await setUp({ 'Docs/Printer.md': 'v1\n' }, { 'Docs/Printer.md': 'v1\n' });
		const ctx = { local, network: local, address: remote.address, identity: { name: 'Ana', email: 'ana@example.com' } };
		const sent = await planAndSend(ctx, {
			notePath: 'Docs/Printer.md',
			basename: 'Printer',
			noteText: 'v1, my revision\n',
			existingDocId: 'Printer',
			fields: null,
			title: 'Printer',
			attachments: [],
			...sendDefaults('Docs/Printer.md'),
		});
		expect(sent.kind).toBe('sent');
		remote.publish('main', { 'Docs/Printer.md': 'v1, my revision\n' }, 'merge');
		writeFileSync(join(root, 'Docs/Printer.md'), 'v1, my revision, edited again\n');
		const s = script();

		done(await update(vault, s));

		expect(read('Docs/Printer.md')).toBe('v1, my revision, edited again\n');
		expect(s.asked).toEqual([]);
		expect(vault.writes).toEqual([]);
	});

	describe('row 4: the author removed a note the project then changed', () => {
		it('keeps it removed for that update, and does not ask again', async () => {
			const vault = await setUp({ 'a.md': 'v1' }, { 'a.md': 'v1' });
			rmSync(join(root, 'a.md'));
			remote.publish('main', { 'a.md': 'v2' });
			const s = script({ removedHere: ['keep-removed'] });

			done(await update(vault, s));

			expect(s.asked).toEqual(['removed-here a']);
			expect(existsSync(join(root, 'a.md'))).toBe(false);
		});

		it('brings it back on the next update, because a note the project has and the vault lacks is an update', async () => {
			const vault = await setUp({ 'a.md': 'v1' }, { 'a.md': 'v1' });
			rmSync(join(root, 'a.md'));
			remote.publish('main', { 'a.md': 'v2' });
			const s = script({ removedHere: ['keep-removed'] });
			done(await update(vault, s));

			const result = done(await update(vault, s));

			expect(s.asked).toEqual(['removed-here a']);
			expect(result.added).toBe(1);
			expect(read('a.md')).toBe('v2');
		});

		it('does not bring back a note the author moved, whose bytes sit elsewhere in the vault', async () => {
			const vault = await setUp({ 'Docs/a.md': 'v1' }, { 'Docs/a.md': 'v1' });
			mkdirSync(join(root, 'Archive'), { recursive: true });
			renameSync(join(root, 'Docs/a.md'), join(root, 'Archive/a.md'));

			const result = done(await update(vault));

			expect(result.added).toBe(0);
			expect(existsSync(join(root, 'Docs/a.md'))).toBe(false);
			expect(read('Archive/a.md')).toBe('v1');
		});

		it('brings back the original of a note that was moved and edited, which cannot be told from a deletion', async () => {
			const vault = await setUp({ 'Docs/a.md': 'v1' }, { 'Docs/a.md': 'v1' });
			mkdirSync(join(root, 'Archive'), { recursive: true });
			renameSync(join(root, 'Docs/a.md'), join(root, 'Archive/a.md'));
			writeFileSync(join(root, 'Archive/a.md'), 'v1, edited');

			const result = done(await update(vault));

			expect(result.added).toBe(1);
			expect(read('Docs/a.md')).toBe('v1');
		});

		it('brings back a note the author deleted that the project has not changed since', async () => {
			const vault = await setUp({ 'a.md': 'v1' }, { 'a.md': 'v1' });
			rmSync(join(root, 'a.md'));
			const s = script();

			const result = done(await update(vault, s));

			expect(s.asked).toEqual([]);
			expect(result.added).toBe(1);
			expect(read('a.md')).toBe('v1');
		});

		it('gets it back when asked to', async () => {
			const vault = await setUp({ 'a.md': 'v1' }, { 'a.md': 'v1' });
			rmSync(join(root, 'a.md'));
			remote.publish('main', { 'a.md': 'v2' });

			const result = done(await update(vault, script({ removedHere: ['get-back'] })));

			expect(read('a.md')).toBe('v2');
			expect(result.added).toBe(1);
		});
	});

	describe('row 5: the author changed a note the project removed', () => {
		async function arrange(): Promise<FsVault> {
			const vault = await setUp({ 'a.md': 'v1', 'keep.md': 'k' }, { 'a.md': 'v1', 'keep.md': 'k' });
			writeFileSync(join(root, 'a.md'), 'v1, edited by the author');
			const clone = join(remote.root, 'rm5');
			remote.git(remote.root, 'clone', '-q', remote.bare, clone);
			remote.git(clone, 'rm', '-q', 'a.md');
			remote.git(clone, 'commit', '-q', '-m', 'rm');
			remote.git(clone, 'push', '-q', 'origin', 'main');
			return vault;
		}

		it('keeps the note when asked to', async () => {
			const vault = await arrange();

			done(await update(vault, script({ removedThere: ['mine'] })));

			expect(read('a.md')).toBe('v1, edited by the author');
		});

		it('removes it when asked to, with the author\'s text preserved in the plugin\'s own trash', async () => {
			const vault = await arrange();

			done(await update(vault, script({ removedThere: ['remove'] })));

			expect(existsSync(join(root, 'a.md'))).toBe(false);
			expect(trashCopy('a.md')).toEqual(['v1, edited by the author']);
			expect(vault.copies[0].stamp).toBe('2026-10-23_14-05-09');
		});
	});

	describe('row 6: both added the same path with different content', () => {
		async function arrange(): Promise<FsVault> {
			const vault = await setUp({ 'seed.md': 's' }, { 'seed.md': 's', 'Docs/Same.md': 'the author\'s own' });
			remote.publish('main', { 'Docs/Same.md': 'the project\'s' });
			return vault;
		}

		it('keeps the author\'s when asked to, and then reads it as the author\'s own change', async () => {
			const vault = await arrange();
			const s = script({ two: ['mine'] });

			done(await update(vault, s));
			done(await update(vault, s));

			expect(read('Docs/Same.md')).toBe('the author\'s own');
			expect(s.asked.filter((a) => a.indexOf('two') === 0)).toEqual(['two Same']);
		});

		it('uses the project\'s when asked to, with the author\'s text preserved first', async () => {
			const vault = await arrange();

			done(await update(vault, script({ two: ['theirs'] })));

			expect(read('Docs/Same.md')).toBe('the project\'s');
			expect(trashCopy('Docs/Same.md')).toEqual(['the author\'s own']);
		});

		it('keeps both when asked to: the note unchanged and the project\'s beside it', async () => {
			const vault = await arrange();

			done(await update(vault, script({ two: ['both'] })));

			expect(read('Docs/Same.md')).toBe('the author\'s own');
			expect(read('Docs/Same (from GitLab).md')).toBe('the project\'s');
		});

		it('numbers the copy when the name is taken, and leaves the earlier copy alone', async () => {
			const vault = await arrange();
			writeFileSync(join(root, 'Docs/Same (from GitLab).md'), 'an earlier copy');

			done(await update(vault, script({ two: ['both'] })));

			expect(read('Docs/Same (from GitLab).md')).toBe('an earlier copy');
			expect(read('Docs/Same (from GitLab 2).md')).toBe('the project\'s');
		});

		it('holds the path back when the dialog is dismissed, and asks again next time', async () => {
			const vault = await arrange();
			const s = script({ two: ['skip', 'mine'] });

			const first = done(await update(vault, s));
			done(await update(vault, s));

			expect(first.skipped).toEqual(['Docs/Same.md']);
			expect(s.asked.filter((a) => a.indexOf('two') === 0)).toHaveLength(2);
		});
	});

	describe('row 7: all three present and different', () => {
		const mine = doc(para(1, ' (mine)'), ...PARAGRAPHS.slice(1));
		const theirs = doc(...PARAGRAPHS.slice(0, 4), para(5, ' (theirs)'));

		it('merges edits to different paragraphs, says so, and keeps the pre-merge text in the plugin\'s trash', async () => {
			const vault = await setUp({ 'Docs/a.md': BASE }, { 'Docs/a.md': BASE });
			writeFileSync(join(root, 'Docs/a.md'), mine);
			remote.publish('main', { 'Docs/a.md': theirs });

			const result = done(await update(vault));

			expect(read('Docs/a.md')).toBe(doc(para(1, ' (mine)'), ...PARAGRAPHS.slice(1, 4), para(5, ' (theirs)')));
			expect(result.messages).toContain(AUTHOR_TEMPLATES.merged('a'));
			expect(trashCopy('Docs/a.md')).toEqual([mine]);
		});

		it('asks when the edits overlap, and the note holds no marker meanwhile', async () => {
			const vault = await setUp({ 'Docs/a.md': BASE }, { 'Docs/a.md': BASE });
			const overlapping = BASE.replace(para(3), para(3, ' (mine)'));
			writeFileSync(join(root, 'Docs/a.md'), overlapping);
			remote.publish('main', { 'Docs/a.md': BASE.replace(para(3), para(3, ' (theirs)')) });
			const seen: string[] = [];
			const s = script({ two: ['mine'], during: () => seen.push(read('Docs/a.md')) });

			done(await update(vault, s));

			expect(seen).toEqual([overlapping]);
			expect(seen[0]).not.toMatch(/<<<<<<<|>>>>>>>|=======/);
			expect(read('Docs/a.md')).toBe(overlapping);
		});

		it('writes nothing when the copy of the author\'s text cannot be made, and says the file was skipped', async () => {
			const vault = await setUp({ 'Docs/a.md': BASE }, { 'Docs/a.md': BASE }, { failCopy: true });
			writeFileSync(join(root, 'Docs/a.md'), mine);
			remote.publish('main', { 'Docs/a.md': theirs });

			const result = done(await update(vault));

			expect(read('Docs/a.md')).toBe(mine);
			expect(result.skipped).toEqual(['Docs/a.md']);
			expect(result.messages).toContain(AUTHOR_TEMPLATES.skippedPath('Docs/a.md'));
		});
	});

	it('row 8: asks, and attempts no merge, when an image changed on both sides', async () => {
		const vault = await setUp({ 'img/p.png': Buffer.from([0, 1]) }, { 'img/p.png': Buffer.from([0, 1]) });
		writeFileSync(join(root, 'img/p.png'), Buffer.from([0, 2]));
		remote.publish('main', { 'img/p.png': Buffer.from([0, 3]) });
		const s = script({ two: ['theirs'] });

		done(await update(vault, s));

		expect(s.asked.filter((a) => a.indexOf('two') === 0)).toEqual(['two p']);
		expect(readFileSync(join(root, 'img/p.png')).equals(Buffer.from([0, 3]))).toBe(true);
	});
});

describe('a file that cannot be applied', () => {
	it('is skipped with the rest updated, said by name, and applied by the next update which asks about nothing else', async () => {
		const refuse = { current: true };
		const vault = await setUp({ 'a.md': 'a' }, {}, { refuseWrite: (path) => refuse.current && path === 'Docs/Bad.md' });
		remote.publish('main', { 'Docs/Bad.md': 'bad', 'Docs/Good.md': 'good' });

		const first = done(await update(vault));

		expect(first.skipped).toEqual(['Docs/Bad.md']);
		expect(first.messages).toContain(AUTHOR_TEMPLATES.skippedPath('Docs/Bad.md'));
		expect(read('Docs/Good.md')).toBe('good');

		refuse.current = false;
		const s = script();
		const second = done(await update(vault, s));

		expect(read('Docs/Bad.md')).toBe('bad');
		expect(second.added).toBe(1);
		expect(s.asked).toEqual([]);
	});

	it('is still pending when the author publishes in between, so the stale guard refuses', async () => {
		const vault = await setUp({ 'Docs/Printer.md': 'v1\n' }, { 'Docs/Printer.md': 'v1\n' }, { refuseWrite: () => true });
		remote.publish('main', { 'Docs/Printer.md': 'v2 by a reviewer\n' });
		done(await update(vault));

		const sent = await planAndSend(
			{ local, network: local, address: remote.address, identity: { name: 'Ana', email: 'ana@example.com' } },
			{
				notePath: 'Docs/Printer.md',
				basename: 'Printer',
				noteText: 'v1, edited by me\n',
				existingDocId: 'Printer',
				fields: null,
				title: 'Printer',
				attachments: [],
				...sendDefaults('Docs/Printer.md'),
			}
		);

		expect(sent).toEqual({ kind: 'refused', message: AUTHOR_MESSAGES.changedSinceUpdates });
	});

	it('leaves a note with unsaved changes as it is, says so, and gets it next time', async () => {
		const unsaved = new Set(['a.md']);
		const vault = await setUp({ 'a.md': 'v1' }, { 'a.md': 'v1' }, { unsaved });
		remote.publish('main', { 'a.md': 'v2', 'b.md': 'b' });

		const first = done(await update(vault));

		expect(read('a.md')).toBe('v1');
		expect(first.skipped).toEqual(['a.md']);
		expect(first.messages).toContain(AUTHOR_TEMPLATES.unsavedNote('a'));
		expect(read('b.md')).toBe('b');

		unsaved.clear();
		done(await update(vault));
		expect(read('a.md')).toBe('v2');
	});
});

describe('names that differ only in case', () => {
	it('asks, rather than let one replace the other, on a file system that sees them as one', async () => {
		const vault = await setUp({ 'seed.md': 's' }, { 'seed.md': 's', 'Docs/a.md': 'the author\'s' }, { caseInsensitive: true });
		remote.publish('main', { 'docs/A.md': 'the project\'s' });
		const s = script({ two: ['mine'] });

		done(await update(vault, s));

		expect(s.asked.filter((a) => a.indexOf('two') === 0)).toHaveLength(1);
		expect(read('Docs/a.md')).toBe('the author\'s');
		expect(vault.writes).toEqual([]);
	});

	it('treats them as two files on a case-sensitive one', async () => {
		const vault = await setUp({ 'seed.md': 's' }, { 'seed.md': 's', 'Docs/a.md': 'the author\'s' });
		remote.publish('main', { 'docs/A.md': 'the project\'s' });
		const s = script();

		done(await update(vault, s));

		expect(s.asked).toEqual([]);
		expect(read('docs/A.md')).toBe('the project\'s');
		expect(read('Docs/a.md')).toBe('the author\'s');
	});
});

describe('when the update cannot be made', () => {
	it('changes nothing and says it failed when the project cannot be reached', async () => {
		const vault = await setUp({ 'a.md': 'a' });
		const synced = await readRef(local, SYNCED_REF);
		const connected = await readRef(local, CONNECTED_REF);
		const unreachable: GitRunner = {
			run: async (request: GitRequest) =>
				request.args[0] === 'fetch'
					? { exitCode: 255, stdout: Buffer.alloc(0), stderr: 'ssh: Could not resolve hostname gitlab.example.com', timedOut: false, truncated: false, spawnError: null }
					: local.git.run(request),
		};

		const result = await update(vault, script(), { network: { ...local, git: unreachable } });

		expect(result).toEqual({ kind: 'failed', failure: 'server-unreachable' });
		expect(vault.writes).toEqual([]);
		expect(await readRef(local, SYNCED_REF)).toEqual(synced);
		expect(await readRef(local, CONNECTED_REF)).toEqual(connected);
	});

	it('reports a key the server no longer accepts as that', async () => {
		const vault = await setUp({ 'a.md': 'a' });
		const refusing: GitRunner = {
			run: async (request: GitRequest) =>
				request.args[0] === 'fetch'
					? { exitCode: 128, stdout: Buffer.alloc(0), stderr: 'git@h: Permission denied (publickey).', timedOut: false, truncated: false, spawnError: null }
					: local.git.run(request),
		};

		expect(await update(vault, script(), { network: { ...local, git: refusing } })).toEqual({ kind: 'failed', failure: 'key-rejected' });
	});
});
