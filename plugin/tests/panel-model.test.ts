import { describe, expect, it } from 'vitest';
import { AUTHOR_MESSAGES, AUTHOR_TEMPLATES } from '../src/author-messages';
import { blobId } from '../src/git-publishing/blob-id';
import { parseProjectAddress } from '../src/git-publishing/project-address';
import type { ProjectAddress } from '../src/git-publishing/project-address';
import {
	bannerKind,
	buildPanelModel,
	documentLink,
	initialsOf,
	needsYouEmpty,
	refreshNotice,
	sectionSuffix,
	stateLabel,
	submitLabel,
	projectChangeLabel,
	projectChanges,
	updatesLine,
	waitingUpdates,
} from '../src/plugin-shell/panel-model';
import type { ListedNote } from '../src/plugin-shell/panel-model';
import type { DerivedDocument, DocumentState } from '../src/submission-tracking/derive-state';
import { DerivedStatesHolder } from '../src/submission-tracking/derived-states';

const ADDRESS = parseProjectAddress('git@gitlab.example.com:docs/kb.git') as ProjectAddress;
const text = (s: string): string => blobId(Buffer.from(s));

function doc(docId: string, state: DocumentState, remotePath: string | null, accepted: string[] = []): DerivedDocument {
	return { docId, state, remotePath, accepted: new Set(accepted) };
}

function holder(...documents: DerivedDocument[]): DerivedStatesHolder {
	const h = new DerivedStatesHolder();
	h.recordSuccess({
		defaultBranch: 'main',
		index: { main: new Map(), synced: null, sentNotes: new Map(), identities: new Map() },
		documents: new Map(documents.map((d) => [d.docId, d])),
		updatesAvailable: 0,
		unchanged: [],
	});
	return h;
}

/** A note that carries the older identity property, at the path `doc()` gives its document. */
const note = (docId: string, contents = 'same'): ListedNote => ({
	name: docId,
	folder: 'Docs',
	path: `Docs/${docId}.md`,
	blob: text(contents),
	legacyDocId: docId,
});

/** A note with no identity property at all: what every note is now. */
const plain = (path: string, contents: string | null): ListedNote => ({
	name: path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, ''),
	folder: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '',
	path,
	blob: contents === null ? null : text(contents),
	legacyDocId: null,
});

/** A holder that has derived the given project files, sends and documents. */
function holderOver(
	main: Record<string, string>,
	documents: DerivedDocument[],
	sentNotes: Record<string, { path: string; blob: string }> = {}
): DerivedStatesHolder {
	const h = new DerivedStatesHolder();
	const identities = new Map<string, string[]>();
	for (const path of Object.keys(main)) {
		const id = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '');
		identities.set(id, [path]);
	}
	h.recordSuccess({
		defaultBranch: 'main',
		index: { main: new Map(Object.entries(main)), synced: new Map(Object.entries(main)), sentNotes: new Map(Object.entries(sentNotes)), identities },
		documents: new Map(documents.map((d) => [d.docId, d])),
		updatesAvailable: 0,
		unchanged: Object.keys(main),
	});
	return h;
}

describe('the labels', () => {
	it('say each state in the author\'s words', () => {
		expect(stateLabel('pending')).toBe('Waiting for review');
		expect(stateLabel('published')).toBe('Published');
		expect(stateLabel('closed')).toBe('Not accepted');
	});

	it('name the send control for where the document stands', () => {
		expect(submitLabel(null)).toBe('Submit for review');
		expect(submitLabel('pending')).toBe('Send update');
		expect(submitLabel('published')).toBe('Submit a new version');
		expect(submitLabel('closed')).toBe('Submit again');
	});
});

describe('the sections of the ready screen', () => {
	it('puts a waiting, a not-accepted and a published document where they belong, and leaves the published one out', () => {
		const states = holder(
			doc('Waiting', 'pending', 'Docs/Waiting.md', [text('same')]),
			doc('Refused', 'closed', null),
			doc('Done', 'published', 'Docs/Done.md', [text('same')])
		);

		const model = buildPanelModel([note('Waiting'), note('Refused'), note('Done')], states, ADDRESS);

		expect(model.needsYou.map((r) => r.docId)).toEqual(['Refused']);
		expect(model.waiting.map((r) => r.docId)).toEqual(['Waiting']);
		expect(model.settled).toBe(1);
	});

	it('moves a published document into "Needs you" with its state kept once its note is edited', () => {
		const states = holder(doc('Done', 'published', 'Docs/Done.md', [text('same')]));

		const model = buildPanelModel([note('Done', 'edited since')], states, ADDRESS);

		expect(model.needsYou).toEqual([
			expect.objectContaining({ docId: 'Done', state: 'published', edited: true }),
		]);
	});

	it('moves a document under review into "Needs you" when it is edited, showing both the state and the marker', () => {
		const states = holder(doc('Waiting', 'pending', 'Docs/Waiting.md', [text('same')]));

		const model = buildPanelModel([note('Waiting', 'edited')], states, ADDRESS);

		expect(model.needsYou[0]).toMatchObject({ state: 'pending', edited: true });
		expect(model.waiting).toEqual([]);
	});

	it('puts a document nothing has derived in "Needs you", never "Waiting on reviewers", with no state', () => {
		const model = buildPanelModel([note('Unknown')], new DerivedStatesHolder(), ADDRESS);

		expect(model.needsYou).toEqual([
			{ docId: 'Unknown', name: 'Unknown', path: 'Docs/Unknown.md', state: null, edited: false, moved: false, link: null },
		]);
		expect(model.waiting).toEqual([]);
	});

	it('does not call a note edited before its identifier is known', () => {
		const states = holder(doc('Waiting', 'pending', 'Docs/Waiting.md', [text('same')]));

		const model = buildPanelModel([{ ...note('Waiting'), blob: null }], states, ADDRESS);

		expect(model.waiting).toHaveLength(1);
	});

	it('moves a document that was just sent out of "Needs you" and into "Waiting on reviewers" without a fetch', () => {
		const states = holder(doc('Printer', 'closed', null));
		const before = buildPanelModel([note('Printer')], states, ADDRESS);
		states.recordDocument(doc('Printer', 'pending', 'Docs/Printer.md', [text('same')]));

		const after = buildPanelModel([note('Printer')], states, ADDRESS);

		expect(before.needsYou).toHaveLength(1);
		expect(after.needsYou).toEqual([]);
		expect(after.waiting).toHaveLength(1);
	});

	it('says nothing is submitted for a vault with no document, and nothing is owed for one that has only settled ones', () => {
		expect(needsYouEmpty({ needsYou: [], waiting: [], settled: 0 })).toBe(AUTHOR_MESSAGES.noDocuments);
		expect(needsYouEmpty({ needsYou: [], waiting: [], settled: 2 })).toBe(AUTHOR_MESSAGES.nothingNeedsYou);
		expect(
			needsYouEmpty({
				needsYou: [],
				waiting: [{ docId: 'a', name: 'a', path: 'a.md', state: 'pending', edited: false, moved: false, link: null }],
				settled: 0,
			})
		).toBe(AUTHOR_MESSAGES.nothingNeedsYou);
	});
});

describe('notes that were never sent', () => {
	const printer = doc('Printer', 'published', 'Docs/Printer.md', [text('v1')]);

	it('lists every note on no path of the project, with its folder, whatever its properties', () => {
		const states = holderOver({ 'Docs/Printer.md': text('v1') }, [printer]);

		const model = buildPanelModel([plain('L2/b.md', 'x'), plain('L1/a.md', 'y')], states, ADDRESS);

		expect(model.notSent).toEqual([
			{ name: 'a', folder: 'L1', path: 'L1/a.md' },
			{ name: 'b', folder: 'L2', path: 'L2/b.md' },
		]);
	});

	it('lists a note at the top of the vault with no folder', () => {
		const model = buildPanelModel([plain('a.md', 'x')], holderOver({}, []), ADDRESS);

		expect(model.notSent).toEqual([{ name: 'a', folder: '', path: 'a.md' }]);
	});

	it('is empty when every note is on the project or has been sent', () => {
		const states = holderOver({ 'Docs/Printer.md': text('v1') }, [printer]);

		const model = buildPanelModel([plain('Docs/Printer.md', 'v1')], states, ADDRESS);

		expect(model.notSent).toEqual([]);
	});

	it('does not list a note that a send from this vault touched', () => {
		const guide = doc('Guide', 'pending', 'Docs/Guide.md', [text('v1')]);
		const states = holderOver({}, [guide], { Guide: { path: 'Docs/Guide.md', blob: text('v1') } });

		const model = buildPanelModel([plain('Docs/Guide.md', 'v1')], states, ADDRESS);

		expect(model.notSent).toEqual([]);
		expect(model.waiting).toHaveLength(1);
	});

	it('lists nothing, and counts nothing, before anything has been derived', () => {
		const model = buildPanelModel([plain('a.md', 'x'), plain('b.md', 'y')], new DerivedStatesHolder(), ADDRESS);

		expect(model.notSent).toEqual([]);
	});

	it('does not list a note at a path the project holds, even one whose name cannot be an identity', () => {
		const states = holderOver({ 'Docs/Has space.md': text('v1') }, []);
		states.recordSuccess({ ...states.current!, index: { ...states.current!.index, identities: new Map() } });

		const model = buildPanelModel([plain('Docs/Has space.md', 'v1')], states, ADDRESS);

		expect(model.notSent).toEqual([]);
	});

	it('sorts the rows by path', () => {
		const model = buildPanelModel([plain('Z/z.md', 'z'), plain('A/a.md', 'a')], holderOver({}, []), ADDRESS);

		expect(model.notSent.map((r) => r.path)).toEqual(['A/a.md', 'Z/z.md']);
	});
});

describe('moved notes', () => {
	const printer = doc('Printer', 'published', 'Docs/Printer.md', [text('v1')]);

	it('lists a moved published note once, at its new path, as published and moved, and not the old path', () => {
		const states = holderOver({ 'Docs/Printer.md': text('v1') }, [printer]);

		const model = buildPanelModel([plain('Archive/Printer.md', 'v1')], states, ADDRESS);

		expect(model.needsYou).toEqual([
			expect.objectContaining({ docId: 'Printer', path: 'Archive/Printer.md', state: 'published', moved: true, edited: false }),
		]);
		expect(model.notSent).toEqual([]);
	});

	it('shows a note renamed while its review is open as waiting and moved', () => {
		const guide = doc('Guide', 'pending', 'Docs/Guide.md', [text('v1')]);
		const states = holderOver({}, [guide], { Guide: { path: 'Docs/Guide.md', blob: text('v1') } });

		const model = buildPanelModel([plain('Archive/Renamed.md', 'v1')], states, ADDRESS);

		expect(model.waiting).toEqual([expect.objectContaining({ docId: 'Guide', state: 'pending', moved: true })]);
	});

	it('shows a moved note that was also edited as not sent yet, because its bytes match nothing', () => {
		const states = holderOver({ 'Docs/Printer.md': text('v1') }, [printer]);

		const model = buildPanelModel([plain('Archive/Printer.md', 'v1 edited')], states, ADDRESS);

		expect(model.notSent).toEqual([{ name: 'Printer', folder: 'Archive', path: 'Archive/Printer.md' }]);
		expect(model.needsYou).toEqual([]);
	});

	it('shows no moved marker until the note\'s identifier is known', () => {
		const states = holderOver({ 'Docs/Printer.md': text('v1') }, [printer]);

		const model = buildPanelModel([plain('Archive/Printer.md', null)], states, ADDRESS);

		expect(model.needsYou).toEqual([]);
		expect(model.notSent).toHaveLength(1);
	});

	it('shows a moved and edited published note once, with both markers beside the state', () => {
		const states = holderOver({ 'Docs/Printer.md': text('v1') }, [doc('Printer', 'published', 'Docs/Printer.md', [text('v1')])]);

		const model = buildPanelModel([{ ...plain('Archive/Printer.md', 'v2'), legacyDocId: 'Printer' }], states, ADDRESS);

		expect(model.needsYou).toEqual([expect.objectContaining({ state: 'published', moved: true, edited: true })]);
	});
});

describe('how many updates are waiting', () => {
	const main = { 'Docs/Printer.md': text('v1'), 'Docs/Scanner.md': text('s1') };

	function states(updatesAvailable = 0) {
		const h = holderOver(main, []);
		return { ...h.current!, updatesAvailable };
	}

	it('counts a file the project has that the vault lacks, which comes back', () => {
		expect(waitingUpdates(states(), new Set(['Docs/Printer.md']), [])).toBe(1);
	});

	it('does not count a file whose exact bytes sit in the vault at another path, because Get updates leaves it', () => {
		const held = new Set(['Docs/Printer.md', 'Archive/Scanner.md']);

		expect(waitingUpdates(states(), held, [{ path: 'Archive/Scanner.md', blob: text('s1') }])).toBe(0);
	});

	it('counts a file that moved and was edited, because it comes back', () => {
		const held = new Set(['Docs/Printer.md', 'Archive/Scanner.md']);

		expect(waitingUpdates(states(), held, [{ path: 'Archive/Scanner.md', blob: text('s1 edited') }])).toBe(1);
	});

	it('adds the files the project changed', () => {
		expect(waitingUpdates(states(2), new Set(Object.keys(main)), [])).toBe(2);
	});

	it('is null before anything has been derived', () => {
		expect(waitingUpdates(null, new Set(), [])).toBeNull();
	});
});

describe('the files Get updates would act on', () => {
	const main = { 'Docs/Printer.md': text('v1'), 'Docs/Scanner.md': text('s1') };
	const everything = new Set(Object.keys(main));

	/** The project's tree and the last synced one, as the derivation reads them. */
	function over(project: Record<string, string>, synced: Record<string, string> | null, unchanged: string[] = []) {
		const base = holderOver(main, []).current!;
		return {
			...base,
			unchanged,
			index: { ...base.index, main: new Map(Object.entries(project)), synced: synced === null ? null : new Map(Object.entries(synced)) },
		};
	}

	it('lists a file the project added, one it changed, and one it removed, by path', () => {
		const states = over({ 'b.md': text('new'), 'a.md': text('v2') }, { 'a.md': text('v1'), 'gone.md': text('g') });

		expect(projectChanges(states, new Set(), [])).toEqual([
			{ path: 'a.md', kind: 'changed' },
			{ path: 'b.md', kind: 'added' },
			{ path: 'gone.md', kind: 'removed' },
		]);
	});

	it('lists a file the project has unchanged that the vault lacks as deleted here', () => {
		const states = over(main, main, ['Docs/Printer.md', 'Docs/Scanner.md']);

		expect(projectChanges(states, new Set(['Docs/Printer.md']), [])).toEqual([{ path: 'Docs/Scanner.md', kind: 'deleted-here' }]);
	});

	it('leaves out a file whose exact bytes sit elsewhere in the vault, which is a move', () => {
		const states = over(main, main, ['Docs/Printer.md', 'Docs/Scanner.md']);
		const held = new Set(['Docs/Printer.md', 'Archive/Scanner.md']);

		expect(projectChanges(states, held, [{ path: 'Archive/Scanner.md', blob: text('s1') }])).toEqual([]);
	});

	it('agrees with the count of waiting updates', () => {
		const states = over(main, main, ['Docs/Printer.md', 'Docs/Scanner.md']);

		expect(projectChanges(states, new Set(), [])).toHaveLength(waitingUpdates(states, new Set(), []) as number);
	});

	it('lists nothing as changed before anything has been synced, and nothing at all before anything is derived', () => {
		expect(projectChanges(over(main, null), everything, [])).toEqual([]);
		expect(projectChanges(null, everything, [])).toBeNull();
	});

	it('names each kind in the author\'s words', () => {
		expect(projectChangeLabel('added')).toBe('New');
		expect(projectChangeLabel('changed')).toBe('Changed');
		expect(projectChangeLabel('removed')).toBe('Removed');
		expect(projectChangeLabel('deleted-here')).toBe('Deleted here');
	});
});

describe('the banner and the avatar', () => {
	const outcome = (kind: 'succeeded' | 'failed' | 'refreshing' | 'idle') => ({ kind }) as Parameters<typeof updatesLine>[1];

	it('is "latest" when a check found nothing, "waiting" when it found something', () => {
		expect(bannerKind(0, outcome('succeeded'))).toBe('latest');
		expect(bannerKind(3, outcome('succeeded'))).toBe('waiting');
	});

	it('is "failed" whatever the count, and "unchecked" before a check has answered', () => {
		expect(bannerKind(3, outcome('failed'))).toBe('failed');
		expect(bannerKind(null, outcome('succeeded'))).toBe('unchecked');
		expect(bannerKind(0, outcome('refreshing'))).toBe('unchecked');
	});

	it('takes the avatar letters from the first two parts of the name', () => {
		expect(initialsOf('pham.ngoc.trai')).toBe('PN');
		expect(initialsOf('ana-nguyen')).toBe('AN');
		expect(initialsOf('Ana_Nguyen_Van')).toBe('AN');
	});

	it('takes two letters from a one-part name, and handles odd ones', () => {
		expect(initialsOf('ana')).toBe('AN');
		expect(initialsOf('a')).toBe('A');
		expect(initialsOf('..--')).toBe('?');
		expect(initialsOf('')).toBe('?');
		expect(initialsOf('đặng.văn')).toBe('ĐV');
	});
});

describe('"Open in GitLab"', () => {
	it('opens the project\'s reviews for the document\'s branch while it is waiting', () => {
		expect(documentLink(ADDRESS, doc('Printer', 'pending', 'Docs/Printer.md'), 'main')).toBe(
			'https://gitlab.example.com/docs/kb/-/merge_requests?state=opened&source_branch=doc%2FPrinter'
		);
	});

	it('opens the file on the default branch once it is published', () => {
		expect(documentLink(ADDRESS, doc('Printer', 'published', 'Docs/In máy in.md'), 'main')).toBe(
			'https://gitlab.example.com/docs/kb/-/blob/main/Docs/In%20m%C3%A1y%20in.md'
		);
	});

	it('offers nothing for a document that was not accepted', () => {
		expect(documentLink(ADDRESS, doc('Printer', 'closed', null), 'main')).toBeNull();
	});

	it('offers nothing when nothing is derived or there is no address', () => {
		expect(documentLink(ADDRESS, null, 'main')).toBeNull();
		expect(documentLink(null, doc('Printer', 'pending', null), 'main')).toBeNull();
		expect(documentLink(ADDRESS, doc('Printer', 'published', 'a.md'), null)).toBeNull();
	});

	it('offers no review link for an identity that could not be a branch name', () => {
		expect(documentLink(ADDRESS, doc('a b', 'pending', null), 'main')).toBeNull();
	});
});

describe('what a refresh that went wrong says', () => {
	it('names the failure on the section, and gives the count otherwise', () => {
		expect(sectionSuffix('failed', 3)).toBe('(check failed)');
		expect(sectionSuffix('succeeded', 3)).toBe('3');
		expect(sectionSuffix('never', 0)).toBe('0');
	});

	it('tells the author the states may have moved on only when the refresh failed', () => {
		expect(refreshNotice({ kind: 'failed', failure: 'server-unreachable' })).toBe(AUTHOR_MESSAGES.refreshFailed);
		expect(refreshNotice({ kind: 'succeeded' })).toBeNull();
		expect(refreshNotice({ kind: 'never' })).toBeNull();
	});
});

describe('the line about updates waiting', () => {
	it('says how many, or that there are none, once a fetch has answered', () => {
		expect(updatesLine(0, { kind: 'succeeded' })).toBe(AUTHOR_MESSAGES.latestDocuments);
		expect(updatesLine(1, { kind: 'succeeded' })).toBe('1 update available');
		expect(updatesLine(4, { kind: 'succeeded' })).toBe(AUTHOR_TEMPLATES.updatesAvailable(4));
	});

	it('says it has not checked before a fetch has answered, even when states were read from the last session\'s copy', () => {
		expect(updatesLine(null, { kind: 'never' })).toBe(AUTHOR_MESSAGES.updatesNotChecked);
		expect(updatesLine(null, { kind: 'refreshing' })).toBe(AUTHOR_MESSAGES.updatesNotChecked);
		expect(updatesLine(0, { kind: 'never' })).toBe(AUTHOR_MESSAGES.updatesNotChecked);
		expect(updatesLine(3, { kind: 'refreshing' })).toBe(AUTHOR_MESSAGES.updatesNotChecked);
	});

	it('says the check did not succeed, and not that the vault is current, when the last fetch failed', () => {
		expect(updatesLine(null, { kind: 'failed', failure: 'unexpected' })).toBe(AUTHOR_MESSAGES.updatesCheckFailed);
		expect(updatesLine(0, { kind: 'failed', failure: 'server-unreachable' })).toBe(AUTHOR_MESSAGES.updatesCheckFailed);
	});
});

describe('the states held for the session', () => {
	it('keeps what was last known when a refresh fails, and says it failed', () => {
		const states = holder(doc('Printer', 'pending', 'Docs/Printer.md'));

		states.beginRefresh();
		states.recordFailure('server-unreachable');

		expect(states.statusFor('Printer')?.state).toBe('pending');
		expect(states.lastOutcome).toEqual({ kind: 'failed', failure: 'server-unreachable' });
	});

	it('shows nothing for a document it knows nothing about, and nothing at all on a first failure', () => {
		const states = new DerivedStatesHolder();
		states.recordFailure('server-unreachable');

		expect(states.statusFor('Printer')).toBeNull();
		expect(states.current).toBeNull();
		expect(states.updatesAvailable).toBeNull();
	});

	it('tells whoever is listening when it changes, and not after they have stopped', () => {
		const states = new DerivedStatesHolder();
		let heard = 0;
		const stop = states.onChange(() => {
			heard += 1;
		});

		states.beginRefresh();
		stop();
		states.recordSuccess(null);

		expect(heard).toBe(1);
	});

	it('goes back to never-checked when cleared', () => {
		const states = holder(doc('Printer', 'pending', 'a.md'));

		states.clear();

		expect(states.current).toBeNull();
		expect(states.lastOutcome).toEqual({ kind: 'never' });
	});

	it('does not invent a state for a document it is told about before anything is derived', () => {
		const states = new DerivedStatesHolder();

		states.recordDocument(doc('Printer', 'pending', 'a.md'));

		expect(states.statusFor('Printer')).toBeNull();
	});
});
