import { describe, expect, it, vi } from 'vitest';
import type { App, TFile } from 'obsidian';
import { AUTHOR_MESSAGES } from '../src/author-messages';
import { completeNote, submitFailureMessage } from '../src/doc-authoring/submit-document';
import type { GitFailureKind } from '../src/git-publishing/failures';
import { setupMessageFor } from '../src/platform-config/setup-messages';

describe('what a failed send tells the author', () => {
	it('says the server\'s rules forbid it, and who to ask', () => {
		expect(submitFailureMessage('not-allowed')).toEqual({ message: AUTHOR_MESSAGES.notAllowed, setup: false });
		expect(AUTHOR_MESSAGES.notAllowed).toContain('Ask your admin for Developer access.');
	});

	it('says someone changed it meanwhile, and to get updates', () => {
		expect(submitFailureMessage('changed-meanwhile')).toEqual({ message: AUTHOR_MESSAGES.changedWhileSending, setup: false });
		expect(AUTHOR_MESSAGES.changedWhileSending).toContain('Get updates, then send again.');
	});

	for (const kind of ['key-rejected', 'key-protected', 'key-unreadable', 'host-changed', 'project-not-found', 'address-rewritten', 'git-missing', 'ssh-missing'] as GitFailureKind[]) {
		it(`sends ${kind} back to the setup step with that step's own message`, () => {
			expect(submitFailureMessage(kind)).toEqual({ message: setupMessageFor(kind), setup: true });
		});
	}

	// A retry cannot fix a key the server does not accept, so a setup problem is
	// never described as a connection problem.
	it('does not call a refused key a connection problem', () => {
		expect(submitFailureMessage('key-rejected').message).not.toBe(AUTHOR_MESSAGES.submitFailed);
	});

	for (const kind of ['server-unreachable', 'timed-out', 'unexpected', 'empty-repository', 'identity-missing'] as GitFailureKind[]) {
		it(`tells ${kind} the one undifferentiated thing, which names no cause`, () => {
			const said = submitFailureMessage(kind);
			if (kind === 'identity-missing') {
				// Its own step: the name and email.
				expect(said.setup).toBe(true);
				return;
			}
			expect(said).toEqual({ message: AUTHOR_MESSAGES.submitFailed, setup: false });
		});
	}

	it('never advises renaming the file as a remedy for a failure', () => {
		for (const kind of ['server-unreachable', 'timed-out', 'unexpected'] as GitFailureKind[]) {
			expect(submitFailureMessage(kind).message).not.toMatch(/rename/i);
		}
	});
});

describe('completing the note after a send', () => {
	function fakeApp(current: string): { app: Pick<App, 'vault'>; text: () => string; process: ReturnType<typeof vi.fn> } {
		let text = current;
		const process = vi.fn(async (_file: TFile, fn: (data: string) => string) => {
			text = fn(text);
			return text;
		});
		return { app: { vault: { process } } as unknown as Pick<App, 'vault'>, text: () => text, process };
	}
	const file = { path: 'a.md' } as TFile;

	it('writes exactly what was committed, when the note is as it was read', async () => {
		const fake = fakeApp('before');

		const written = await completeNote(fake.app, file, 'before', 'before, with an identity');

		expect(written).toBe(true);
		expect(fake.text()).toBe('before, with an identity');
	});

	it('leaves the note alone when the author kept typing during the push', async () => {
		const fake = fakeApp('before, and more typed meanwhile');

		const written = await completeNote(fake.app, file, 'before', 'before, with an identity');

		expect(written).toBe(false);
		expect(fake.text()).toBe('before, and more typed meanwhile');
	});

	it('writes nothing when the committed text is the note\'s own, as for an update', async () => {
		const fake = fakeApp('same');

		expect(await completeNote(fake.app, file, 'same', 'same')).toBe(false);
		expect(fake.process).not.toHaveBeenCalled();
	});

	it('does not throw when the write fails, and says it did not write', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const app = { vault: { process: async () => { throw new Error('disk full'); } } } as unknown as Pick<App, 'vault'>;

		await expect(completeNote(app, file, 'a', 'b')).resolves.toBe(false);
	});
});
