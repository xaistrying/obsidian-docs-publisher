import { requestUrl } from 'obsidian';
import type { RequestUrlResponse } from 'obsidian';

/**
 * The three values an author enters in the settings tab. Passed in on every
 * call — this module holds no state and reads no configuration of its own.
 */
export interface ConnectionDetails {
	host: string;
	projectId: string;
	token: string;
}

/**
 * How a failed call is described to callers. This says which kind of failure
 * happened; the caller decides what the author is told.
 *
 * `insufficient-permission` is produced only by the write methods below: the
 * two read methods have nowhere a fine-grained token's scope can bite, so
 * their existing three kinds are unchanged.
 */
export type FailureKind =
	| 'rejected-credential'
	| 'not-reachable'
	| 'server-unreachable'
	| 'insufficient-permission'
	| 'unexpected';

export interface Identity {
	id: number;
	name: string;
	username: string;
}

export interface ProjectAccess {
	/** Null when the project is reachable but carries no role for this account. */
	accessLevel: number | null;
	accessLabel: string;
}

export interface CommitResult {
	id: string;
}

export interface MergeRequestResult {
	iid: number;
}

export type ClientResult<T> =
	| { ok: true; value: T }
	// `detail` carries GitLab's reported permission name on the
	// insufficient-permission kind; absent for every other kind and when the
	// response didn't parse as expected. See `extractPermissionDetail`.
	| { ok: false; failure: FailureKind; detail?: string };

// GitLab's fixed access-level enum. Naming a level is protocol knowledge, so
// the mapping lives here rather than in the settings tab that renders it.
const ACCESS_LEVEL_NAMES: Record<number, string> = {
	0: 'No',
	5: 'Minimal',
	10: 'Guest',
	15: 'Planner',
	20: 'Reporter',
	30: 'Developer',
	40: 'Maintainer',
	50: 'Owner',
};

/** Reads the account the supplied token belongs to. */
async function getCurrentUser(details: ConnectionDetails): Promise<ClientResult<Identity>> {
	const result = await get(details, '/user');
	if (!result.ok) {
		return result;
	}

	const body = result.value as Partial<Identity>;
	if (typeof body.id !== 'number' || typeof body.name !== 'string' || typeof body.username !== 'string') {
		return { ok: false, failure: 'unexpected' };
	}

	return { ok: true, value: { id: body.id, name: body.name, username: body.username } };
}

/**
 * Reads the access the current account holds on the configured project.
 *
 * Reads the project itself rather than a membership record: `GET /projects/:id`
 * reports the requesting account's own effective access in `permissions`, and
 * needs only project read. The members endpoint answers 404 whenever no
 * membership record exists — for an owner reaching the project through an
 * ancestor group, an instance admin, or a token without members-read — which
 * is indistinguishable from a project that is genuinely missing.
 */
async function getProjectAccess(details: ConnectionDetails): Promise<ClientResult<ProjectAccess>> {
	const result = await get(details, `/projects/${encodeProject(details.projectId)}`);
	if (!result.ok) {
		return result;
	}

	const accessLevel = highestAccessLevel((result.value as { permissions?: unknown }).permissions);
	const named = accessLevel === null ? undefined : ACCESS_LEVEL_NAMES[accessLevel];
	return {
		ok: true,
		value: { accessLevel, accessLabel: named === undefined ? 'Unknown' : named },
	};
}

/**
 * `permissions` carries the account's direct project role and any role
 * inherited from a group; either may be absent. The effective access is the
 * higher of whichever are present.
 */
function highestAccessLevel(permissions: unknown): number | null {
	if (typeof permissions !== 'object' || permissions === null) {
		return null;
	}

	const source = permissions as Record<string, unknown>;
	let highest: number | null = null;
	for (const key of ['project_access', 'group_access']) {
		const entry = source[key];
		if (typeof entry === 'object' && entry !== null) {
			const level = (entry as { access_level?: unknown }).access_level;
			if (typeof level === 'number' && (highest === null || level > highest)) {
				highest = level;
			}
		}
	}

	return highest;
}

/**
 * Creates a new branch and commits one file to it in a single call. The
 * branch is created from the project's default branch, never from the given
 * branch name (which does not exist yet) — see `docs/document-identity.md`
 * §1 for why the branch itself is a snapshot, not a derivation.
 */
async function createBranchWithCommit(
	details: ConnectionDetails,
	params: { branch: string; filePath: string; content: string }
): Promise<ClientResult<CommitResult>> {
	const defaultBranch = await getDefaultBranch(details);
	if (!defaultBranch.ok) {
		return defaultBranch;
	}

	const result = await post(details, `/projects/${encodeProject(details.projectId)}/repository/commits`, {
		branch: params.branch,
		start_branch: defaultBranch.value,
		commit_message: `Add ${params.filePath}`,
		actions: [{ action: 'create', file_path: params.filePath, content: params.content }],
	});
	if (!result.ok) {
		return result;
	}

	const id = (result.value as Partial<{ id: string }>).id;
	if (typeof id !== 'string') {
		return { ok: false, failure: 'unexpected' };
	}

	return { ok: true, value: { id } };
}

/** Opens a merge request from `sourceBranch` against the project's default branch. */
async function createMergeRequest(
	details: ConnectionDetails,
	params: { sourceBranch: string; title: string }
): Promise<ClientResult<MergeRequestResult>> {
	const defaultBranch = await getDefaultBranch(details);
	if (!defaultBranch.ok) {
		return defaultBranch;
	}

	const result = await post(details, `/projects/${encodeProject(details.projectId)}/merge_requests`, {
		source_branch: params.sourceBranch,
		target_branch: defaultBranch.value,
		title: params.title,
	});
	if (!result.ok) {
		return result;
	}

	const iid = (result.value as Partial<{ iid: number }>).iid;
	if (typeof iid !== 'number') {
		return { ok: false, failure: 'unexpected' };
	}

	return { ok: true, value: { iid } };
}

/**
 * Both write methods need the project's default branch and neither is
 * handed one — a plain read, classified through the existing read path
 * rather than the write one, since a fine-grained token's write scope has
 * nothing to do with whether the project itself can be read.
 */
async function getDefaultBranch(details: ConnectionDetails): Promise<ClientResult<string>> {
	const result = await get(details, `/projects/${encodeProject(details.projectId)}`);
	if (!result.ok) {
		return result;
	}

	const defaultBranch = (result.value as { default_branch?: unknown }).default_branch;
	if (typeof defaultBranch !== 'string' || defaultBranch === '') {
		return { ok: false, failure: 'unexpected' };
	}

	return { ok: true, value: defaultBranch };
}

async function get(details: ConnectionDetails, path: string): Promise<ClientResult<unknown>> {
	const url = `${normalizeHost(details.host)}/api/v4${path}`;

	let response: RequestUrlResponse;
	try {
		response = await requestUrl({
			url,
			method: 'GET',
			headers: { 'PRIVATE-TOKEN': details.token.trim() },
			throw: false,
		});
	} catch (error) {
		const status = statusFromError(error);
		const failure = status === null ? 'server-unreachable' : classifyStatus(status);
		logFailure('GET', url, status, failure, error);
		return { ok: false, failure };
	}

	if (response.status < 200 || response.status >= 300) {
		const failure = classifyStatus(response.status);
		logFailure('GET', url, response.status, failure, bodyPreview(response));
		return { ok: false, failure };
	}

	try {
		return { ok: true, value: response.json };
	} catch {
		return { ok: false, failure: 'unexpected' };
	}
}

/**
 * The write counterpart to `get`. Classifies through `classifyWriteStatus`
 * rather than `classifyStatus` — a write's 403 means something different
 * from a read's — and, only on that insufficient-permission kind, attempts
 * to carry GitLab's reported permission name through to the caller.
 */
async function post(details: ConnectionDetails, path: string, body: unknown): Promise<ClientResult<unknown>> {
	const url = `${normalizeHost(details.host)}/api/v4${path}`;

	let response: RequestUrlResponse;
	try {
		response = await requestUrl({
			url,
			method: 'POST',
			contentType: 'application/json',
			headers: { 'PRIVATE-TOKEN': details.token.trim() },
			body: JSON.stringify(body),
			throw: false,
		});
	} catch (error) {
		const status = statusFromError(error);
		const failure = status === null ? 'server-unreachable' : classifyWriteStatus(status);
		logFailure('POST', url, status, failure, error);
		return { ok: false, failure };
	}

	if (response.status < 200 || response.status >= 300) {
		const failure = classifyWriteStatus(response.status);
		const detail = failure === 'insufficient-permission' ? extractPermissionDetail(response) : undefined;
		logFailure('POST', url, response.status, failure, bodyPreview(response));
		return detail === undefined ? { ok: false, failure } : { ok: false, failure, detail };
	}

	try {
		return { ok: true, value: response.json };
	} catch {
		return { ok: false, failure: 'unexpected' };
	}
}

/**
 * The settings tab deliberately shows an author a plain sentence with no
 * status code. Log the detail to the developer console so a failing check is
 * still diagnosable. Never logs the token or the request headers.
 */
function logFailure(method: string, url: string, status: number | null, failure: FailureKind, detail: unknown): void {
	const code = status === null ? 'no response' : `HTTP ${status}`;
	console.error(`Docs Publisher: ${method} ${url} — ${code}, classified as ${failure}`, detail);
}

function bodyPreview(response: RequestUrlResponse): string {
	try {
		return response.text.slice(0, 300);
	} catch {
		return '<no readable body>';
	}
}

function classifyStatus(status: number): FailureKind {
	if (status === 401) {
		return 'rejected-credential';
	}
	if (status === 403 || status === 404) {
		return 'not-reachable';
	}
	return 'unexpected';
}

/**
 * A write's 403 means something different from a read's: `classifyStatus`
 * folds 403 into not-reachable because a read has no scope to be missing,
 * but a write can fail this way specifically because a fine-grained token's
 * permissions don't cover it. See `docs/access-tokens.md` §1.
 */
function classifyWriteStatus(status: number): FailureKind {
	if (status === 401) {
		return 'rejected-credential';
	}
	if (status === 403) {
		return 'insufficient-permission';
	}
	if (status === 404) {
		return 'not-reachable';
	}
	return 'unexpected';
}

/**
 * Best-effort extraction of the permission name GitLab names in a fine-grained
 * token's `insufficient_granular_scope`-style error body. Confirmed on
 * gitlab.com by the manual spike in `docs/access-tokens.md` §1; NOT yet
 * confirmed against this project's self-managed CE 19.3.0 target instance —
 * design.md's open question. An unrecognized shape degrades to no detail
 * rather than guessing at a permission name; the caller still gets the
 * insufficient-permission classification either way.
 */
function extractPermissionDetail(response: RequestUrlResponse): string | undefined {
	let body: unknown;
	try {
		body = response.json;
	} catch {
		return undefined;
	}

	if (typeof body !== 'object' || body === null) {
		return undefined;
	}

	const message = (body as Record<string, unknown>).message;
	if (typeof message !== 'string') {
		return undefined;
	}

	const match = /insufficient_granular_scope\D*([a-z][a-z0-9_]*)/i.exec(message);
	return match === null ? undefined : match[1];
}

/**
 * `requestUrl` rejects on network-level failures, and versions that predate
 * the `throw` option also reject on a bad status. Recover a status from the
 * rejection when it carries one, so a rejected token is not reported as an
 * unreachable server.
 */
function statusFromError(error: unknown): number | null {
	if (typeof error === 'object' && error !== null) {
		const status = (error as { status?: unknown }).status;
		if (typeof status === 'number') {
			return status;
		}
	}

	const message = error instanceof Error ? error.message : String(error);
	const match = /\bstatus\s+(\d{3})\b/i.exec(message);
	return match === null ? null : Number(match[1]);
}

/**
 * GitLab accepts either a numeric project id or a URL-encoded namespace path
 * wherever its API takes `:id`. An all-digits value is passed through as an
 * id — the form the settings tab asks for. A pasted namespace path still
 * works: it is encoded, so `group/project` becomes `group%2Fproject`.
 */
function encodeProject(project: string): string {
	const trimmed = project.trim().replace(/^\/+/, '').replace(/\/+$/, '');
	return /^\d+$/.test(trimmed) ? trimmed : encodeURIComponent(trimmed);
}

function normalizeHost(host: string): string {
	const trimmed = host.trim().replace(/\/+$/, '');
	return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export { getCurrentUser, getProjectAccess, createBranchWithCommit, createMergeRequest };
