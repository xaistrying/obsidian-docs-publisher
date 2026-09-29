import { afterEach, describe, expect, it } from 'vitest';
// From the stub by path rather than through the `obsidian` specifier — see
// the note in `submission-files.test.ts`.
import { setRequestUrlHandler, stubResponse } from './obsidian-stub';
import { getCurrentUser } from '../src/git-publishing/gitlab-client';

/**
 * The identity read reports a missing permission AS one.
 *
 * `docs/ce-verification.md` §D0g: a token holding no `User: Read` produced
 * "That project could not be found, or your access does not include it",
 * sending the author to check a project path that was correct. The project was
 * never the problem — `GET /user` was refused, and GitLab named the permission
 * in the body.
 *
 * WHY IT SAID THAT: this read used `classifyStatus`, which folds 403 into
 * `not-reachable` so an invisible project and a missing one read alike. That
 * fold is right for `GET /projects/:id` and pointless here, because there is
 * no project in this request whose existence could leak — and the fold also
 * suppressed the name, since the detail is only extracted for
 * `insufficient-permission`, a kind `classifyStatus` cannot produce.
 *
 * This is the first call "Test connection" makes, and `User: Read` sits on the
 * token screen's User tab rather than Group and project, which §A2.10 flags as
 * the one most likely to be missed. So the most likely first-run failure there
 * is pointed at the wrong thing.
 */

const DETAILS = { host: 'https://gitlab.example.com', projectId: 'group/proj', token: 'x' };

const GRANULAR_REFUSAL = JSON.stringify({
	error: 'insufficient_granular_scope',
	error_description:
		'Access denied: This operation requires a fine-grained personal access token with the ' +
		'following user permissions: [User: Read].',
});

let restore: (() => void) | null = null;

afterEach(() => {
	restore?.();
	restore = null;
});

function answering(status: number, body: string): void {
	restore = setRequestUrlHandler(() => stubResponse({ status, body }));
}

describe('reading the account a token belongs to', () => {
	it('reports a refused read as a missing permission, not an unreachable project', async () => {
		answering(403, GRANULAR_REFUSAL);

		const result = await getCurrentUser(DETAILS);

		expect(result.ok).toBe(false);
		// `not-reachable` here is the bug: it renders as "that project could
		// not be found" for an author whose project path is correct.
		expect(result.ok === false && result.failure).toBe('insufficient-permission');
	});

	it('carries the permission name GitLab reported, so the message can say which', async () => {
		answering(403, GRANULAR_REFUSAL);

		const result = await getCurrentUser(DETAILS);

		expect(result.ok === false && result.detail).toBe('User: Read');
	});

	it('carries no name when the refusal names none, rather than inventing one', async () => {
		answering(403, JSON.stringify({ message: '403 Forbidden' }));

		const result = await getCurrentUser(DETAILS);

		expect(result.ok === false && result.failure).toBe('insufficient-permission');
		// An invented name would send someone to tick the wrong box, so the
		// parenthetical is dropped entirely instead.
		expect(result.ok === false && result.detail).toBeUndefined();
	});

	it('still reports a rejected credential as one', async () => {
		answering(401, JSON.stringify({ message: '401 Unauthorized' }));

		const result = await getCurrentUser(DETAILS);

		// The expiry path (`docs/ce-verification.md` §D6a) must not be
		// disturbed by the reclassification: 401 is what "Your access has
		// expired" is built on, and it is produced by status alone.
		expect(result.ok === false && result.failure).toBe('rejected-credential');
	});

	it('reads an identity when the token is permitted', async () => {
		answering(200, JSON.stringify({ id: 7, name: 'Trai Pham', username: 'trai' }));

		const result = await getCurrentUser(DETAILS);

		expect(result.ok && result.value).toEqual({ id: 7, name: 'Trai Pham', username: 'trai' });
	});

	it('refuses a body that is not an identity rather than inventing one', async () => {
		answering(200, JSON.stringify({ id: 'seven' }));

		const result = await getCurrentUser(DETAILS);

		expect(result.ok === false && result.failure).toBe('unexpected');
	});
});
