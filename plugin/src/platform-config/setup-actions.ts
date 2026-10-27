import type { SetupController } from './setup-controller';
import type { SetupControlId } from './setup-view';

/** Where an author who has no git is sent. Git's own download page: it names the right installer for the platform. */
export const GIT_DOWNLOAD_URL = 'https://git-scm.com/downloads';

/**
 * What a surface hands over so a control can do its work without the surface
 * knowing how. `openSettings` and `openUrl` are Obsidian's.
 */
export interface SetupActionTargets {
	controller: Pick<SetupController, 'checkAgain' | 'createKey' | 'copyKey' | 'testKey' | 'openGitLabKeys' | 'connect'>;
	openSettings: () => void;
	openUrl: (url: string) => void;
}

/**
 * The one table of which operation each setup control starts, used by the
 * panel and the settings tab alike. Long-running ones are started and not
 * awaited: the slot inside the controller already refuses a second press, and
 * the control re-labels itself from the holder when it changes.
 */
export function pressSetupControl(id: SetupControlId, targets: SetupActionTargets): void {
	switch (id) {
		case 'getGit':
			targets.openUrl(GIT_DOWNLOAD_URL);
			return;
		case 'checkAgain':
			void targets.controller.checkAgain();
			return;
		case 'openSettings':
			targets.openSettings();
			return;
		case 'createKey':
			void targets.controller.createKey();
			return;
		case 'copyKey':
			void targets.controller.copyKey();
			return;
		case 'openGitLab':
			targets.controller.openGitLabKeys();
			return;
		case 'test':
			void targets.controller.testKey();
			return;
		case 'connect':
			void targets.controller.connect();
			return;
	}
}
