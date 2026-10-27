import { describe, expect, it, vi } from 'vitest';
import { GIT_DOWNLOAD_URL, pressSetupControl } from '../src/platform-config/setup-actions';
import type { SetupActionTargets } from '../src/platform-config/setup-actions';
import type { SetupControlId } from '../src/platform-config/setup-view';

/**
 * Which operation each control starts. The panel and the settings tab both draw
 * the same controls and both press them through here, so this one table is the
 * answer to "does the Test button test" for both of them.
 */
function targets() {
	const calls: string[] = [];
	const t: SetupActionTargets = {
		controller: {
			checkAgain: vi.fn(async () => void calls.push('checkAgain')),
			createKey: vi.fn(async () => void calls.push('createKey')),
			copyKey: vi.fn(async () => void calls.push('copyKey')),
			testKey: vi.fn(async () => void calls.push('testKey')),
			openGitLabKeys: vi.fn(() => void calls.push('openGitLabKeys')),
			connect: vi.fn(async () => void calls.push('connect')),
		},
		openSettings: vi.fn(() => void calls.push('openSettings')),
		openUrl: vi.fn((url: string) => void calls.push(`openUrl ${url}`)),
	};
	return { t, calls };
}

describe('pressing a setup control', () => {
	const cases: Array<[SetupControlId, string]> = [
		['getGit', `openUrl ${GIT_DOWNLOAD_URL}`],
		['checkAgain', 'checkAgain'],
		['openSettings', 'openSettings'],
		['createKey', 'createKey'],
		['copyKey', 'copyKey'],
		['openGitLab', 'openGitLabKeys'],
		['test', 'testKey'],
		['connect', 'connect'],
	];

	for (const [id, expected] of cases) {
		it(`${id} does ${expected} and nothing else`, () => {
			const { t, calls } = targets();

			pressSetupControl(id, t);

			expect(calls).toEqual([expected]);
		});
	}

	it('sends Get Git to a page that exists', () => {
		expect(GIT_DOWNLOAD_URL).toMatch(/^https:\/\/git-scm\.com\//);
	});

	it('passes both presses of one control on, leaving the busy slot to refuse the second', () => {
		const { t, calls } = targets();

		pressSetupControl('test', t);
		pressSetupControl('test', t);

		// The slot, not this function, refuses the second; this only passes the
		// press on. Both reach the controller, which is what the slot guards.
		expect(calls).toEqual(['testKey', 'testKey']);
	});
});
