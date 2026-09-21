/**
 * The front matter the plugin writes when a document is created — and the only
 * front matter it ever writes for these four fields.
 *
 * `title`, `category` and `doc_id` are deliberately absent. They are completed
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
 * Returns `content` with `title`, `category` and `doc_id` merged into its
 * front matter block — a plain string operation that touches no file.
 *
 * MERGED, not appended. Any of the three already in the block is removed
 * first and rewritten at the end, so this never produces a duplicate key.
 * That mattered the moment imported documents existed: import freezes
 * `doc_id` into the block, so a first submit that blindly appended would
 * commit a document carrying two `doc_id` lines and two answers to the
 * question of what it is.
 *
 * Exists for exactly one caller: `submit-document.ts`'s FIRST submit, to
 * compute what gets COMMITTED to the remote. `writeSubmissionFrontMatter`
 * only writes these three fields to the local note after the remote write
 * has already succeeded — correctly, since `doc_id` has no rollback path —
 * but left at that, the content actually pushed on a first submit would
 * carry none of the three. That silently breaks `docs/document-identity.md`
 * §2's "doc_id is committed with the note": a document never revised again
 * would sit on the remote missing its own identity, which is exactly what a
 * fresh pull on a second machine, or this project's own recovery, depends
 * on to reconnect it. This closes that gap without moving the local write
 * earlier — the note itself is untouched here; only the string handed to
 * the commit call is.
 *
 * Never called for a document that already has a `doc_id`: a resubmission's
 * own local content already carries all three, written by
 * `writeSubmissionFrontMatter` after the document's first submit.
 */
export function withSubmissionFrontMatter(
	content: string,
	fields: { title: string; category: Category; docId: string }
): string {
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
	const kept = withoutKeys(body, ['title', 'category', 'doc_id']);
	const merged =
		(kept === '' ? '' : `${kept}\n`) +
		`title: ${yamlString(fields.title)}\n` +
		`category: ${fields.category}\n` +
		`doc_id: ${fields.docId}`;
	return `---\n${merged}\n---\n${rest}`;
}

/**
 * The block's body with any line opening one of `keys` removed.
 *
 * Line-based, which is exact for these three and only these three: all are
 * plain scalars by contract — `title` is quoted by `yamlString`, `category`
 * is a fixed enum, `doc_id` is validated git-ref-legal — so none can span
 * lines or carry a block indicator whose continuation lines this would
 * orphan. Every other field in the block, list-valued ones included, is
 * untouched because it is never named here.
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
 * A minimal double-quoted YAML scalar. `category` and `doc_id` need no
 * escaping — the first is a fixed enum, the second already validated as
 * git-ref-legal (`docs/document-identity.md` §3), so neither can carry a
 * colon, a quote, or a leading special character. `title` is free-form
 * author text and has no such guarantee, so it alone goes through this.
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

/**
 * Completes the front matter contract at first submit: `title`, `category`
 * and `doc_id`, written together and only once. Callers must only invoke
 * this after both the remote commit and the merge request have succeeded —
 * see `submit-document.ts` — never speculatively, since there is no
 * rollback path for a value written here and then undone.
 *
 * FIRST SUBMIT ONLY, and that is a contract rather than a convention
 * (`openspec/config.yaml`, "WHO WRITES WHAT, AND WHEN"): after this has run
 * once, `title` and `category` belong to the author by hand and the plugin
 * never writes them again. Calling this on a resubmit breaks that — and did,
 * until 2026-09-12: every resubmit rewrote both fields from a modal that had
 * re-collected them, which also meant the content committed moments earlier
 * carried the PREVIOUS revision's values, since it was read before this ran.
 * A resubmit reads `readSubmissionFields` above instead and writes nothing.
 *
 * Goes through `FileManager.processFrontMatter`, unlike `composeFrontMatter`
 * above: the note already exists by the time this runs, so there is no
 * "empty note, then rewrite" problem to avoid.
 */
export async function writeSubmissionFrontMatter(
	app: App,
	file: TFile,
	fields: { title: string; category: Category; docId: string }
): Promise<void> {
	await app.fileManager.processFrontMatter(file, (frontmatter) => {
		frontmatter.title = fields.title;
		frontmatter.category = fields.category;
		// A `doc_id` already in front matter is frozen and is never replaced,
		// even by an identical-looking value. The caller passes the frozen one
		// back when there is one, so this guard should be unreachable — it is
		// here because `doc_id` is the value with no rollback path, and the
		// invariant belongs where the write happens rather than only at the
		// call site. See `docs/document-identity.md` §3.
		if (typeof frontmatter.doc_id !== 'string' || frontmatter.doc_id.trim() === '') {
			frontmatter.doc_id = fields.docId;
		}
	});
}

/**
 * Whether `content` opens with a YAML front matter block at all.
 *
 * The WHOLE of add-discover-and-import's exclusion rule (its design.md
 * decision 6): a remote markdown file with no block is not offered for
 * import, and nothing else disqualifies one. Not a filename denylist, which
 * would need extending forever and would hide a real document someone named
 * badly; not the full seven-field contract, which ZERO of the 34 documents
 * in the real corpus would pass (`docs/ce-verification.md` §E2) — the fields
 * they lack are precisely the ones this plugin itself writes.
 *
 * Reads the same `FRONT_MATTER_BLOCK` the merge above does, so "has a block"
 * and "can have a field merged into it" can never disagree.
 */
export function hasFrontMatter(content: string): boolean {
	return FRONT_MATTER_BLOCK.test(content);
}

const DOC_ID_LINE = /^doc_id:[ \t]*(.*)$/m;

/**
 * The `doc_id` a raw document's front matter already carries, or null.
 *
 * A STRING read rather than a `metadataCache` one, because import asks this
 * of content that is not in the vault yet and therefore has no cache entry —
 * `readDocId` in `submission-tracking/resolve.ts` is the counterpart for a
 * note that is. Import needs the answer to avoid writing a SECOND `doc_id`
 * key into a document this plugin itself published, which already carries
 * one.
 *
 * Deliberately a line match rather than a YAML parse. The value it reads is
 * validated as git-ref-legal before it was ever written
 * (`docs/document-identity.md` §3), so it cannot carry a colon, a quote, a
 * newline or a leading indicator character — the shapes a real parser exists
 * to handle. Quotes are stripped anyway, since a hand-edited file may carry
 * them.
 */
export function readContentDocId(content: string): string | null {
	const match = FRONT_MATTER_BLOCK.exec(content);
	if (match === null) {
		return null;
	}

	const line = DOC_ID_LINE.exec(match[1]);
	if (line === null) {
		return null;
	}

	const value = line[1].trim().replace(/^["']|["']$/g, '').trim();
	return value === '' ? null : value;
}

/**
 * Returns `content` with `doc_id` appended to its front matter block, and
 * NOTHING else changed — every other field is carried through byte for byte,
 * in its original order and spelling.
 *
 * A string operation rather than `FileManager.processFrontMatter`, and that
 * is the requirement rather than a convenience: `processFrontMatter`
 * re-serializes the whole block, so a document written by someone else would
 * come back with its quoting, key order and comments rewritten to Obsidian's
 * taste. Import must add one line to a stranger's document and leave the rest
 * of it alone (add-discover-and-import tasks.md 3.3).
 *
 * Returns `content` untouched when there is no block to merge into. Callers
 * never see that case — discovery excludes exactly those files — but failing
 * safe beats fabricating a block, the same choice
 * `withSubmissionFrontMatter` above makes for the same reason.
 */
export function withDocId(content: string, docId: string): string {
	const match = FRONT_MATTER_BLOCK.exec(content);
	if (match === null) {
		return content;
	}

	const [wholeMatch, body] = match;
	const rest = content.slice(wholeMatch.length);
	return `---\n${body}\ndoc_id: ${docId}\n---\n${rest}`;
}
