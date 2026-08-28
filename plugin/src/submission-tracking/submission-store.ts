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

	async save(record: SubmissionRecord): Promise<void> {
		this.data.submissions[record.docId] = record;
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
