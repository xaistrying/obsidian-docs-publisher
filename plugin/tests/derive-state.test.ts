import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { blobId } from '../src/git-publishing/blob-id';
import type { GitRequest, GitRunner } from '../src/git-publishing/git-runner';
import { fetchedDefaultRef } from '../src/git-publishing/ref-names';
import { advanceSynced, fetchProject, readRef, writeSent } from '../src/git-publishing/repo';
import type { RepoContext } from '../src/git-publishing/repo';
import { deriveStates, isEdited, panelSectionFor } from '../src/submission-tracking/derive-state';
import type { DerivedStates } from '../src/submission-tracking/derive-state';
import { connectReceived } from './support/connect-received';
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

/** Fetches, then derives, the way a refresh does. */
async function derive(...ids: string[]): Promise<DerivedStates> {
	await fetchProject(ctx, remote.address);
	const states = await deriveStates(ctx, ids);
	if (!states.ok || states.value === null) {
		throw new Error('nothing derived');
	}
	return states.value;
}

const connect = async (): Promise<void> => {
	await connectReceived(ctx, remote.address);
};

const stateOf = (states: DerivedStates, id: string) => states.documents.get(id)?.state;

describe('a document with a review that is still open', () => {
	it('is pending, with the path of the one document the branch changed', async () => {
		await connect();
		remote.publish('doc/Printer', { 'Docs/Printer.md': 'text' });

		const states = await derive('Printer');

		expect(stateOf(states, 'Printer')).toBe('pending');
		expect(states.documents.get('Printer')?.remotePath).toBe('Docs/Printer.md');
	});

	it('is pending when the branch carries the note and its images', async () => {
		await connect();
		remote.publish('doc/Printer', { 'Docs/Printer.md': 'text', 'img/a.png': Buffer.from([1]), 'img/b.png': Buffer.from([2]) });

		const states = await derive('Printer');

		expect(stateOf(states, 'Printer')).toBe('pending');
		expect(states.documents.get('Printer')?.remotePath).toBe('Docs/Printer.md');
	});

	it('is pending for a revision that changes only an image, and its path comes from the project', async () => {
		remote.publish('main', { 'Docs/Printer.md': 'text', 'img/a.png': Buffer.from([1]) });
		await connect();
		remote.publish('doc/Printer', { 'img/a.png': Buffer.from([2]) });

		const states = await derive('Printer');

		expect(stateOf(states, 'Printer')).toBe('pending');
		expect(states.documents.get('Printer')?.remotePath).toBe('Docs/Printer.md');
	});

	it('is pending for a revision of a published document', async () => {
		remote.publish('main', { 'Docs/Printer.md': 'v1' });
		await connect();
		remote.publish('doc/Printer', { 'Docs/Printer.md': 'v2' });

		expect(stateOf(await derive('Printer'), 'Printer')).toBe('pending');
	});

	it('is still pending when a review was closed without merging and its branch left, an accepted limit', async () => {
		await connect();
		remote.publish('doc/Printer', { 'Docs/Printer.md': 'never merged' });

		expect(stateOf(await derive('Printer'), 'Printer')).toBe('pending');
	});
});

describe('a document whose review is over', () => {
	it('is published when the branch was left behind after a merge', async () => {
		await connect();
		remote.publish('doc/Printer', { 'Docs/Printer.md': 'text' });
		remote.publish('main', { 'Docs/Printer.md': 'text' }, 'merge');

		expect(stateOf(await derive('Printer'), 'Printer')).toBe('published');
	});

	it('is published when it was squash-merged and the branch was left behind', async () => {
		await connect();
		remote.publish('doc/Printer', { 'Docs/Printer.md': 'text', 'img/a.png': Buffer.from([1]) });
		// The squash: the same files in one new commit that is not a descendant of the branch.
		remote.publish('main', { 'Docs/Printer.md': 'text', 'img/a.png': Buffer.from([1]) }, 'squash');

		expect(stateOf(await derive('Printer'), 'Printer')).toBe('published');
	});

	it('is published when the branch was removed and the project holds the document', async () => {
		remote.publish('main', { 'Docs/Printer.md': 'text' });
		await connect();

		expect(stateOf(await derive('Printer'), 'Printer')).toBe('published');
	});

	it('is closed when the branch is gone and the project has no file by that name', async () => {
		await connect();

		const states = await derive('Printer');

		expect(stateOf(states, 'Printer')).toBe('closed');
		expect(states.documents.get('Printer')?.remotePath).toBeNull();
	});

	it('stays published when a second cycle was not accepted and its branch removed', async () => {
		remote.publish('main', { 'Docs/Printer.md': 'v1' });
		await connect();

		expect(stateOf(await derive('Printer'), 'Printer')).toBe('published');
	});

	it('has no path, and is closed, when two files on the project derive the same identity', async () => {
		remote.publish('main', { 'Docs/Printer.md': 'a', 'Archive/Printer.md': 'b' });
		await connect();

		const states = await derive('Printer');

		expect(states.documents.get('Printer')?.remotePath).toBeNull();
		expect(stateOf(states, 'Printer')).toBe('closed');
	});

	it('finds a document by identity whatever folder it is in, and with accents folded in its name', async () => {
		remote.publish('main', { 'Hướng dẫn/Mạng.md': 'a' });
		await connect();

		const states = await derive('Mang');

		expect(states.documents.get('Mang')?.remotePath).toBe('Hướng dẫn/Mạng.md');
		expect(stateOf(states, 'Mang')).toBe('published');
	});
});

describe('before there is anything to derive from', () => {
	it('gives no states, and no failure, when no fetch has completed', async () => {
		await connect();
		// Take the fetched copy away, as if connecting had never fetched.
		remote.git(vault, 'update-ref', '-d', fetchedDefaultRef('main'));

		expect(await deriveStates(ctx, ['Printer'])).toEqual({ ok: true, value: null });
	});

	it('gives no states in a vault with no repository', async () => {
		const states = await deriveStates(ctx, ['Printer']);

		expect(states.ok && states.value).toBeNull();
	});

	it('lists only the documents the project holds for a vault that names none', async () => {
		await connect();

		const states = await derive();

		// The project's one file, README.md, is a document by its path; nothing else is.
		expect(Array.from(states.documents.keys())).toEqual(['README']);
	});
});

describe('deriving many documents at once', () => {
	it('starts no connection of its own, however many documents there are', async () => {
		remote.publish('main', { 'Docs/Doc0.md': 'a' });
		await connect();
		await fetchProject(ctx, remote.address);
		const seen: string[] = [];
		const watching: GitRunner = {
			run: (request: GitRequest) => {
				seen.push(request.args[0]);
				return ctx.git.run(request);
			},
		};
		const ids = Array.from({ length: 20 }, (_v, i) => `Doc${i}`);

		const states = await deriveStates({ ...ctx, git: watching }, ids);

		// The twenty named, and the project's own README.
		expect(states.ok && states.value?.documents.size).toBe(21);
		expect(seen.filter((name) => name === 'fetch' || name === 'ls-remote' || name === 'push')).toEqual([]);
	});

	it('gives nothing when one document cannot be read, rather than states from part of the data', async () => {
		remote.publish('main', { 'Docs/Printer.md': 'a' });
		await connect();
		await fetchProject(ctx, remote.address);
		const broken: GitRunner = {
			run: async (request) =>
				request.args[0] === 'for-each-ref' && request.args.some((a) => a.indexOf('origin/doc') !== -1)
					? { exitCode: 128, stdout: Buffer.alloc(0), stderr: 'fatal: broken', timedOut: false, truncated: false, spawnError: null }
					: ctx.git.run(request),
		};

		expect((await deriveStates({ ...ctx, git: broken }, ['Printer'])).ok).toBe(false);
	});
});

describe('how many updates are waiting', () => {
	it('is none right after connecting', async () => {
		await connect();

		expect((await derive()).updatesAvailable).toBe(0);
	});

	it('counts a file added, one changed and one removed on the project since the last sync', async () => {
		remote.publish('main', { 'a.md': 'a', 'b.md': 'b' });
		await connect();
		remote.publish('main', { 'a.md': 'a2', 'c.md': 'c' });
		await fetchProject(ctx, remote.address);
		const tip = await readRef(ctx, fetchedDefaultRef('main'));
		expect(tip.ok && tip.value).toBeTruthy();
		// b.md is removed on the project.
		const clone = join(remote.root, 'rm');
		remote.git(remote.root, 'clone', '-q', remote.bare, clone);
		remote.git(clone, 'rm', '-q', 'b.md');
		remote.git(clone, 'commit', '-q', '-m', 'remove b');
		remote.git(clone, 'push', '-q', 'origin', 'main');

		const states = await derive();

		expect(states.updatesAvailable).toBe(3);
	});

	it('does not count files in the settings folder', async () => {
		await connect();
		remote.publish('main', { '.obsidian/app.json': '{}' });

		expect((await derive()).updatesAvailable).toBe(0);
	});
});

describe('whether a note has been edited since it was last sent', () => {
	const note = (text: string): string => blobId(Buffer.from(text));

	it('is not edited when it equals the version last synced, even after others changed the project', async () => {
		remote.publish('main', { 'Docs/Printer.md': 'v1' });
		await connect();
		remote.publish('main', { 'Docs/Printer.md': 'v2 by someone else' });

		const states = await derive('Printer');

		expect(isEdited(states.documents.get('Printer'), note('v1'))).toBe(false);
	});

	it('is not edited when it equals the project\'s current version', async () => {
		remote.publish('main', { 'Docs/Printer.md': 'v1' });
		await connect();
		remote.publish('main', { 'Docs/Printer.md': 'v2' });

		expect(isEdited((await derive('Printer')).documents.get('Printer'), note('v2'))).toBe(false);
	});

	it('is not edited when it equals what this vault last sent, though the project has moved on', async () => {
		remote.publish('main', { 'Docs/Printer.md': 'v1' });
		await connect();
		const sent = remote.publish('doc/Printer', { 'Docs/Printer.md': 'what I sent' });
		await fetchProject(ctx, remote.address);
		await writeSent(ctx, 'Printer', sent);
		remote.deleteBranch('doc/Printer');
		remote.publish('main', { 'Docs/Printer.md': 'merged and then changed' });

		const states = await derive('Printer');

		expect(isEdited(states.documents.get('Printer'), note('what I sent'))).toBe(false);
	});

	it('is not edited when it equals the version on its own branch', async () => {
		remote.publish('main', { 'Docs/Printer.md': 'v1' });
		await connect();
		remote.publish('doc/Printer', { 'Docs/Printer.md': 'under review' });

		expect(isEdited((await derive('Printer')).documents.get('Printer'), note('under review'))).toBe(false);
	});

	it('is edited when it equals none of them', async () => {
		remote.publish('main', { 'Docs/Printer.md': 'v1' });
		await connect();
		remote.publish('doc/Printer', { 'Docs/Printer.md': 'under review' });

		expect(isEdited((await derive('Printer')).documents.get('Printer'), note('my own words'))).toBe(true);
	});

	it('is edited after the author\'s own revision was merged unchanged and the note was changed again', async () => {
		remote.publish('main', { 'Docs/Printer.md': 'v1' });
		await connect();
		const sent = remote.publish('doc/Printer', { 'Docs/Printer.md': 'my revision' });
		await fetchProject(ctx, remote.address);
		await writeSent(ctx, 'Printer', sent);
		remote.deleteBranch('doc/Printer');
		remote.publish('main', { 'Docs/Printer.md': 'my revision' }, 'merge');
		// Later someone else changes it, and then the author changes the note again.
		remote.publish('main', { 'Docs/Printer.md': 'someone else on top' });

		const states = await derive('Printer');

		expect(isEdited(states.documents.get('Printer'), note('my revision, then edited'))).toBe(true);
	});

	it('is not edited when nothing is known of where the document lives', async () => {
		await connect();

		expect(isEdited((await derive('Printer')).documents.get('Printer'), note('anything'))).toBe(false);
	});

	it('is not edited when the note\'s identifier is not known yet', async () => {
		remote.publish('main', { 'Docs/Printer.md': 'v1' });
		await connect();

		expect(isEdited((await derive('Printer')).documents.get('Printer'), null)).toBe(false);
	});

	it('is not edited for a document nothing has derived', () => {
		expect(isEdited(undefined, note('x'))).toBe(false);
		expect(isEdited(null, note('x'))).toBe(false);
	});

	it('still treats the version synced earlier as unedited after a held-back update', async () => {
		remote.publish('main', { 'Docs/Printer.md': 'v1' });
		await connect();
		remote.publish('main', { 'Docs/Printer.md': 'v2' });
		await fetchProject(ctx, remote.address);
		const tip = await readRef(ctx, fetchedDefaultRef('main'));
		await advanceSynced(ctx, tip.ok && tip.value ? tip.value : '', ['Docs/Printer.md']);

		expect(isEdited((await derive('Printer')).documents.get('Printer'), note('v1'))).toBe(false);
	});
});

describe('which section a document is listed in', () => {
	const cases: Array<[Parameters<typeof panelSectionFor>[0], boolean, ReturnType<typeof panelSectionFor>]> = [
		['pending', false, 'waiting-on-reviewers'],
		['pending', true, 'needs-you'],
		['closed', false, 'needs-you'],
		['closed', true, 'needs-you'],
		['published', true, 'needs-you'],
		['published', false, null],
		[null, false, 'needs-you'],
		[null, true, 'needs-you'],
	];
	for (const [state, edited, section] of cases) {
		it(`puts a ${state ?? 'not yet derived'} document that is ${edited ? '' : 'not '}edited in ${section ?? 'neither'}`, () => {
			expect(panelSectionFor(state, edited)).toBe(section);
		});
	}
});
