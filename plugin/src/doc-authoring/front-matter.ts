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
	const merged =
		`${body}\n` +
		`title: ${yamlString(fields.title)}\n` +
		`category: ${fields.category}\n` +
		`doc_id: ${fields.docId}`;
	return `---\n${merged}\n---\n${rest}`;
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
 * Completes the front matter contract at first submit: `title`, `category`
 * and `doc_id`, written together and only once. Callers must only invoke
 * this after both the remote commit and the merge request have succeeded —
 * see `submit-document.ts` — never speculatively, since there is no
 * rollback path for a value written here and then undone.
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
