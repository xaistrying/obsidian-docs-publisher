import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUTHOR_MESSAGES, AUTHOR_TEMPLATES } from '../src/author-messages';

/**
 * The author-facing vocabulary ban, as a test. The words an author must never
 * read are the ones that name how the platform works underneath: branch,
 * commit, merge request (and its abbreviation), conflict, main. `token` is
 * banned here too, which the ban itself does not require: this change removed
 * the access token, so a string that mentions one is a string that was not
 * updated.
 *
 * Whole words only, so "remain" and "domain" do not trip it.
 */
const BANNED = /\b(branch(es)?|commit(s|ted|ting)?|merge requests?|MRs?|conflicts?|main|tokens?)\b/i;

function everyMessage(): Array<[string, string]> {
	const all: Array<[string, string]> = [];
	for (const name of Object.keys(AUTHOR_MESSAGES)) {
		all.push([name, (AUTHOR_MESSAGES as Record<string, string>)[name]]);
	}
	// Templates are run with realistic arguments: a banned word that only
	// appears in the template's own text still shows up in the output.
	const t = AUTHOR_TEMPLATES;
	all.push(['stepOf', t.stepOf(2)]);
	all.push(['keyWorks', t.keyWorks('ana.nguyen')]);
	all.push(['connectedAs', t.connectedAs('ana.nguyen')]);
	all.push(['addressLocked', t.addressLocked('docs/knowledge-base')]);
	all.push(['updatesAvailable(1)', t.updatesAvailable(1)]);
	all.push(['updatesAvailable(3)', t.updatesAvailable(3)]);
	all.push(['moveDetail', t.moveDetail('Docs/Printer.md', 'Archive/Printer.md')]);
	all.push(['andMore', t.andMore(12)]);
	all.push(['gotUpdates', t.gotUpdates(3, 2, 1)]);
	all.push(['merged', t.merged('Printer setup')]);
	all.push(['skippedPath', t.skippedPath('Docs/Printer setup.md')]);
	all.push(['unsavedNote', t.unsavedNote('Printer setup')]);
	all.push(['summaryText', t.summaryText(120, 4, 2)]);
	all.push(['twoVersionsTitle', t.twoVersionsTitle('Printer setup')]);
	all.push(['removedHereTitle', t.removedHereTitle('Printer setup')]);
	return all;
}

describe('the author-facing messages', () => {
	it('lists something, so the scan below is not scanning nothing', () => {
		expect(everyMessage().length).toBeGreaterThan(70);
	});

	for (const [name, text] of everyMessage()) {
		it(`${name} contains no banned word`, () => {
			expect(text).not.toMatch(BANNED);
		});
	}

	it('has no empty message', () => {
		for (const [name, text] of everyMessage()) {
			expect(text.trim(), name).not.toBe('');
		}
	});

	it('fails the scan when a banned word is introduced, so the scan can be trusted', () => {
		for (const bad of [
			'Your branch is ahead',
			'There is a merge conflict',
			'Open the merge request',
			'Your MR was opened',
			'Paste your access token',
			'Commit your changes',
			'Returning to main',
		]) {
			expect(bad, bad).toMatch(BANNED);
		}
		for (const fine of ['The remaining files', 'Your domain', 'Maintainer access', 'Merged your changes']) {
			expect(fine, fine).not.toMatch(BANNED);
		}
	});
});

/**
 * No string written in place reaches the screen.
 *
 * Every call that shows text to an author must be given a constant or a
 * template from `author-messages.ts`, or the scan above cannot see it. Code
 * that predates this change still builds its strings in place; those files
 * are named here and the list may only shrink: the second test fails when a
 * file listed here no longer needs to be, so the entry has to come out with
 * the code (tasks 1.9, 1.10 and 5.1 retire them).
 */
const LEGACY_FILES_WITH_INLINE_STRINGS: ReadonlyArray<string> = [
	'doc-authoring/submit-modal.ts',
];

const SRC = join(__dirname, '..', 'src');

function sourceFiles(dir: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...sourceFiles(full));
		} else if (entry.name.endsWith('.ts')) {
			files.push(full);
		}
	}
	return files;
}

/** Code without its comments, so prose that mentions `new Notice('` cannot trip the scan. */
function withoutComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const INLINE_STRING_TO_UI =
	/new Notice\(\s*['"`]|\.setText\(\s*['"`]|\.setButtonText\(\s*['"`]|\.setName\(\s*['"`]|\.setDesc\(\s*['"`]|[{,]\s*text:\s*['"`]/;

function filesWithInlineStrings(): string[] {
	return sourceFiles(SRC)
		.filter((file) => INLINE_STRING_TO_UI.test(withoutComments(readFileSync(file, 'utf8'))))
		.map((file) => relative(SRC, file).split('\\').join('/'))
		.sort();
}

describe('strings that reach the author', () => {
	const offenders = filesWithInlineStrings();

	it('are not written in place in any file this change added or rewrote', () => {
		const unexpected = offenders.filter((file) => LEGACY_FILES_WITH_INLINE_STRINGS.indexOf(file) === -1);

		expect(unexpected).toEqual([]);
	});

	it('are still written in place in every legacy file listed, or the file comes off the list', () => {
		const stale = LEGACY_FILES_WITH_INLINE_STRINGS.filter((file) => offenders.indexOf(file) === -1);

		expect(stale).toEqual([]);
	});

	it('is a scan that notices an inline string, so a clean result means something', () => {
		expect(INLINE_STRING_TO_UI.test("new Notice('hello')")).toBe(true);
		expect(INLINE_STRING_TO_UI.test("el.setText(`hello`)")).toBe(true);
		expect(INLINE_STRING_TO_UI.test("createEl('p', { text: 'hello' })")).toBe(true);
		expect(INLINE_STRING_TO_UI.test('new Notice(AUTHOR_MESSAGES.notReady)')).toBe(false);
		expect(INLINE_STRING_TO_UI.test(withoutComments("// new Notice('hello')"))).toBe(false);
		expect(INLINE_STRING_TO_UI.test(withoutComments("/* text: 'hello' */"))).toBe(false);
	});
});
