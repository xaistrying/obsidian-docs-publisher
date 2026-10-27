import { normalizePath } from 'obsidian';
import type { App } from 'obsidian';
import type { VaultEmbedIndex } from './embeds';

/**
 * The vault's own answers to the three questions embed resolution asks.
 *
 * Everything Obsidian-shaped about attachments lives HERE, which is what keeps
 * `embeds.ts` free of `App` and therefore testable at all. Nothing in this file
 * is tested, and that is the trade being made deliberately: it is adapter code
 * with no rule in it.
 *
 * `getFirstLinkpathDest` is Obsidian's own resolver and is used rather than
 * anything that matches a filename out of the note's text — it is the only
 * thing that knows the shortest-path rule, which is what decides WHICH
 * `diagram.png` a note means when two folders hold one.
 */
export function vaultEmbedIndex(app: App): VaultEmbedIndex {
	return {
		embedsFor: (notePath) => app.metadataCache.getCache(notePath)?.embeds ?? [],
		resolveLinkpath: (linkpath, fromNotePath) =>
			app.metadataCache.getFirstLinkpathDest(linkpath, fromNotePath)?.path ?? null,
		fileAt: (path) => app.vault.getFileByPath(normalizePath(path))?.path ?? null,
	};
}
