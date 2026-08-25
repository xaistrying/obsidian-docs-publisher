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
 */
export type FailureKind =
	| 'rejected-credential'
	| 'not-reachable'
	| 'server-unreachable'
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

export type ClientResult<T> =
	| { ok: true; value: T }
	| { ok: false; failure: FailureKind };

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
		logFailure(url, status, failure, error);
		return { ok: false, failure };
	}

	if (response.status < 200 || response.status >= 300) {
		const failure = classifyStatus(response.status);
		logFailure(url, response.status, failure, bodyPreview(response));
		return { ok: false, failure };
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
function logFailure(url: string, status: number | null, failure: FailureKind, detail: unknown): void {
	const code = status === null ? 'no response' : `HTTP ${status}`;
	console.error(`Docs Publisher: GET ${url} — ${code}, classified as ${failure}`, detail);
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

export { getCurrentUser, getProjectAccess };
