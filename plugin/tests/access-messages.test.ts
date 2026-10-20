import { describe, expect, it } from 'vitest';
import { EXPIRED_TOKEN_MESSAGE, tokenPermissionMessage } from '../src/platform-config/access-messages';
import { failureMessage, SUBMIT_FAILED_MESSAGE } from '../src/doc-authoring/submit-document';

/**
 * Authors create their own tokens and a token's permissions cannot be edited,
 * so every token message names what the author does, never an admin
 * (self-service-token-messages).
 */
describe('token messages', () => {
	it('names the permission when the platform did, and points at settings when it did not', () => {
		expect(tokenPermissionMessage('submit documents', 'Merge Request: Create')).toBe(
			"Your access token doesn't have permission to submit documents (missing: Merge Request: Create). " +
				'Create a new access token that includes it.'
		);
		expect(tokenPermissionMessage('submit documents', undefined)).toBe(
			"Your access token doesn't have permission to submit documents. " +
				"Create a new access token with the permissions listed in the plugin's settings."
		);
	});

	it('does not send the author to an admin for an expired token', () => {
		expect(EXPIRED_TOKEN_MESSAGE).not.toMatch(/admin/i);
	});

	it('reports a rejected token during submit as expired, not as a reason to submit again', () => {
		expect(failureMessage({ failure: 'rejected-credential' })).toBe(EXPIRED_TOKEN_MESSAGE);
		expect(failureMessage({ failure: 'rejected-credential' }, 'A step message.')).toBe(EXPIRED_TOKEN_MESSAGE);
		expect(failureMessage({ failure: 'unexpected' })).toBe(SUBMIT_FAILED_MESSAGE);
	});
});
