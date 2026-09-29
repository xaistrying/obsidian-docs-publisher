import { describe, expect, it } from 'vitest';
import { needsAuthor, panelSection } from '../src/submission-tracking/document-status';
import type { SubmissionState } from '../src/submission-tracking/submission-record';

// `hasLocalEdits` is tested in `edit-baseline.test.ts`, against baselines the
// real capture writes rather than numbers typed in here.

describe('whether a document is waiting on the author', () => {
	const cases: Array<[string, SubmissionState | null, boolean, boolean]> = [
		['never submitted', null, false, true],
		['changes requested, untouched', 'changes-requested', false, true],
		['not accepted, untouched', 'closed', false, true],
		['pending and edited', 'pending', true, true],
		['published and edited', 'published', true, true],
		['pending, untouched — waiting on a reviewer', 'pending', false, false],
		['published, untouched — nothing to do', 'published', false, false],
		// The import regression, 2026-09-22: importing 25 documents put all 25
		// in "Your documents". An imported document has no merge request, so
		// the remote reports nothing and the STORE is the only thing that knows
		// it is published. Resolve state as remote ?? stored, and an untouched
		// import is reference rather than work.
		['imported and untouched, state read from the store', 'published', false, false],
	];

	for (const [name, state, edited, expected] of cases) {
		it(`${expected ? 'lists' : 'leaves out'} a document ${name}`, () => {
			expect(needsAuthor(state, edited)).toBe(expected);
		});
	}
});

describe('which panel section a document is listed in', () => {
	const cases: Array<[SubmissionState | null, boolean, ReturnType<typeof panelSection>]> = [
		// Unresolved stays with the author: "Waiting on reviewers" would assert
		// a review nothing established.
		[null, false, 'needs-you'],
		[null, true, 'needs-you'],
		['changes-requested', false, 'needs-you'],
		['changes-requested', true, 'needs-you'],
		['closed', false, 'needs-you'],
		['closed', true, 'needs-you'],
		['pending', true, 'needs-you'],
		// The case this section exists for: submitted and untouched moves
		// rather than vanishing.
		['pending', false, 'waiting-on-reviewers'],
		['published', true, 'needs-you'],
		// Settled, no next actor, not listed.
		['published', false, null],
	];

	for (const [state, edited, expected] of cases) {
		it(`puts ${state ?? 'unresolved'}${edited ? ', edited' : ', untouched'} in ${expected ?? 'no section'}`, () => {
			expect(panelSection(state, edited)).toBe(expected);
		});
	}
});
