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
		frontmatter.doc_id = fields.docId;
	});
}
