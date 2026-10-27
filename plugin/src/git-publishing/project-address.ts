/**
 * The project an author points the plugin at, in the one form it can use.
 *
 * Everything here exists because the address reaches a process and a shell
 * string later on. It is checked when it is typed and checked again when it is
 * read back from `data.json` (a file anyone with access to the vault can edit),
 * and a value that fails is treated as not set, never repaired: an address
 * beginning with `-` would be read by ssh as an option, and one using the
 * `ext::` scheme would make git run a program. See
 * replace-rest-with-local-git-ssh design.md D12.
 */
export interface ProjectAddress {
	/** The form handed to git: `git@host:path.git`, or `ssh://git@host:port/path.git` off port 22. */
	sshUrl: string;
	host: string;
	/** Null for the default, 22. */
	port: number | null;
	/** `group/subgroup/project`, without `.git`. */
	path: string;
	/** Where the project's web pages are. Used only to build links; no request is made to it. */
	webBase: string;
}

const MAX_ADDRESS_LENGTH = 300;
const SSH_USER = 'git';

/** Letters, digits, dots and hyphens; no leading or trailing hyphen or dot, so it can never be read as an option. */
const HOST = /^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/;
/** A project path part: GitLab's own alphabet, and never a leading hyphen or dot. */
const PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function parsePort(text: string | undefined): number | null | undefined {
	if (text === undefined || text === '') {
		return null;
	}
	if (!/^[0-9]{1,5}$/.test(text)) {
		return undefined;
	}
	const port = Number(text);
	return port >= 1 && port <= 65535 ? port : undefined;
}

/** `a/b.git/` to `a/b`, or null when any part is not a valid project path part. Needs at least a group and a project. */
function cleanPath(raw: string): string | null {
	let path = raw.replace(/\/+$/, '');
	if (path.length > 4 && path.slice(-4) === '.git') {
		path = path.slice(0, -4);
	}
	const segments = path.split('/');
	if (segments.length < 2) {
		return null;
	}
	for (const segment of segments) {
		if (!PATH_SEGMENT.test(segment)) {
			return null;
		}
	}
	return path;
}

function build(host: string, port: number | null, path: string, webBase: string): ProjectAddress {
	const effectivePort = port === 22 ? null : port;
	const sshUrl =
		effectivePort === null
			? `${SSH_USER}@${host}:${path}.git`
			: `ssh://${SSH_USER}@${host}:${effectivePort}/${path}.git`;
	return { sshUrl, host, port: effectivePort, path, webBase };
}

/**
 * Reads what an author pasted from GitLab's Clone button, or anything that
 * already went through it. Accepted: `git@host:group/project(.git)`,
 * `ssh://git@host[:port]/group/project(.git)` and
 * `https://host[:port]/group/project(.git)` (converted to the ssh form on port
 * 22, since an https address says nothing about the ssh port). Everything else
 * is null, including a numeric project id, which cannot form an ssh address.
 */
export function parseProjectAddress(input: string): ProjectAddress | null {
	const text = input.trim();
	// eslint-disable-next-line no-control-regex
	if (text === '' || text.length > MAX_ADDRESS_LENGTH || /[\s\u0000-\u001f\u007f]/.test(text)) {
		return null;
	}

	const scp = /^([^@:/]+)@([^:/]+):(.+)$/.exec(text);
	if (scp !== null && text.indexOf('://') === -1) {
		const [, user, host, rawPath] = scp;
		if (user !== SSH_USER || !HOST.test(host) || rawPath.charAt(0) === '/') {
			return null;
		}
		const path = cleanPath(rawPath);
		return path === null ? null : build(host, null, path, `https://${host}`);
	}

	const url = /^(ssh|https):\/\/(?:([^@/:]*)@)?([^/:]+)(?::([^/]*))?\/(.+)$/.exec(text);
	if (url === null) {
		return null;
	}
	const [, scheme, user, host, portText, rawPath] = url;
	if (!HOST.test(host)) {
		return null;
	}
	const port = parsePort(portText);
	if (port === undefined) {
		return null;
	}
	const path = cleanPath(rawPath);
	if (path === null) {
		return null;
	}

	if (scheme === 'ssh') {
		// The user is part of the address, not a default to fill in: ssh with no
		// user would use the local account's name.
		if (user !== SSH_USER) {
			return null;
		}
		return build(host, port, path, `https://${host}`);
	}

	// An https address carrying credentials is refused outright rather than
	// stripped: the author has just pasted a secret into a settings field.
	if (user !== undefined) {
		return null;
	}
	return build(host, null, path, port === null ? `https://${host}` : `https://${host}:${port}`);
}

/** Where an author adds a key to their account. The page moved between GitLab versions; this is the one the target runs. */
export function sshKeysPageUrl(address: ProjectAddress): string {
	return `${address.webBase}/-/user_settings/ssh_keys`;
}

/** The project's open reviews that start from one document's branch. Costs no request. */
export function reviewListUrl(address: ProjectAddress, docId: string): string {
	return `${address.webBase}/${address.path}/-/merge_requests?state=opened&source_branch=${encodeURIComponent(`doc/${docId}`)}`;
}

/** Where a review request for a document's branch is opened by hand, when the server did not open one. Costs no request. */
export function newReviewUrl(address: ProjectAddress, docId: string): string {
	return `${address.webBase}/${address.path}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${encodeURIComponent(`doc/${docId}`)}`;
}

/** One file on the default branch. Each part is encoded; the slashes between folders are kept. */
export function filePageUrl(address: ProjectAddress, defaultBranch: string, filePath: string): string {
	const file = filePath.split('/').map(encodeURIComponent).join('/');
	return `${address.webBase}/${address.path}/-/blob/${encodeURIComponent(defaultBranch)}/${file}`;
}

/**
 * GitLab's alphabet for a username. Checked wherever one is accepted — typed,
 * read from the server's greeting, and loaded from the saved file — because it
 * ends up in the owner field written into documents, where a line break would
 * start a new field.
 */
export const GITLAB_USERNAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,254}$/;
