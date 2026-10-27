import { MarkdownView, normalizePath } from 'obsidian';
import type { App, TFile } from 'obsidian';
import type { VaultIO } from './get-updates';

/**
 * The real vault, behind the interface the update engine works through
 * (replace-rest-with-local-git-ssh task 4.1). Adapter code with no rule in it:
 * every decision lives in the engine, which is tested against a folder, so
 * nothing here is tested over a stubbed Obsidian.
 *
 * Notes are written through the vault's own file API, never the adapter, so an
 * open editor shows the new text. The plugin's own trash folder is the one
 * thing written through the adapter, because Obsidian's file API does not
 * index dot-folders.
 */
const DECODER = new TextDecoder('utf-8', { fatal: true });
const ENCODER = new TextEncoder();
const PLUGIN_TRASH = '.trash/Docs Publisher';

/** The text, if these bytes are text that survives being a string and back unchanged. */
function asText(bytes: Uint8Array): string | null {
	try {
		const text = DECODER.decode(bytes);
		const back = ENCODER.encode(text);
		return back.length === bytes.length && back.every((byte, i) => byte === bytes[i]) ? text : null;
	} catch {
		return null;
	}
}

function toBuffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function ensureFolder(app: App, folder: string): Promise<void> {
	if (folder === '' || app.vault.getAbstractFileByPath(folder) !== null) {
		return;
	}
	await app.vault.createFolder(folder);
}

export function obsidianVault(app: App): VaultIO {
	let caseInsensitive: boolean | null = null;

	return {
		read: async (path) => {
			const file = app.vault.getFileByPath(normalizePath(path));
			return file === null ? null : new Uint8Array(await app.vault.readBinary(file));
		},

		write: async (path, bytes) => {
			const clean = normalizePath(path);
			const text = clean.toLowerCase().endsWith('.md') ? asText(bytes) : null;
			const existing = app.vault.getFileByPath(clean);
			if (existing !== null) {
				if (text !== null) {
					await app.vault.modify(existing, text);
				} else {
					await app.vault.modifyBinary(existing, toBuffer(bytes));
				}
				return;
			}
			await ensureFolder(app, clean.slice(0, Math.max(0, clean.lastIndexOf('/'))));
			if (text !== null) {
				await app.vault.create(clean, text);
			} else {
				await app.vault.createBinary(clean, toBuffer(bytes));
			}
		},

		// The vault's own trash folder, whatever the vault's setting for deleted
		// files says: `false` is "not the system trash", and not "as configured".
		trash: async (path) => {
			const file = app.vault.getFileByPath(normalizePath(path));
			if (file !== null) {
				await app.vault.trash(file, false);
			}
		},

		saveCopy: async (path, bytes, stamp) => {
			const destination = normalizePath(`${PLUGIN_TRASH}/${stamp}/${path}`);
			let folder = '';
			for (const part of destination.slice(0, destination.lastIndexOf('/')).split('/')) {
				folder = folder === '' ? part : `${folder}/${part}`;
				if (!(await app.vault.adapter.exists(folder))) {
					await app.vault.adapter.mkdir(folder);
				}
			}
			await app.vault.adapter.writeBinary(destination, toBuffer(bytes));
		},

		// "Open with unsaved changes" is the editor's text differing from the
		// file's text on disk; Obsidian exposes no flag the plugin can read.
		isUnsaved: async (path) => {
			const open = app.workspace.getLeavesOfType('markdown').filter((leaf) => {
				const view = leaf.view;
				return view instanceof MarkdownView && view.file !== null && view.file.path === path;
			});
			if (open.length === 0) {
				return false;
			}
			const onDisk = await app.vault.adapter.read(normalizePath(path));
			return open.some((leaf) => (leaf.view as MarkdownView).editor.getValue() !== onDisk);
		},

		allPaths: async () => app.vault.getFiles().map((file: TFile) => file.path),

		// Probed, not assumed from the platform: a Mac volume can be either, and so
		// can a network share. A file is written under one spelling and looked for
		// under another.
		caseInsensitive: async () => {
			if (caseInsensitive !== null) {
				return caseInsensitive;
			}
			const probe = `${PLUGIN_TRASH}/.case-probe`;
			try {
				if (!(await app.vault.adapter.exists(PLUGIN_TRASH))) {
					await app.vault.adapter.mkdir(PLUGIN_TRASH);
				}
				await app.vault.adapter.write(probe, 'probe');
				caseInsensitive = await app.vault.adapter.exists(probe.toUpperCase().replace('.TRASH/DOCS PUBLISHER', PLUGIN_TRASH.toUpperCase()));
				await app.vault.adapter.remove(probe);
			} catch {
				// Cannot tell: the cautious answer is "yes", which asks more often and overwrites nothing.
				caseInsensitive = true;
			}
			return caseInsensitive;
		},
	};
}
