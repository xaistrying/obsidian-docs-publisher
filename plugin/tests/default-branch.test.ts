import { afterEach, describe, expect, it } from 'vitest';
// From the stub by path rather than through the `obsidian` specifier — see
// the note in `submission-files.test.ts`.
import { setRequestUrlHandler, stubResponse } from './obsidian-stub';
import { getDefaultBranch } from '../src/git-publishing/gitlab-client';

/**
 * Refusing to work against a repository with no commits.
 *
 * THIS IS NOT A TIDINESS CHECK. In an empty GitLab repository the FIRST
 * branch created becomes the default branch, so a first submit into one makes
 * that document's own `doc/<doc_id>` the default. Its merge request then
 * cannot open — source and target are the same branch — so the local note
 * never gets its `doc_id`, no record is stored, and every later submit is
 * refused by the collision pre-flight against the document's own file. The
 * project is left permanently unusable by this plugin, which is what happened
 * to a real one on 2026-09-21 (`styl-group1/kb-docs-02`, whose default branch
 * became `doc/nets-69xxx-error-code`).
 *
 * `getDefaultBranch` is the one gate every write passes through, so refusing
 * here is what keeps that from happening again.
 */

const DETAILS = { host: 'https://gitlab.example.com', projectId: '42', token: 'x' };

let restore: (() => void) | null = null;

afterEach(() => {
	restore?.();
	restore = null;
});

function project(body: Record<string, unknown>): void {
	restore = setRequestUrlHandler(() => stubResponse({ status: 200, body: JSON.stringify(body) }));
}

describe('reading the branch a submission is cut from', () => {
	it('answers the default branch of an ordinary project', async () => {
		project({ default_branch: 'main', empty_repo: false });

		expect(await getDefaultBranch(DETAILS)).toEqual({ ok: true, value: 'main' });
	});

	it('refuses a project with no commits at all', async () => {
		project({ default_branch: null, empty_repo: true });

		expect(await getDefaultBranch(DETAILS)).toEqual({ ok: false, failure: 'empty-repository' });
	});

	it('refuses an empty project that still NAMES a default branch', async () => {
		// The trap, and the reason `empty_repo` is checked as well as the name:
		// a fresh project reports the branch it WOULD default to, before any
		// commit has created it. Trusting the name writes into a repository
		// that has no branches, and the branch written becomes the default.
		project({ default_branch: 'main', empty_repo: true });

		expect(await getDefaultBranch(DETAILS)).toEqual({ ok: false, failure: 'empty-repository' });
	});

	it('refuses when the response carries no usable branch name', async () => {
		project({ empty_repo: false });

		expect(await getDefaultBranch(DETAILS)).toEqual({ ok: false, failure: 'empty-repository' });
	});

	it('does not mistake a project that merely omits empty_repo for an empty one', async () => {
		// Older instances may not report the field. A named default branch is
		// enough on its own; absence of the flag must not refuse a real project.
		project({ default_branch: 'main' });

		expect(await getDefaultBranch(DETAILS)).toEqual({ ok: true, value: 'main' });
	});
});
