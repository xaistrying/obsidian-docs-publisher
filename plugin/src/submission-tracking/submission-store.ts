import type { Plugin } from 'obsidian';
import type { EditBaseline, SubmissionRecord } from './submission-record';

/**
 * The two connection values remembered across restarts (persist-connection-
 * settings, 2026-09-30). There is deliberately no token field: the token is
 * session-only, and a field that does not exist cannot be written by a later
 * change that forgets the rule.
 */
interface SavedConnection {
	host: string;
	projectId: string;
}

interface PluginData {
	submissions: Record<string, SubmissionRecord>;
	// Optional so a `data.json` from before 2026-09-30 loads unchanged.
	connection?: SavedConnection;
}

function emptyData(): PluginData {
	return { submissions: {} };
}

/**
 * Persists one `SubmissionRecord` per `doc_id` to the plugin's own data
 * (`data.json`), plaintext by default per `openspec/config.yaml`'s storage
 * decision — this holds no credential, so that decision's objections don't
 * apply here. Never touches a note's front matter: submission state lives
 * only in plugin data, readable only through this store.
 *
 * Also holds the remembered address and project ID (2026-09-30). This store
 * is the ONLY writer of `data.json`: it rewrites the whole file on every
 * save, so a second writer keeping its own copy would erase this one's keys,
 * and this one would erase its (persist-connection-settings design.md
 * decision 1). If a third concern ever needs the file, extract a shared
 * owner then.
 */
class SubmissionStore {
	private data: PluginData = emptyData();
	private readonly listeners = new Set<() => void>();
	// Set when an unusable `data.json` could not be copied aside: the
	// original is then the only copy, and no save may reach it until
	// Obsidian restarts (guard-plugin-data, 2026-09-30).
	private holdWrites = false;

	constructor(private readonly plugin: Plugin) {}

	/**
	 * Loads persisted records. Call once, from `onload`, before first use.
	 *
	 * Says which of three things happened, for `onload` to tell the author
	 * (guard-plugin-data, 2026-09-30). An unusable `data.json` used to load as
	 * empty in silence, and the next save overwrote it — losing every imported
	 * document's "Published" state, which nothing on the remote can rebuild.
	 */
	async load(): Promise<'loaded' | 'recovered' | 'held'> {
		const raw: unknown = await this.plugin.loadData();
		if (isPluginData(raw)) {
			this.data = raw;
			// Validated apart from `isPluginData`, and dropped rather than fatal: a
			// bad `connection` rejecting the whole file would set every record
			// aside and start fresh, over two settings the author can retype
			// (persist-connection-settings decision 5, kept by guard-plugin-data
			// decision 5). Kept ones are rebuilt from the two named properties,
			// so nothing else a hand-edited file put under the key is written
			// back.
			const connection: unknown = this.data.connection;
			if (isSavedConnection(connection)) {
				this.data.connection = { host: connection.host, projectId: connection.projectId };
			} else {
				delete this.data.connection;
			}
			return 'loaded';
		}

		this.data = emptyData();
		// Missing is decided by the file's existence, not by `null` versus
		// `undefined`: that split rests on a minified Obsidian internal and an
		// unchecked mobile adapter, and getting it wrong would show a data-loss
		// warning on every first run (guard-plugin-data design.md decision 2).
		// `null` is Obsidian's answer for a missing file, and a file that
		// literally holds `null` has nothing to lose, so it counts as missing
		// without asking.
		if (raw === null) {
			return 'loaded';
		}

		const adapter = this.plugin.app.vault.adapter;
		const dir = this.plugin.manifest.dir;
		const dataPath = `${dir}/data.json`;
		// An `exists` that itself fails cannot prove the file absent, so it is
		// taken as present: a spurious notice is the safe way to be wrong.
		if (!(await adapter.exists(dataPath).catch(() => true))) {
			return 'loaded';
		}

		// `copy` moves bytes without parsing them, so it keeps bad JSON and a
		// bad shape alike. The timestamp keeps an earlier incident's copy from
		// being overwritten by a later one (decision 3).
		const backupPath = `${dir}/data-unreadable-${Date.now()}.json`;
		try {
			await adapter.copy(dataPath, backupPath);
		} catch (error) {
			// The original stays the only copy, so nothing may overwrite it
			// this session (decision 4).
			this.holdWrites = true;
			console.error(`Docs Publisher: could not copy unusable ${dataPath}; saving is off until restart`, error);
			return 'held';
		}

		console.error(`Docs Publisher: unusable ${dataPath} copied to ${backupPath}`);
		// Written straight away so the next start-up finds a valid file: one
		// notice and one backup, not one per launch until the next save.
		await this.write();
		return 'recovered';
	}

	savedConnection(): SavedConnection | undefined {
		return this.data.connection;
	}

	/**
	 * Remembers the address and project ID. Builds the object from the two
	 * named properties and never spreads its argument: handed a full
	 * `ConnectionDetails`, `{ ...saved }` would copy the token into
	 * `data.json`, and the type checker would allow it (decision 2).
	 *
	 * Does not notify `onChange` listeners — no record changed.
	 */
	async saveConnection(saved: SavedConnection): Promise<void> {
		this.data.connection = { host: saved.host, projectId: saved.projectId };
		await this.write();
	}

	get(docId: string): SubmissionRecord | undefined {
		return this.data.submissions[docId];
	}

	/**
	 * Every persisted record, in no particular order. Added for
	 * add-document-recovery, whose orphaned-record list is this set minus
	 * whichever `doc_id`s the vault currently has notes for — a complement
	 * `get` alone cannot compute.
	 */
	allRecords(): SubmissionRecord[] {
		// `Object.values` needs a lib target this project's tsconfig does not
		// set (ES5/ES6/ES7 only) — `Object.keys` plus a map is available under
		// all three and says the same thing.
		return Object.keys(this.data.submissions).map((docId) => this.data.submissions[docId]);
	}

	async save(record: SubmissionRecord): Promise<void> {
		await this.saveMany([record]);
	}

	/**
	 * Replaces ONE document's edit baseline and nothing else. For Reset, which
	 * must leave state, branch and path exactly where they are — this takes no
	 * argument that could change them.
	 *
	 * `undefined` clears the baseline, which reads as not edited: a baseline
	 * that could not be captured is better absent than left describing a
	 * version of the note that was just overwritten. A document with no record
	 * gets none — there is no state to invent for it.
	 */
	async saveEditBaseline(docId: string, baseline: EditBaseline | undefined): Promise<void> {
		const record = this.data.submissions[docId];
		if (record === undefined) {
			return;
		}

		await this.saveMany([{ ...record, mtime: baseline }]);
	}

	/**
	 * Writes several records under ONE `saveData` call. Reconciliation
	 * corrects every document it resolved in a single pass, and saving each
	 * separately would write `data.json` once per document — the same file,
	 * rewritten whole, N times per refresh, with every intermediate write a
	 * point at which a crash leaves the store half-corrected.
	 */
	async saveMany(records: readonly SubmissionRecord[]): Promise<void> {
		if (records.length === 0) {
			return;
		}

		for (const record of records) {
			this.data.submissions[record.docId] = record;
		}
		await this.write();
		for (const listener of [...this.listeners]) {
			listener();
		}
	}

	/**
	 * Subscribes to every write, and returns the function that unsubscribes.
	 *
	 * The panel reads records to decide which section a document is in, and a
	 * write is not always accompanied by a note event: Send update writes
	 * nothing to the note, so the new baseline sat unseen and the document
	 * stayed under "Needs you" until the next Refresh (observed 2026-09-27,
	 * name-panel-sections-by-next-actor tasks.md 4.3).
	 */
	onChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/**
	 * The ONE place `data.json` is written. Everything else changes memory
	 * and calls this, so holding writes is a single check here, not one in
	 * each caller — and in-memory state and `onChange` listeners carry on
	 * normally for the session while writes are held (decision 4).
	 */
	private async write(): Promise<void> {
		if (this.holdWrites) {
			return;
		}
		await this.plugin.saveData(this.data);
	}
}

/**
 * Recognises a usable `data.json`: an object holding a `submissions` object.
 * Checks the top-level shape only. Whether an unrecognised file is absent or
 * unusable is decided in `load()`, not here (guard-plugin-data, 2026-09-30).
 */
function isPluginData(value: unknown): value is PluginData {
	return (
		typeof value === 'object' &&
		value !== null &&
		typeof (value as { submissions?: unknown }).submissions === 'object' &&
		(value as { submissions?: unknown }).submissions !== null
	);
}

function isSavedConnection(value: unknown): value is SavedConnection {
	return (
		typeof value === 'object' &&
		value !== null &&
		typeof (value as { host?: unknown }).host === 'string' &&
		typeof (value as { projectId?: unknown }).projectId === 'string'
	);
}

export { SubmissionStore };
export type { SavedConnection };
