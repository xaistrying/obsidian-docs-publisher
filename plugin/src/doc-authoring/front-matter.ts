/**
 * The front matter the plugin writes when a document is created — and the only
 * front matter it ever writes for these four fields.
 *
 * `title` and `category` are deliberately absent. They are completed
 * when the document is first submitted, so nothing here blocks the author's
 * first keystroke.
 */

import type { App, TFile } from 'obsidian';
import type { Category } from './categories';
import { CATEGORIES } from './categories';

/**
 * A calendar date in `YYYY-MM-DD` form, read from the author's own clock.
 *
 * Not `toISOString().slice(0, 10)`, which returns the **UTC** day: for an
 * author in UTC+7 every document created before 07:00 local would be stamped
 * with yesterday, and the error is invisible until someone compares a
 * document's `created` against its review history and finds it a day early.
 */
export function formatDate(date: Date): string {
	const year = date.getFullYear();
	const month = pad(date.getMonth() + 1);
	const day = pad(date.getDate());
	return `${year}-${month}-${day}`;
}

/**
 * The four-field YAML block, ending in a newline after its closing fence.
 *
 * Composed as text rather than through `FileManager.processFrontMatter`, which
 * needs a `TFile` that does not exist yet: going that way would mean creating
 * an empty note and rewriting it, two writes with a half-formed note in
 * between. This is passed straight to `vault.create` as the whole content.
 *
 * No YAML escaper is needed, and that is a fact about the values rather than an
 * omission: GitLab usernames are restricted to alphanumerics, `-`, `_` and `.`,
 * the date is generated here, and `active` is a literal.
 */
export function composeFrontMatter(username: string, date: Date): string {
	const today = formatDate(date);
	return [
		'---',
		`owner: ${username}`,
		`created: ${today}`,
		// The same date as `created`, not a separate reading of the clock: a
		// document is reviewed as of the day it was written.
		`last_reviewed: ${today}`,
		'lifecycle: active',
		'---',
		'',
	].join('\n');
}

function pad(value: number): string {
	return value < 10 ? `0${value}` : `${value}`;
}

const FRONT_MATTER_BLOCK = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;

/**
 * Returns `content` with `title` and `category` merged into its front matter
 * block — a plain string operation that touches no file.
 *
 * MERGED, not appended. Either of the two already in the block is removed first
 * and rewritten at the end, so this never produces a duplicate key. A `doc_id`
 * the note already carries is not one of them and is left exactly where it is:
 * this plugin no longer writes an identity into a note, and never removes one
 * an older version wrote (panel-by-path-without-doc-id).
 *
 * Exists for exactly one caller: `submit-document.ts`'s send of a note that
 * lacks them, to compute what gets COMMITTED to the project. The note itself is
 * only written after the push has succeeded, so left at that, the content
 * actually pushed would carry neither; this makes the pushed file the one the
 * note will become, without moving the local write earlier.
 */
export function withSubmissionFrontMatter(content: string, fields: { title: string; category: Category }): string {
	const match = FRONT_MATTER_BLOCK.exec(content);
	if (match === null) {
		// No recognizable front matter block. Should not happen for a note this
		// plugin created, but failing safe by leaving `content` untouched beats
		// fabricating a block whose shape might not match what
		// `processFrontMatter` produces for the very same note moments later.
		return content;
	}

	const [wholeMatch, body] = match;
	const rest = content.slice(wholeMatch.length);
	const kept = withoutKeys(body, ['title', 'category']);
	const merged = (kept === '' ? '' : `${kept}\n`) + `title: ${yamlString(fields.title)}\n` + `category: ${fields.category}`;
	return `---\n${merged}\n---\n${rest}`;
}

/**
 * The block's body with any line opening one of `keys` removed.
 *
 * Line-based, which is exact for these two and only these two: both are plain
 * scalars by contract — `title` is quoted by `yamlString`, `category` is a fixed
 * enum — so neither can span lines or carry a block indicator whose
 * continuation lines this would orphan. Every other field in the block,
 * list-valued ones included, is untouched because it is never named here.
 */
function withoutKeys(body: string, keys: readonly string[]): string {
	const pattern = new RegExp(`^(?:${keys.join('|')}):`);
	return body
		.split('\n')
		.filter((line) => !pattern.test(line))
		.join('\n')
		.replace(/\n+$/, '');
}

/**
 * A minimal double-quoted YAML scalar. `category` needs no escaping — it is a
 * fixed enum, so it cannot carry a colon, a quote, or a leading special
 * character. `title` is free-form author text and has no such guarantee, so it
 * alone goes through this.
 */
function yamlString(value: string): string {
	return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * The `title` and `category` a tracked note already carries, or null when
 * either is missing, empty, or — for `category` — not one of the nine
 * deliverables.
 *
 * The counterpart to `writeSubmissionFrontMatter` below, and the reason that
 * function must not run on a resubmit. `openspec/config.yaml`'s front matter
 * contract splits these three fields by WHO WRITES THEM AND WHEN: the plugin
 * writes `title` and `category` once, at first submit, and from that moment
 * they are "by hand, by the author, at any time thereafter, with the plugin
 * never writing again". A resubmit therefore READS them here and shows them
 * back read-only; it never collects them again and never writes them.
 *
 * Null is a refusal, not a prompt to re-collect. An author who emptied
 * `title` by hand is told to put it back, because the alternative — asking
 * for it and writing the answer — is the repeat write the contract forbids.
 */
export function readSubmissionFields(
	app: App,
	file: TFile
): { title: string; category: Category } | null {
	const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
	const title = frontmatter?.['title'];
	const category = frontmatter?.['category'];
	if (typeof title !== 'string' || title.trim() === '') {
		return null;
	}

	if (typeof category !== 'string' || !isCategory(category)) {
		return null;
	}

	return { title: title.trim(), category };
}

/**
 * Whether this note has ever been through a first submit BY THIS PLUGIN,
 * answered by the presence of `category` — the field the plugin writes at
 * that moment and at no other, and which nothing else in the corpus writes
 * (`docs/ce-verification.md` §E2 found it absent from all 34 real
 * documents).
 *
 * Exists to separate two notes that `readSubmissionFields` cannot tell
 * apart, both of which make it answer null:
 *
 * - An IMPORTED document. It carries `doc_id`, frozen at import, but has
 *   never been submitted from here, so `title`/`category` were never
 *   collected. Its next submit is its first and must COLLECT them.
 * - A tracked note whose author emptied `title` by hand. It has been through
 *   a first submit, `category` is still there, and re-collecting would be
 *   the repeat write the front matter contract forbids. It must REFUSE.
 *
 * Reading `category` rather than `title` is what makes the two separable:
 * the real corpus carries `title` and never `category`, so the presence of
 * `category` means this plugin put it there.
 */
export function hasSubmissionCategory(app: App, file: TFile): boolean {
	const category = app.metadataCache.getFileCache(file)?.frontmatter?.['category'];
	return typeof category === 'string' && category.trim() !== '';
}

function isCategory(value: string): value is Category {
	for (const category of CATEGORIES) {
		if (category === value) {
			return true;
		}
	}

	return false;
}
