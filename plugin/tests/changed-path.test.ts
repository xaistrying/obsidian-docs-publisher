import { afterEach, describe, expect, it } from 'vitest';
// From the stub by path rather than through the `obsidian` specifier — see
// the note in `submission-files.test.ts`.
import { setRequestUrlHandler, stubResponse } from './obsidian-stub';
import { getMergeRequestChangedPath } from '../src/git-publishing/gitlab-client';

/**
 * The rule three shipped behaviours depend on: the pre-submit path-mismatch
 * check, Reset, and recovery's fallback for a record with no stored path. None
 * of their own code changed when attachments arrived — the repair is entirely
 * inside this one function — so these are the tests that stand behind all
 * three (design.md decision 1).
 */

const DETAILS = { host: 'https://gitlab.example.com', projectId: '42', token: 'x' };

let restore: (() => void) | null = null;

afterEach(() => {
	restore?.();
	restore = null;
});

/** Answers the `/changes` read with a merge request that touched these paths. */
function changed(paths: string[]): void {
	restore = setRequestUrlHandler(() =>
		stubResponse({
			status: 200,
			body: JSON.stringify({ changes: paths.map((path) => ({ new_path: path })) }),
		})
	);
}

describe('reading a merge request\'s own document path', () => {
	it('resolves a merge request carrying only the document', async () => {
		changed(['Guides/Setup.md']);

		expect(await getMergeRequestChangedPath(DETAILS, 7)).toEqual({ ok: true, value: 'Guides/Setup.md' });
	});

	it('resolves the document when images came with it', async () => {
		changed([
			'Guides/assets/one.png',
			'Guides/Setup.md',
			'Guides/assets/two.png',
			'shared/logo.svg',
		]);

		expect(await getMergeRequestChangedPath(DETAILS, 7)).toEqual({ ok: true, value: 'Guides/Setup.md' });
	});

	it('reports "could not be determined" when no markdown file changed', async () => {
		changed(['Guides/assets/one.png']);

		// A successful answer rather than a failure — the caller's own
		// distinction, and the reason two of the three consumers refuse on it
		// instead of guessing.
		expect(await getMergeRequestChangedPath(DETAILS, 7)).toEqual({ ok: true, value: null });
	});

	it('reports "could not be determined" for two markdown files rather than picking one', async () => {
		changed(['Guides/Setup.md', 'Guides/Teardown.md']);

		expect(await getMergeRequestChangedPath(DETAILS, 7)).toEqual({ ok: true, value: null });
	});

	it('reports "could not be determined" for a merge request that changed nothing', async () => {
		changed([]);

		expect(await getMergeRequestChangedPath(DETAILS, 7)).toEqual({ ok: true, value: null });
	});

	it('reads a markdown extension whatever its case', async () => {
		changed(['Guides/Setup.MD', 'logo.png']);

		expect(await getMergeRequestChangedPath(DETAILS, 7)).toEqual({ ok: true, value: 'Guides/Setup.MD' });
	});

	it('keeps a failed lookup distinct from an undetermined path', async () => {
		restore = setRequestUrlHandler(() =>
			stubResponse({ status: 403, body: JSON.stringify({ message: 'denied' }) })
		);

		expect(await getMergeRequestChangedPath(DETAILS, 7)).toEqual({
			ok: false,
			failure: 'insufficient-permission',
		});
	});
});
