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
 * `insufficient-permission` is produced by the write and delete methods AND
 * by the two pre-flight lookups. It was once true that "reads have nowhere a
 * fine-grained token's scope can bite" — that premise died on 2026-09-09,
 * when `findOpenMergeRequest` was refused with a named
 * `insufficient_granular_scope` error for a missing `Merge Request: Read`
 * permission. A fine-grained token gates reads per-resource, so a read of a
 * resource the token was not granted fails this way and no amount of
 * retrying fixes it. The connection check's two reads keep the old
 * treatment deliberately — see `classifyStatus` versus `classifyScopedStatus`.
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

/**
 * Whether a branch is on the remote. `exists: false` is returned ONLY when
 * the server explicitly reported the branch as not found; every other
 * failure comes back as `ok: false` instead. See `branchExists`.
 */
export interface BranchPresence {
	exists: boolean;
}

/** The open merge request found for a source branch, when there is one. */
export interface OpenMergeRequest {
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
 * Reads whether `branch` is on the remote, as a THREE-WAY answer: it exists
 * (`ok`, `exists: true`), it is absent (`ok`, `exists: false`), or the
 * lookup itself did not succeed (`ok: false`, with a `FailureKind`).
 *
 * The three-way shape is normative, not stylistic. Callers use this answer
 * to decide whether to delete the named branch, so a failure reported as
 * absence would license both a destructive act and a write that cannot
 * succeed. `classifyStatus` cannot carry that distinction on its own — it
 * folds 403 and 404 into `not-reachable` — which is why this goes through
 * `getRaw` and reads the status itself: only an explicit 404 is absence.
 *
 * OBSERVED on gitlab.com 2026-09-09 (tasks.md 1.2), against this project's
 * own remote rather than assumed from the docs:
 *   absent   → HTTP 404, body `{"message":"404 Branch Not Found"}`
 *   existing → HTTP 200
 * with the branch name `%2F`-encoded in the path, which routed correctly.
 * So the classification below holds there.
 *
 * STILL UNCONFIRMED against the target self-managed CE 19.3.0 instance —
 * the same deferred rerun as `docs/access-tokens.md` §1(a), and gitlab.com
 * is SaaS/EE on continuous deployment, so it is not evidence for CE. If CE
 * answers 403, or 200 with an error body, this reads it as a lookup failure
 * and the submit aborts having written nothing; a surprise costs a submit
 * rather than data, which is why it was accepted as a deferred question
 * instead of a blocker.
 *
 * A 404 for a project that cannot be read carries `404 Project Not Found`
 * instead and is read here as absence — acceptable because the connection
 * gate has already established the project is reachable before submit can
 * run at all.
 */
async function branchExists(
	details: ConnectionDetails,
	branch: string
): Promise<ClientResult<BranchPresence>> {
	const result = await getRaw(
		details,
		`/projects/${encodeProject(details.projectId)}/repository/branches/${encodeURIComponent(branch)}`,
		classifyScopedStatus
	);
	if (result.ok) {
		return { ok: true, value: { exists: true } };
	}

	if (result.status === 404) {
		return { ok: true, value: { exists: false } };
	}

	return result.detail === undefined
		? { ok: false, failure: result.failure }
		: { ok: false, failure: result.failure, detail: result.detail };
}

/**
 * Reads whether an OPEN merge request has `sourceBranch` as its source,
 * returning its `iid` when one does and `null` when none does.
 *
 * `state=opened` is the whole question: a merged or closed merge request
 * must not come back from here, because a caller reclaiming the branch is
 * entitled to do so precisely when nothing is under review. A failed lookup
 * returns `ok: false` and is therefore distinguishable from "none exists",
 * so a caller can abort instead of proceeding.
 */
async function findOpenMergeRequest(
	details: ConnectionDetails,
	sourceBranch: string
): Promise<ClientResult<OpenMergeRequest | null>> {
	const query = `source_branch=${encodeURIComponent(sourceBranch)}&state=opened`;
	const result = await getRaw(
		details,
		`/projects/${encodeProject(details.projectId)}/merge_requests?${query}`,
		classifyScopedStatus
	);
	if (!result.ok) {
		return result.detail === undefined
			? { ok: false, failure: result.failure }
			: { ok: false, failure: result.failure, detail: result.detail };
	}

	if (!Array.isArray(result.value)) {
		return { ok: false, failure: 'unexpected' };
	}

	if (result.value.length === 0) {
		return { ok: true, value: null };
	}

	const iid = (result.value[0] as Partial<{ iid: number }>).iid;
	if (typeof iid !== 'number') {
		return { ok: false, failure: 'unexpected' };
	}

	return { ok: true, value: { iid } };
}

/**
 * Deletes `branch` on the remote. THIS IS THIS CAPABILITY'S FIRST
 * DESTRUCTIVE CALL — every other method here reads or adds.
 *
 * It does not judge whether deleting is appropriate; that decision belongs
 * to the caller and stays out of this transport layer deliberately (see
 * this change's design.md decision 8). Classified through the WRITE path,
 * because a fine-grained token's permissions can be exactly why a delete is
 * refused, and it carries GitLab's reported permission name through the same
 * way the other writes do.
 */
async function deleteBranch(details: ConnectionDetails, branch: string): Promise<ClientResult<void>> {
	return del(
		details,
		`/projects/${encodeProject(details.projectId)}/repository/branches/${encodeURIComponent(branch)}`
	);
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

/**
 * A failed read that still carries the status it failed with. Only
 * `branchExists` needs this, and only because `classifyStatus` folds 403 and
 * 404 together: the classification alone cannot tell "the branch is not
 * there" from "this token may not look", and that difference decides whether
 * a delete is allowed to happen.
 */
type RawReadResult =
	| { ok: true; value: unknown }
	| { ok: false; failure: FailureKind; status: number | null; detail?: string };

/**
 * `classify` defaults to `classifyStatus`, which is right for the connection
 * check: a 403 there means the project is not visible, not that a permission
 * is missing. The pre-flight lookups pass `classifyScopedStatus` instead,
 * because a fine-grained token gates them per-resource and GitLab names the
 * permission it wanted.
 */
async function getRaw(
	details: ConnectionDetails,
	path: string,
	classify: (status: number) => FailureKind = classifyStatus
): Promise<RawReadResult> {
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
		const failure = status === null ? 'server-unreachable' : classify(status);
		logFailure('GET', url, status, failure, error);
		return { ok: false, failure, status };
	}

	if (response.status < 200 || response.status >= 300) {
		const failure = classify(response.status);
		const detail = failure === 'insufficient-permission' ? extractPermissionDetail(response) : undefined;
		logFailure('GET', url, response.status, failure, bodyPreview(response));
		return detail === undefined
			? { ok: false, failure, status: response.status }
			: { ok: false, failure, status: response.status, detail };
	}

	try {
		return { ok: true, value: response.json };
	} catch {
		return { ok: false, failure: 'unexpected', status: response.status };
	}
}

/** `getRaw` with the status dropped — what every caller but one wants. */
async function get(details: ConnectionDetails, path: string): Promise<ClientResult<unknown>> {
	const result = await getRaw(details, path);
	if (result.ok) {
		return result;
	}

	return result.detail === undefined
		? { ok: false, failure: result.failure }
		: { ok: false, failure: result.failure, detail: result.detail };
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
		const failure = status === null ? 'server-unreachable' : classifyScopedStatus(status);
		logFailure('POST', url, status, failure, error);
		return { ok: false, failure };
	}

	if (response.status < 200 || response.status >= 300) {
		const failure = classifyScopedStatus(response.status);
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
 * The destructive counterpart to `post`. Classifies through
 * `classifyWriteStatus` and carries a reported permission name for the same
 * reason the writes do — a fine-grained token's permissions are a live cause
 * of a refused delete.
 *
 * Reads no body on success: a successful branch delete answers 204 with
 * nothing, so `response.json` would throw on exactly the good path.
 */
async function del(details: ConnectionDetails, path: string): Promise<ClientResult<void>> {
	const url = `${normalizeHost(details.host)}/api/v4${path}`;

	let response: RequestUrlResponse;
	try {
		response = await requestUrl({
			url,
			method: 'DELETE',
			headers: { 'PRIVATE-TOKEN': details.token.trim() },
			throw: false,
		});
	} catch (error) {
		const status = statusFromError(error);
		const failure = status === null ? 'server-unreachable' : classifyScopedStatus(status);
		logFailure('DELETE', url, status, failure, error);
		return { ok: false, failure };
	}

	if (response.status < 200 || response.status >= 300) {
		const failure = classifyScopedStatus(response.status);
		const detail = failure === 'insufficient-permission' ? extractPermissionDetail(response) : undefined;
		logFailure('DELETE', url, response.status, failure, bodyPreview(response));
		return detail === undefined ? { ok: false, failure } : { ok: false, failure, detail };
	}

	return { ok: true, value: undefined };
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
 * For every call a fine-grained token's permissions can gate: the writes, the
 * delete, and the two pre-flight lookups. Its 403 means "this token was not
 * granted that permission", which is permanent until someone edits the token
 * — as distinct from `classifyStatus`'s 403, which the connection check reads
 * as "the project is not visible to you". See `docs/access-tokens.md` §1.
 *
 * Named for the property that decides it rather than for the HTTP verb: it
 * was `classifyWriteStatus` until 2026-09-09, on the assumption that only
 * writes could be refused this way. `findOpenMergeRequest` was then refused
 * with `insufficient_granular_scope` naming `Merge Request: Read`, which
 * disproved it.
 */
function classifyScopedStatus(status: number): FailureKind {
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
 * Best-effort extraction of the permission name GitLab names in a
 * fine-grained token's `insufficient_granular_scope` error body.
 *
 * Reads `error_description` before `message`, and that ordering is the fix
 * rather than a preference. This previously read `message` alone, which the
 * real body does not carry: a refusal observed on gitlab.com 2026-09-09 came
 * back as
 *   {"error":"insufficient_granular_scope",
 *    "error_description":"Access denied: This operation requires a
 *     fine-grained personal access token with the following project
 *     permissions: [Merge Request: Read]."}
 * so the detail was always dropped and the author never saw which permission
 * to ask for — including on the write path, where milestone 4 intended it.
 *
 * The bracketed list is preferred over the old identifier regex for the same
 * reason: GitLab spells the permission the way the token screen spells it
 * ("Merge Request: Read"), and that string is what the author has to go and
 * tick. An unrecognized shape still degrades to no detail rather than
 * guessing; the caller keeps the insufficient-permission classification
 * either way.
 *
 * Observed on gitlab.com only. NOT yet confirmed against the self-managed
 * CE 19.3.0 target instance — the same deferred rerun as
 * `docs/access-tokens.md` §1(a).
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

	const source = body as Record<string, unknown>;
	const text = [source['error_description'], source['message']].find((value) => typeof value === 'string');
	if (typeof text !== 'string') {
		return undefined;
	}

	const bracketed = /\[([^\]]+)\]/.exec(text);
	if (bracketed !== null) {
		return bracketed[1];
	}

	// `\W+` and not `\D*`: the latter matches letters too, so it backtracked to
	// the last legal start and turned "insufficient_granular_scope:
	// read_merge_request" into "t". Separator characters only.
	const named = /insufficient_granular_scope\W+([a-z][a-z0-9_]*)/i.exec(text);
	return named === null ? undefined : named[1];
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

export {
	getCurrentUser,
	getProjectAccess,
	createBranchWithCommit,
	createMergeRequest,
	branchExists,
	findOpenMergeRequest,
	deleteBranch,
};
