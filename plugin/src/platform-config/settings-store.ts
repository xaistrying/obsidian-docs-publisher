import type { Plugin } from 'obsidian';
import { GITLAB_USERNAME } from '../git-publishing/project-address';

/**
 * What setup remembers across restarts (replace-rest-with-local-git-ssh,
 * platform-config "The plugin stores no secret"): where the project is, which
 * key is used, whose key it is, and which key and address the last successful
 * test covered. Every field is plain text the author could read in the
 * settings tab; none is, or can hold, a password or key material — the key is
 * a PATH, and a field that does not exist cannot be written by a later change
 * that forgets the rule.
 */
export interface SavedSetup {
	projectAddress?: string;
	keyPath?: string;
	username?: string;
	testedFor?: { keyPath: string; address: string };
}

type Patch = { [K in keyof SavedSetup]?: SavedSetup[K] | undefined };

const SETUP_KEY = 'setup';
const FIELDS = ['projectAddress', 'keyPath', 'username', 'testedFor'] as const;

/**
 * The plugin's own settings, kept in `data.json`
 * (replace-rest-with-local-git-ssh design.md D13). It is the file's only
 * writer, because the file is rewritten whole on every save and a second
 * writer keeping its own copy would erase this one's keys.
 *
 * Starts from whatever the file holds. A missing, empty, truncated or
 * unexpected file starts from defaults with no error, because nothing in it is
 * irreplaceable now: the address is also in `.git/config`, and the name and
 * email are git settings. Keys an earlier version left (its records, its
 * remembered connection) are not read and are never removed: saving merges this
 * plugin's values into what was loaded, so an earlier version can be reinstalled.
 */
export class SettingsStore {
	private data: Record<string, unknown> = {};

	constructor(private readonly plugin: Plugin) {}

	async load(): Promise<void> {
		let raw: unknown = null;
		try {
			raw = await this.plugin.loadData();
		} catch (error) {
			// A file that cannot be parsed starts the plugin from defaults.
			console.error('Docs Publisher: the saved settings could not be read; starting from defaults', error);
		}
		this.data = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {};
	}

	/** A copy, so a caller cannot change what is saved without saving it. */
	savedSetup(): SavedSetup {
		return sanitizeSetup(this.data[SETUP_KEY]);
	}

	/**
	 * Remembers part of setup. A field given as `undefined` is forgotten, which
	 * is how a test result is discarded when the address or key changes. Built
	 * from the named fields and never spread, so an argument carrying more than
	 * it should cannot reach the file.
	 */
	async saveSetup(patch: Patch): Promise<void> {
		const next = sanitizeSetup(this.data[SETUP_KEY]);
		for (const key of FIELDS) {
			if (key in patch) {
				if (patch[key] === undefined) {
					delete next[key];
				} else {
					Object.assign(next, { [key]: patch[key] });
				}
			}
		}
		const clean = sanitizeSetup(next);
		if (Object.keys(clean).length > 0) {
			this.data[SETUP_KEY] = clean;
		} else {
			delete this.data[SETUP_KEY];
		}
		await this.plugin.saveData(this.data);
	}
}

/**
 * Keeps only the fields of `SavedSetup` that are present and well-formed, and
 * only those. Never throws: what a hand-edited file puts here is dropped, not
 * trusted and not fatal — the author can retype an address.
 */
export function sanitizeSetup(value: unknown): SavedSetup {
	const clean: SavedSetup = {};
	if (typeof value !== 'object' || value === null) {
		return clean;
	}
	const raw = value as Record<string, unknown>;
	if (typeof raw.projectAddress === 'string' && raw.projectAddress !== '') {
		clean.projectAddress = raw.projectAddress;
	}
	if (typeof raw.keyPath === 'string' && raw.keyPath !== '') {
		clean.keyPath = raw.keyPath;
	}
	// A name that is not GitLab's alphabet is dropped, so the author is asked
	// for it again: it becomes the owner written into every new document.
	if (typeof raw.username === 'string' && GITLAB_USERNAME.test(raw.username)) {
		clean.username = raw.username;
	}
	const tested = raw.testedFor;
	if (
		typeof tested === 'object' &&
		tested !== null &&
		typeof (tested as { keyPath?: unknown }).keyPath === 'string' &&
		typeof (tested as { address?: unknown }).address === 'string'
	) {
		clean.testedFor = {
			keyPath: (tested as { keyPath: string }).keyPath,
			address: (tested as { address: string }).address,
		};
	}
	return clean;
}
