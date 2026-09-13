/**
 * Which files a note embeds, resolved to vault paths.
 *
 * PURE LOGIC OVER AN INTERFACE, and that is the design decision rather than a
 * style preference (design.md decision 2). Nothing here takes `App`, reads a
 * file, or touches the network — it asks three questions of something
 * cache-shaped and returns paths. That is what makes the hardest part of
 * add-attachment-sync testable with a fake and no Obsidian at all; the
 * adapter that backs this interface with the real `app.metadataCache` and
 * `app.vault` lives in `vault-attachments.ts`.
 */

/** One embed exactly as Obsidian's metadata cache records it. */
export interface EmbedReference {
	/**
	 * The link target as written. For `![[image.png]]` this is a FILE NAME and
	 * not a path; for `![alt](assets/image.png)` it is the path, possibly
	 * percent-encoded.
	 */
	link: string;
	/** The embed's raw source text, which is the only thing that says which form it is. */
	original: string;
}

/**
 * The three reads resolution needs, and nothing else.
 *
 * Deliberately answers in PATHS rather than in `TFile`s. A test's fake is then
 * a few lines over a plain object, and the `obsidian` stub stays small enough
 * to keep its promise not to become a second Obsidian.
 */
export interface VaultEmbedIndex {
	/** The embeds Obsidian recorded for the note at this path, in document order. */
	embedsFor(notePath: string): readonly EmbedReference[];
	/**
	 * Obsidian's OWN wikilink resolution (`metadataCache.getFirstLinkpathDest`),
	 * which is the only thing that knows the shortest-path rule. Null when the
	 * link resolves to nothing.
	 */
	resolveLinkpath(linkpath: string, fromNotePath: string): string | null;
	/** The path of the file at exactly this vault path, or null when there is none. */
	fileAt(path: string): string | null;
}

/**
 * Every attachment the note at `notePath` embeds, de-duplicated, in the order
 * the embeds appear.
 *
 * NEVER THROWS AND NEVER REPORTS A FAILURE. An embed that resolves to nothing
 * is skipped and the caller carries on, because a broken link in the author's
 * own note is not a reason to refuse their submission — refusing would make a
 * typo block a document from publishing (design.md decision 2).
 */
export function resolveEmbeddedAttachments(notePath: string, index: VaultEmbedIndex): string[] {
	const found: string[] = [];
	const seen = new Set<string>();

	for (const embed of index.embedsFor(notePath)) {
		const resolved = resolveOne(notePath, embed, index);
		if (resolved === null || seen.has(resolved)) {
			continue;
		}

		seen.add(resolved);
		found.push(resolved);
	}

	return found;
}

/**
 * One embed, or null for every reason an embed is skipped: it resolves to
 * nothing, it points outside the vault, it points at the note itself, or it
 * names another NOTE rather than an attachment.
 *
 * That last exclusion is load-bearing and easy to mistake for tidiness.
 * Transclusion — `![[Other Document]]` — is out of scope project-wide, and
 * `getMergeRequestChangedPath` depends on that being true of what is actually
 * committed: its rule is "exactly one markdown file", so a submission that
 * carried a second note would make its own document's path unresolvable and
 * take the path-mismatch check, Reset and recovery's fallback down with it.
 * Skipping markdown here is what keeps that rule exact (design.md decision 1).
 */
function resolveOne(notePath: string, embed: EmbedReference, index: VaultEmbedIndex): string | null {
	const resolved = isWikilink(embed) ? resolveWikilink(notePath, embed, index) : resolveMarkdownLink(notePath, embed, index);
	if (resolved === null || resolved === notePath || isMarkdown(resolved)) {
		return null;
	}

	return resolved;
}

/**
 * The embed's raw text is what distinguishes the two forms; the `link` field
 * alone cannot, because `image.png` is a legal value for either. Obsidian
 * records the leading `!` in `original` for both, so the `[[` is the whole
 * test.
 */
function isWikilink(embed: EmbedReference): boolean {
	return embed.original.trimStart().startsWith('![[');
}

/**
 * A wikilink names a FILE, not a location, so it goes through the vault's own
 * resolver and never through anything that matches a filename out of the
 * note's text. Two folders holding a `diagram.png` is the ordinary case that
 * breaks hand-rolled matching, and the resolver is the only thing that knows
 * which of them THIS note means.
 */
function resolveWikilink(notePath: string, embed: EmbedReference, index: VaultEmbedIndex): string | null {
	const linkpath = stripSubpath(embed.link);
	if (linkpath === '') {
		return null;
	}

	return index.resolveLinkpath(linkpath, notePath);
}

/**
 * A markdown link carries a path already, so it is resolved AS a path —
 * relative to the note's own folder — and then confirmed to exist. It does
 * not fall back to the shortest-path rule: the author wrote a location, and
 * quietly publishing a same-named file from somewhere else would not be
 * resolution, it would be a substitution.
 */
function resolveMarkdownLink(notePath: string, embed: EmbedReference, index: VaultEmbedIndex): string | null {
	const target = decodeLink(stripSubpath(embed.link));
	if (target === '' || isExternal(target)) {
		return null;
	}

	const joined = join(folderOf(notePath), target);
	if (joined === null) {
		return null;
	}

	// An embed the vault holds no file for is skipped, whether that is a typo,
	// a file since deleted, or a path that resolved to a folder.
	return index.fileAt(joined);
}

/**
 * `![[image.png|300]]` and `![](doc.pdf#page=2)` both carry a suffix that is
 * display instruction rather than location. Obsidian strips the wikilink's
 * `|alias` into `displayText` before this sees it; the `#` fragment it does
 * not, so it is cut here.
 */
function stripSubpath(link: string): string {
	const hash = link.indexOf('#');
	const withoutFragment = hash === -1 ? link : link.slice(0, hash);
	return withoutFragment.trim();
}

/**
 * A markdown link's path is percent-encoded when it holds a space or any
 * other character a URL reserves. Malformed encoding degrades to the raw text
 * rather than throwing — the existence check below is what decides either way,
 * and no path that fails to decode is going to match a real file anyway.
 */
function decodeLink(link: string): string {
	try {
		return decodeURIComponent(link);
	} catch {
		return link;
	}
}

/**
 * Anything addressed by scheme or protocol-relative URL is not in the vault
 * and never becomes a committed file. Checked before the path arithmetic
 * below, which would otherwise turn `https://example.com/a.png` into a
 * nonsense vault path that simply fails to exist — the same outcome by
 * accident rather than on purpose.
 */
function isExternal(target: string): boolean {
	return /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//');
}

function folderOf(notePath: string): string {
	const slash = notePath.lastIndexOf('/');
	return slash === -1 ? '' : notePath.slice(0, slash);
}

function isMarkdown(path: string): boolean {
	return /\.md$/i.test(path);
}

/**
 * Joins a relative link to the note's folder, resolving `.` and `..`.
 *
 * Returns null when the result would climb ABOVE the vault root — an embed
 * pointing outside the vault, which is skipped rather than carried. A leading
 * `/` is read as vault-absolute, which is how Obsidian itself reads one.
 */
function join(folder: string, target: string): string | null {
	const base = target.startsWith('/') ? [] : folder === '' ? [] : folder.split('/');
	const segments = [...base];

	for (const segment of target.split('/')) {
		if (segment === '' || segment === '.') {
			continue;
		}

		if (segment === '..') {
			if (segments.length === 0) {
				return null;
			}
			segments.pop();
			continue;
		}

		segments.push(segment);
	}

	return segments.length === 0 ? null : segments.join('/');
}
