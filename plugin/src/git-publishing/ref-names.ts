/**
 * Names of the refs the plugin reads and writes, and the one check that a
 * document's identity may be put in one (replace-rest-with-local-git-ssh
 * design.md D16, `docs/document-identity.md` §1).
 *
 * A `doc_id` is the filename of a note, written by an author or received from
 * someone else, and it goes into a ref name and so into a command. git's own
 * rules for what a ref may contain are the rules here, written out, because a
 * name that breaks them either fails confusingly or, worse, means something
 * else to git than it did to us (`..`, `@{`, a leading dash).
 */

/** The last synced version of the project: a commit whose tree is the per-path state. */
export const SYNCED_REF = 'refs/docs-publisher/synced';
/** The commit connecting recorded, so "the first update" can be told from git. */
export const CONNECTED_REF = 'refs/docs-publisher/connected';

const SENT_PREFIX = 'refs/docs-publisher/sent/';
const REMOTE_PREFIX = 'refs/remotes/origin/';

// eslint-disable-next-line no-control-regex
const ILLEGAL = /[\u0000- \u007f~^:?*[\\]/;

/**
 * Whether a value may be one part of a ref name. Stricter than the
 * filename rule an author sees (no spaces and none of `~^:?*[\`), because it is
 * also applied to identities that arrived from somewhere else.
 */
export function isValidRefPart(value: string): boolean {
	if (value === '' || value.length > 200) {
		return false;
	}
	return (
		!ILLEGAL.test(value) &&
		value.indexOf('..') === -1 &&
		value.indexOf('@{') === -1 &&
		value.indexOf('//') === -1 &&
		value !== '@' &&
		value[0] !== '.' &&
		value[0] !== '-' &&
		value[0] !== '/' &&
		!/[./]$/.test(value) &&
		!/\.lock(\/|$)/.test(value) &&
		!/(^|\/)\./.test(value)
	);
}

function checked(id: string): string {
	if (!isValidRefPart(id)) {
		throw new Error(`Docs Publisher: "${id}" is not usable in a ref name`);
	}
	return id;
}

/** Where this vault records the last commit it built for a document. */
export function sentRef(docId: string): string {
	return `${SENT_PREFIX}${checked(docId)}`;
}

/** The fetched copy of a document's branch. */
export function fetchedBranchRef(docId: string): string {
	return `${REMOTE_PREFIX}doc/${checked(docId)}`;
}

/** The fetched copy of the project's default branch. */
export function fetchedDefaultRef(defaultBranch: string): string {
	return `${REMOTE_PREFIX}${checked(defaultBranch)}`;
}

/** The document branch's name on the remote. */
export function documentBranch(docId: string): string {
	return `doc/${checked(docId)}`;
}

/** What `sentRef` hides, for listing: the part after the prefix, or null if the ref is not one. */
export function docIdOfSentRef(ref: string): string | null {
	return ref.indexOf(SENT_PREFIX) === 0 ? ref.slice(SENT_PREFIX.length) : null;
}

export const SENT_REF_PREFIX = SENT_PREFIX;

/**
 * Folders the plugin never reads, writes or compares, whatever the project
 * holds there (vault-sync "touches the settings folder and the repository
 * folder only as named").
 */
export function isReservedPath(path: string): boolean {
	return (
		path === '.obsidian' ||
		path === '.git' ||
		path.indexOf('.obsidian/') === 0 ||
		path.indexOf('.git/') === 0
	);
}

/**
 * A path with a hidden part: a file or folder whose name starts with a dot.
 * Obsidian does not index these and its file API will not write them, so a
 * settings folder another tool committed to the project (`.claudian/`, say)
 * could never be saved here, and would stay "an update" for ever. The plugin
 * therefore never compares, counts or downloads one.
 */
export function isHiddenPath(path: string): boolean {
	return path.split('/').some((part) => part.length > 1 && part[0] === '.') || path[0] === '.';
}
