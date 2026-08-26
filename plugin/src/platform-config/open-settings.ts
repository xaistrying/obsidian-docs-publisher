import { Notice } from 'obsidian';
import type { App } from 'obsidian';

export const MANUAL_SETTINGS_MESSAGE =
	'Open Settings, then choose Docs Publisher under Community plugins.';

/**
 * Obsidian's settings screen has no public API. Verified against
 * `obsidian@1.13.1`: `App` exposes neither a `setting` member nor a
 * `commands` one, so reaching it needs a cast to an undocumented surface —
 * the only cast in this plugin.
 */
interface UndocumentedSettings {
	open?: () => void;
	openTabById?: (id: string) => void;
}

/**
 * Sends the author to this plugin's settings tab, addressing it by the
 * manifest `id`.
 *
 * Both methods are checked before either is called, because this call's
 * failure mode is silence: an Obsidian update can remove them with no typing
 * error and no exception, leaving a button that does nothing. That is
 * tolerable on most buttons and not on this one — it is the only exit from
 * the state every author sees on every launch — so the fallback names the
 * manual path instead.
 */
export function openSettingsTab(app: App, pluginId: string): void {
	const settings = (app as App & { setting?: UndocumentedSettings }).setting;

	// Checked through optional chaining rather than against `undefined`: the
	// point of the guard is that this surface's shape is not ours to predict,
	// so a `null` there must reach the notice too, not throw on the way.
	if (
		typeof settings?.open !== 'function' ||
		typeof settings.openTabById !== 'function'
	) {
		new Notice(MANUAL_SETTINGS_MESSAGE);
		return;
	}

	settings.open();
	settings.openTabById(pluginId);
}
