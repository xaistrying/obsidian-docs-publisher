import { AUTHOR_MESSAGES } from '../author-messages';
import type { GitFailureKind, GitResult } from '../git-publishing/failures';
import { ADVANCED_KEYS, isUsableSettingValue, readLayers, removeVaultSetting, writeVaultSetting } from '../git-publishing/git-config';
import type { EffectiveSetting, SettingScope } from '../git-publishing/git-config';
import type { RepoContext } from '../git-publishing/repo';

/**
 * The Advanced section's logic, apart from drawing it
 * (replace-rest-with-local-git-ssh task 5.4, platform-config "Advanced git
 * settings can be set for this vault or returned to default").
 *
 * Three settings and no others, so nothing here can be asked to touch, or even
 * show, `init.defaultBranch`, `merge.*` or anything else the author-facing
 * vocabulary does not use; the list lives in `git-config.ts` and the reader
 * refuses any key not on it. A tick writes the value into this vault's own
 * settings and nothing else. Untick and "Back to default" remove it from this
 * vault, so the computer's or the system's value applies; those are shown and
 * never edited, and the computer's file is never opened for writing.
 *
 * None of these changes how documents are sent or received: the plugin forces
 * its own colour and pager settings on every command it runs, so these affect
 * only the author's own use of git in this vault.
 */
export type AdvancedKey = (typeof ADVANCED_KEYS)[number];

export interface AdvancedRow {
	key: AdvancedKey;
	/** The value that applies, and where it comes from; null when set nowhere. */
	effective: EffectiveSetting | null;
	/** Whether this vault has its own value, which is what the tick shows. */
	ticked: boolean;
	/** What the setting falls back to without this vault's value; null when nothing is set elsewhere. */
	fallback: EffectiveSetting | null;
}

export type AdvancedOutcome = { ok: true } | { ok: false; message: string } | { ok: false; failure: GitFailureKind };

const COLOUR_VALUES = ['true', 'false', 'always', 'auto', 'never'];

/** What a value may be for a setting. Colour takes git's own words; the other two name a program, as one line. */
export function isValidAdvancedValue(key: AdvancedKey, value: string): boolean {
	const trimmed = value.trim();
	return key === 'color.ui' ? COLOUR_VALUES.indexOf(trimmed) !== -1 : isUsableSettingValue(trimmed);
}

/** The label for where a value comes from, in the author's words. */
export function scopeLabel(scope: SettingScope): string {
	switch (scope) {
		case 'vault':
			return AUTHOR_MESSAGES.scopeVault;
		case 'computer':
			return AUTHOR_MESSAGES.scopeComputer;
		case 'system':
			return AUTHOR_MESSAGES.scopeSystem;
		case 'other':
			return '';
	}
}

/** One row from the layers a setting has. */
export function rowFrom(key: AdvancedKey, layers: readonly EffectiveSetting[]): AdvancedRow {
	const effective = layers.length === 0 ? null : layers[layers.length - 1];
	const ticked = effective !== null && effective.scope === 'vault';
	const below = ticked ? layers.slice(0, layers.length - 1) : layers;
	return { key, effective, ticked, fallback: below.length === 0 ? null : below[below.length - 1] };
}

export async function readAdvanced(ctx: RepoContext): Promise<GitResult<AdvancedRow[]>> {
	const rows: AdvancedRow[] = [];
	for (const key of ADVANCED_KEYS) {
		const layers = await readLayers(ctx, key);
		if (!layers.ok) {
			return layers;
		}
		rows.push(rowFrom(key, layers.value));
	}
	return { ok: true, value: rows };
}

/** Ticks a setting: writes the value into this vault's own settings. */
export async function setForVault(ctx: RepoContext, key: AdvancedKey, value: string): Promise<AdvancedOutcome> {
	if (!isValidAdvancedValue(key, value)) {
		return { ok: false, message: AUTHOR_MESSAGES.advancedInvalid };
	}
	const written = await writeVaultSetting(ctx, key, value);
	return written.ok ? { ok: true } : { ok: false, failure: written.failure };
}

/** Unticks it, or presses "Back to default": removes it from this vault so the value from elsewhere applies. */
export async function backToDefault(ctx: RepoContext, key: AdvancedKey): Promise<AdvancedOutcome> {
	const removed = await removeVaultSetting(ctx, key);
	return removed.ok ? { ok: true } : { ok: false, failure: removed.failure };
}
