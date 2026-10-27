import { describe, expect, it } from 'vitest';
import { AUTHOR_MESSAGES } from '../src/author-messages';
import { updateFailureMessage } from '../src/vault-sync/update-report';

/** What a failed update says, and whether it sends the author back to the checklist. */
describe('what a failed update tells the author', () => {
	it('sends a key problem back to setup, in its own words', () => {
		expect(updateFailureMessage('key-rejected')).toEqual({ message: AUTHOR_MESSAGES.keyRejected, setup: true });
	});

	it('sends a missing git back to setup', () => {
		expect(updateFailureMessage('git-missing')).toEqual({ message: AUTHOR_MESSAGES.gitMissing, setup: true });
	});

	it('names no cause for an unreachable server, and does not send the author to setup', () => {
		expect(updateFailureMessage('server-unreachable')).toEqual({ message: AUTHOR_MESSAGES.updateFailed, setup: false });
	});

	it('says the same for a timeout and for a failure nobody classified', () => {
		expect(updateFailureMessage('timed-out')).toEqual({ message: AUTHOR_MESSAGES.updateFailed, setup: false });
		expect(updateFailureMessage('unexpected')).toEqual({ message: AUTHOR_MESSAGES.updateFailed, setup: false });
	});
});
