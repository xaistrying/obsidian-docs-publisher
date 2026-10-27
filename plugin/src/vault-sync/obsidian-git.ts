/**
 * The Obsidian Git plugin, which can commit and push on a timer and so clash
 * with this one (replace-rest-with-local-git-ssh task 2.4, vault-sync "A vault
 * that is already a repository is adopted only when that is safe").
 *
 * Detected, never acted on: the author is told once per session, and nothing is
 * blocked or turned off for them.
 */
export const OBSIDIAN_GIT_ID = 'obsidian-git';

/** Whether the plugin is enabled, from the set of enabled plugin ids Obsidian keeps. Anything else is "no". */
export function isObsidianGitEnabled(enabledPlugins: unknown): boolean {
	if (enabledPlugins instanceof Set) {
		return enabledPlugins.has(OBSIDIAN_GIT_ID);
	}
	if (Array.isArray(enabledPlugins)) {
		return enabledPlugins.indexOf(OBSIDIAN_GIT_ID) !== -1;
	}
	return false;
}

/**
 * Says something at most once per session. `shouldWarn` is asked each time, so
 * a plugin enabled after the first connect is still reported, once.
 */
export class WarnOnce {
	private warned = false;

	constructor(
		private readonly shouldWarn: () => boolean,
		private readonly warn: () => void
	) {}

	check(): void {
		if (!this.warned && this.shouldWarn()) {
			this.warned = true;
			this.warn();
		}
	}
}
