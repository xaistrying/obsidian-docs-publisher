/**
 * Derives the candidate `doc_id` from a note's filename at submit-confirm
 * time, ASCII-folding Vietnamese diacritics and validating the result as
 * git-ref-legal. See `docs/document-identity.md` §1 and §3.
 *
 * Returns null when the filename does not pass validation — the caller's
 * signal to refuse and tell the author to rename the file, before any
 * remote call. Takes Obsidian's `TFile.basename` (the name without its
 * extension) rather than `.name`: `doc_id` is an identifier, and a trailing
 * `.md` on every one is noise `basename` already strips for free — the
 * validation below would accept it either way, since `.md` breaks none of
 * the ref restrictions checked here.
 */
export function deriveDocId(basename: string): string | null {
	const folded = foldVietnameseDiacritics(basename);
	return isGitRefLegal(folded) ? folded : null;
}

/**
 * NFD-decomposes and strips combining diacritical marks, which covers most
 * Vietnamese diacritics. `đ`/`Đ` do not decompose under NFD — they are base
 * letters, not a letter-plus-mark pair — so they are folded explicitly.
 */
function foldVietnameseDiacritics(value: string): string {
	return value
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/đ/g, 'd')
		.replace(/Đ/g, 'D');
}

// eslint-disable-next-line no-useless-escape
const ILLEGAL_CHARACTERS = /[\s~^:?*[\\]/;

/**
 * No spaces, none of `~^:?*[\`, no leading dot, no trailing `.lock` — the
 * git ref restrictions this project validates against, per
 * `docs/document-identity.md` §1 and §3.
 */
function isGitRefLegal(value: string): boolean {
	if (value === '' || value.startsWith('.') || value.endsWith('.lock')) {
		return false;
	}
	return !ILLEGAL_CHARACTERS.test(value);
}
