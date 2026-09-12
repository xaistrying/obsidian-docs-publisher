import type { Plugin } from 'obsidian';
import type { SubmissionRecord } from './submission-record';

interface PluginData {
	submissions: Record<string, SubmissionRecord>;
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
 */
class SubmissionStore {
	private data: PluginData = emptyData();

	constructor(private readonly plugin: Plugin) {}

	/** Loads persisted records. Call once, from `onload`, before first use. */
	async load(): Promise<void> {
		const raw: unknown = await this.plugin.loadData();
		this.data = isPluginData(raw) ? raw : emptyData();
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
		await this.plugin.saveData(this.data);
	}
}

/** Guards against `data.json` being absent, foreign, or corrupted. */
function isPluginData(value: unknown): value is PluginData {
	return (
		typeof value === 'object' &&
		value !== null &&
		typeof (value as { submissions?: unknown }).submissions === 'object' &&
		(value as { submissions?: unknown }).submissions !== null
	);
}

export { SubmissionStore };
