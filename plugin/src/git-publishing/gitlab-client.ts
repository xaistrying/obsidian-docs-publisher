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
 *
 * `content-changed` is the `last_commit_id` guard firing: the file moved on
 * between the caller reading its commit id and sending the write, so GitLab
 * refused rather than overwriting someone. Its own kind rather than one more
 * `unexpected`, because it is the one write failure where retrying is the
 * WRONG advice — the author needs to see what changed first. OBSERVED on
 * gitlab.com 2026-09-12: HTTP 400, body `{"message":"The file has changed
 * since you started editing it: <path>"}`. See `isContentChanged`.
 */
export type FailureKind =
	| 'rejected-credential'
	| 'not-reachable'
	| 'server-unreachable'
	| 'insufficient-permission'
	| 'content-changed'
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

/**
 * A file's content at a specific path and ref, as a THREE-WAY answer:
 * exists-with-content, absent, or (via `ClientResult`) failed. Mirrors
 * `BranchPresence`'s shape and for the identical reason — see
 * `getFileContent`.
 */
export type FileContent = { exists: true; content: string } | { exists: false };

/**
 * Which verb a commit uses for one of the files it writes. Decided by the
 * CALLER from the document's resolved state, never re-derived here — this
 * module supplies the write and has no opinion on when either verb is
 * appropriate (`submit-document.ts` owns that; design.md decision 3).
 *
 * `delete` is deliberately not one of them and never becomes one. Unlinking
 * an image locally strands its remote copy, orphans accumulate, and a
 * Maintainer clears them in GitLab — the same escape hatch reorganization
 * already uses (add-attachment-sync design.md decision 6). Leaving the verb
 * out of the type is what makes "the plugin never deletes an attachment" a
 * property of the code rather than a promise about it (that change's
 * tasks.md 5.5).
 */
export type CommitAction = 'create' | 'update';

/**
 * One file's place in a commit: where it goes, what it carries, which verb
 * writes it, and — for an `update` — the commit id that write is guarded
 * against.
 *
 * A commit takes an ARRAY of these as of add-attachment-sync, because a
 * document and the images it embeds are one submission and must land in one
 * commit or not at all: a note published without its pictures has broken
 * embeds, and a picture published without its note is an orphan nobody
 * references.
 *
 * `encoding` is absent for text and `base64` for bytes. An image sent as
 * text arrives corrupted, so this is the difference between an attachment
 * that renders and one that does not. GitLab's acceptance of it is the one
 * part of this payload that could not be settled without the server — see
 * `docs/ce-verification.md`.
 */
export interface CommitFileAction {
	filePath: string;
	content: string;
	action: CommitAction;
	/** Only meaningful for `update`; see `getFileCommitId`. */
	lastCommitId?: string;
	/** Omitted for text content, which is every markdown file. */
	encoding?: 'base64';
}

/**
 * The commit a file currently carries at a path and ref, as a THREE-WAY
 * answer — exists-with-id, absent, or (via `ClientResult`) failed — for the
 * same reason `FileContent` and `BranchPresence` have that shape: this gates
 * an `update` write, and a failed read reported as absence would send a
 * `create` at a path that already holds a file, or an update with no
 * staleness guard at all. See `getFileCommitId`.
 */
export type FileCommitId = { exists: true; commitId: string } | { exists: false };

/**
 * One entry from the merge-request listing, carrying only what callers need.
 *
 * `state` is GitLab's own string — `opened`, `closed`, `merged`, `locked` —
 * passed through unmapped. What a state MEANS for a document is
 * submission-tracking's to decide, not this capability's (this change's
 * design.md decision 9), so nothing here translates it.
 */
export interface MergeRequestSummary {
	iid: number;
	state: string;
	sourceBranch: string;
	/** Null when the response carried no usable link. */
	webUrl: string | null;
	/**
	 * How many review comments the merge request carries, or null when the
	 * response did not report it. Null means UNKNOWN and never zero: this
	 * gates the discussions read, and reading an unreported count as "no
	 * comments" would skip that read and answer "no unresolved threads" for a
	 * merge request nobody actually checked.
	 */
	userNotesCount: number | null;
}

/**
 * A listing, plus whether it is the whole story.
 *
 * `truncated` is load-bearing rather than informational. A `doc_id` absent
 * from a truncated listing is indistinguishable from one that was never
 * submitted, and the second answer sends an author to submit a document that
 * already exists — so the caller is given what it needs to refuse to resolve
 * instead of resolving wrongly. See this change's design.md decision 2.
 */
export interface MergeRequestListing {
	entries: MergeRequestSummary[];
	truncated: boolean;
}

/** Server-side narrowing for `listMergeRequests`. Both fields are optional. */
export interface MergeRequestQuery {
	/** Restrict to merge requests opened from this branch. */
	sourceBranch?: string;
	/** Defaults to `all`, which is what reconciliation requires. */
	state?: 'all' | 'opened';
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
 * Creates a new branch and commits one OR MORE files to it in a single call.
 * The branch is created from the project's default branch, never from the
 * given branch name (which does not exist yet) — see
 * `docs/document-identity.md` §1 for why the branch itself is a snapshot, not
 * a derivation.
 *
 * Each file's `action` is the CALLER's decision, not this function's. It was
 * once hardcoded to `create`, which was correct only because the one caller
 * was a first submit; a published document's new cycle cuts from a default
 * branch that ALREADY holds the file, and `create` against an existing path is
 * rejected outright (`docs/resubmission-lifecycle.md` §2). An `update` carries
 * `lastCommitId` so the write fails rather than silently overwriting a file
 * that moved on since it was read.
 *
 * GitLab applies the whole actions array as ONE commit, so a rejected action
 * leaves none of the files written and no branch half-created — which is what
 * lets a document and its attachments be submitted as a single thing.
 */
async function createBranchWithCommit(
	details: ConnectionDetails,
	params: { branch: string; files: readonly CommitFileAction[] }
): Promise<ClientResult<CommitResult>> {
	const defaultBranch = await getDefaultBranch(details);
	if (!defaultBranch.ok) {
		return defaultBranch;
	}

	return postCommit(details, {
		branch: params.branch,
		start_branch: defaultBranch.value,
		commit_message: commitMessage(params.files),
		actions: commitActions(params.files),
	});
}

/**
 * Commits one file to a branch that ALREADY exists, creating nothing. The
 * sibling of `createBranchWithCommit` above, and deliberately a second named
 * function rather than a boolean flag on the first: the only difference in
 * the payload is the absence of `start_branch`, and a call site reads better
 * saying which of the two it means than passing `true` (design.md decision
 * 4).
 *
 * This is the revision path — a document already under review, whose branch
 * and submission both exist and must be left alone. The note's own action is
 * always an `update` carrying a `lastCommitId`: an update to a branch under
 * active review is exactly where a concurrent edit can be silently
 * overwritten. An attachment newly embedded since the last revision is a
 * `create` in the same commit, which is why the verb is per-file here rather
 * than fixed for the call.
 */
async function commitToBranch(
	details: ConnectionDetails,
	params: { branch: string; files: readonly CommitFileAction[] }
): Promise<ClientResult<CommitResult>> {
	return postCommit(details, {
		branch: params.branch,
		commit_message: commitMessage(params.files),
		actions: commitActions(params.files),
	});
}

/**
 * The one `actions: [...]` payload both commit calls build, so the two can
 * never disagree about the shape of a write (tasks.md 2.3).
 *
 * `last_commit_id` and `encoding` are omitted rather than sent as `undefined`
 * when there is none: GitLab rejects a key with an empty value, a `create`
 * has nothing for a commit id to be stale relative to, and text carries no
 * encoding flag at all.
 */
function commitActions(files: readonly CommitFileAction[]): unknown[] {
	return files.map((file) => {
		const action: Record<string, unknown> = {
			action: file.action,
			file_path: file.filePath,
			content: file.content,
		};
		if (file.lastCommitId !== undefined) {
			action['last_commit_id'] = file.lastCommitId;
		}
		if (file.encoding !== undefined) {
			action['encoding'] = file.encoding;
		}

		return action;
	});
}

/**
 * Named for the FIRST file, which callers put the document itself at — the
 * attachments riding along with it are not what the commit is about, and
 * listing them would bury the one path a human reading the history is looking
 * for.
 *
 * An empty array cannot reach here: every caller builds the note's own action
 * first, and a commit carrying no files would be rejected by GitLab anyway.
 * The fallback exists so this cannot produce `Add undefined`.
 */
function commitMessage(files: readonly CommitFileAction[]): string {
	const first = files[0];
	if (first === undefined) {
		return 'Update documents';
	}

	return `${first.action === 'create' ? 'Add' : 'Update'} ${first.filePath}`;
}

/** POSTs a prepared commit body and reads the resulting commit id out of it. */
async function postCommit(details: ConnectionDetails, body: unknown): Promise<ClientResult<CommitResult>> {
	const result = await post(details, `/projects/${encodeProject(details.projectId)}/repository/commits`, body);
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
 * tracked as `docs/ce-verification.md` §B1, and gitlab.com
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

	return failureFrom(result);
}

/**
 * Reads a single file's raw content at `path` and `ref` (a branch name or a
 * commit reference), as a THREE-WAY answer — exists-with-content, absent, or
 * failed — mirroring `branchExists`'s shape and for the identical reason
 * stated there: a caller uses this to decide whether to proceed with a write
 * (the submit collision pre-flight) or to recreate a note from what it
 * returns (recovery), and a failed read reported as absence would license
 * both incorrectly. See this change's (add-document-recovery) design.md
 * decision 2.
 *
 * Classified through `classifyScopedStatus`, like `branchExists`: a
 * fine-grained token gates this per-resource. Permission name NOT YET
 * OBSERVED — see `docs/access-tokens.md` §1 and `docs/ce-verification.md`.
 *
 * Goes through `getRawText`, not `getRaw`: the raw-file endpoint's successful
 * body is the file's own content, not JSON, and `getRaw`'s `response.json`
 * read would misclassify every successful read as `unexpected`.
 */
async function getFileContent(
	details: ConnectionDetails,
	params: { path: string; ref: string }
): Promise<ClientResult<FileContent>> {
	const result = await getRawText(
		details,
		`/projects/${encodeProject(details.projectId)}/repository/files/` +
			`${encodeURIComponent(params.path)}/raw?ref=${encodeURIComponent(params.ref)}`,
		classifyScopedStatus
	);
	if (result.ok) {
		return { ok: true, value: { exists: true, content: result.value } };
	}

	if (result.status === 404) {
		return { ok: true, value: { exists: false } };
	}

	return failureFrom(result);
}

/**
 * Reads the commit a single file currently carries at `path` and `ref`, as
 * the same THREE-WAY answer `getFileContent` returns — exists-with-id,
 * absent, or failed — and for the reason stated there: the caller uses this
 * to decide whether a write is a `create` or an `update`, and to guard that
 * update against a file that has moved on since. A failed read treated as
 * absence would license a `create` that cannot succeed, so only an explicit
 * 404 is absence.
 *
 * Hits the NON-raw `repository/files/:file_path` endpoint, which returns a
 * JSON envelope carrying `last_commit_id`, rather than reusing
 * `getFileContent`'s `/raw` variant — `/raw` returns the file body and no
 * metadata at all, so the id simply is not in that response to read.
 * `content` comes back base64-encoded here and is deliberately ignored: the
 * two callers that want content already have `getFileContent`, and decoding
 * a document's whole body to read one hash would be waste.
 *
 * Classified through `classifyScopedStatus`, like every other per-resource
 * read. Permission name and response shape NOT YET OBSERVED on the target
 * instance — `docs/ce-verification.md` §A8/§B8.
 */
async function getFileCommitId(
	details: ConnectionDetails,
	params: { path: string; ref: string }
): Promise<ClientResult<FileCommitId>> {
	const result = await getRaw(
		details,
		`/projects/${encodeProject(details.projectId)}/repository/files/` +
			`${encodeURIComponent(params.path)}?ref=${encodeURIComponent(params.ref)}`,
		classifyScopedStatus
	);
	if (!result.ok) {
		if (result.status === 404) {
			return { ok: true, value: { exists: false } };
		}

		return failureFrom(result);
	}

	const commitId = (result.value as { last_commit_id?: unknown }).last_commit_id;
	if (typeof commitId !== 'string' || commitId === '') {
		// A 200 that does not carry the one field this call exists to read.
		// Never softened to absence: the caller would then `create` over a
		// file that is demonstrably there.
		console.error(
			`Docs Publisher: ${params.path} at ${params.ref} answered without a usable last_commit_id.`
		);
		return { ok: false, failure: 'unexpected' };
	}

	return { ok: true, value: { exists: true, commitId } };
}

/** GitLab's maximum, and what the listing asks for on every page. */
const MERGE_REQUESTS_PER_PAGE = 100;

/**
 * Ten pages of 100 — see design.md decision 2. Set high enough that a
 * four-person team's corpus cannot reach it, and reaching it is reported as
 * `truncated` rather than swallowed.
 */
const MERGE_REQUEST_PAGE_CAP = 10;

/** The same bound for one merge request's discussions. See `hasUnresolvedThreads`. */
const DISCUSSIONS_PAGE_CAP = 10;

/**
 * Lists the project's merge requests, newest-updated first, following
 * pagination to `MERGE_REQUEST_PAGE_CAP`.
 *
 * Defaults to `state=all` deliberately: `docs/document-identity.md` §2
 * forbids filtering to open merge requests for reconciliation, because a
 * document whose review was closed without merging would then read as never
 * submitted and the author's next submit would collide with the branch still
 * sitting there.
 *
 * Returns raw merge requests and facts about them. It does not resolve, rank
 * or interpret any document's state — that is submission-tracking's job
 * (design.md decision 9).
 *
 * Classified through `classifyScopedStatus`: a fine-grained token gates this
 * read per-resource and GitLab names the permission it wanted, which is how
 * the author learns to ask for `Merge Request: Read` rather than to check
 * their connection.
 */
async function listMergeRequests(
	details: ConnectionDetails,
	query: MergeRequestQuery = {}
): Promise<ClientResult<MergeRequestListing>> {
	const filters = [
		`state=${query.state ?? 'all'}`,
		'order_by=updated_at',
		'sort=desc',
		`per_page=${MERGE_REQUESTS_PER_PAGE}`,
	];
	if (query.sourceBranch !== undefined) {
		filters.push(`source_branch=${encodeURIComponent(query.sourceBranch)}`);
	}

	const entries: MergeRequestSummary[] = [];
	for (let page = 1; page <= MERGE_REQUEST_PAGE_CAP; page++) {
		const result = await getRaw(
			details,
			`/projects/${encodeProject(details.projectId)}/merge_requests?${filters.join('&')}&page=${page}`,
			classifyScopedStatus
		);
		if (!result.ok) {
			return failureFrom(result);
		}

		if (!Array.isArray(result.value)) {
			return { ok: false, failure: 'unexpected' };
		}

		for (const raw of result.value) {
			const entry = toMergeRequestSummary(raw);
			if (entry === null) {
				return { ok: false, failure: 'unexpected' };
			}
			entries.push(entry);
		}

		// A short page is the last page. An exactly-full final page costs one
		// more request that comes back empty, which is cheaper than reading
		// `x-next-page` back out of the response headers whose casing varies.
		if (result.value.length < MERGE_REQUESTS_PER_PAGE) {
			return { ok: true, value: { entries, truncated: false } };
		}
	}

	// The cap was reached with a full page still coming back, so there may be
	// more. A corpus that is an exact multiple of the cap is reported as
	// truncated when it is in fact complete — the error is one-directional and
	// in the safe direction: "could not complete" over a confident wrong answer.
	console.error(
		`Docs Publisher: merge-request listing hit its ${MERGE_REQUEST_PAGE_CAP}-page cap ` +
			`(${entries.length} entries); the result is incomplete and must not be resolved from.`
	);
	return { ok: true, value: { entries, truncated: true } };
}

/** Every field reconciliation needs must be present; the rest degrade. */
function toMergeRequestSummary(raw: unknown): MergeRequestSummary | null {
	if (typeof raw !== 'object' || raw === null) {
		return null;
	}

	const source = raw as Record<string, unknown>;
	const iid = source['iid'];
	const state = source['state'];
	const sourceBranch = source['source_branch'];
	if (typeof iid !== 'number' || typeof state !== 'string' || typeof sourceBranch !== 'string') {
		return null;
	}

	const webUrl = source['web_url'];
	const userNotesCount = source['user_notes_count'];
	return {
		iid,
		state,
		sourceBranch,
		webUrl: typeof webUrl === 'string' && webUrl !== '' ? webUrl : null,
		userNotesCount: typeof userNotesCount === 'number' ? userNotesCount : null,
	};
}

/**
 * Reads whether a merge request carries review threads that are not yet
 * resolved. Reports that fact and nothing else — what an unresolved thread
 * MEANS for a document is submission-tracking's to decide.
 *
 * Takes the listing entry rather than a bare `iid` because
 * `userNotesCount` is the gate: a merge request nobody has commented on
 * cannot hold an unresolved thread, so it answers `false` without a request.
 * That gate is what keeps this bounded by review activity rather than by
 * corpus size. A null count means the response did not report one, which is
 * read as UNKNOWN and makes the request — never as zero.
 *
 * A failure comes back as `ok: false` and never as `false`. Answering "no
 * unresolved threads" for a check that did not happen would quietly move a
 * document out of changes-requested, which is the one state this call exists
 * to find.
 *
 * MECHANISM: this is design.md decision 4's fallback, and it ships in place
 * of the preferred `blocking_discussions_resolved` listing field because it
 * is correct whether or not that field exists and whether or not the
 * project's "all threads must be resolved before merging" setting is on. The
 * spike that would have settled the preferred form was not run; see design.md
 * decision 4. This is the only place that asks the question, so switching
 * later is one call site.
 *
 * PERMISSION: expected to be `Merge Request: Read`, NOT observed — see
 * `docs/access-tokens.md` §1 for the distinction and
 * `docs/ce-verification.md` §A4 for how to settle it.
 */
async function hasUnresolvedThreads(
	details: ConnectionDetails,
	mergeRequest: { iid: number; userNotesCount: number | null }
): Promise<ClientResult<boolean>> {
	if (mergeRequest.userNotesCount === 0) {
		return { ok: true, value: false };
	}

	for (let page = 1; page <= DISCUSSIONS_PAGE_CAP; page++) {
		const result = await getRaw(
			details,
			`/projects/${encodeProject(details.projectId)}/merge_requests/${mergeRequest.iid}` +
				`/discussions?per_page=${MERGE_REQUESTS_PER_PAGE}&page=${page}`,
			classifyScopedStatus
		);
		if (!result.ok) {
			return failureFrom(result);
		}

		if (!Array.isArray(result.value)) {
			return { ok: false, failure: 'unexpected' };
		}

		if (result.value.some(hasUnresolvedNote)) {
			return { ok: true, value: true };
		}

		if (result.value.length < MERGE_REQUESTS_PER_PAGE) {
			return { ok: true, value: false };
		}
	}

	// A thousand discussions on one document with none of them unresolved.
	// Logged rather than failed: the answer below is what the caller would
	// have got anyway, and failing the whole refresh over a bound nothing
	// realistic reaches would be the worse trade.
	console.error(
		`Docs Publisher: discussions for merge request ${mergeRequest.iid} hit their ` +
			`${DISCUSSIONS_PAGE_CAP}-page cap with no unresolved thread found.`
	);
	return { ok: true, value: false };
}

/**
 * A thread is unresolved when any note in it is resolvable and not resolved.
 * Notes that are not resolvable — system notes, plain comments — cannot hold
 * a thread open and are ignored.
 */
function hasUnresolvedNote(discussion: unknown): boolean {
	if (typeof discussion !== 'object' || discussion === null) {
		return false;
	}

	const notes = (discussion as { notes?: unknown }).notes;
	if (!Array.isArray(notes)) {
		return false;
	}

	return notes.some((note) => {
		if (typeof note !== 'object' || note === null) {
			return false;
		}
		const source = note as Record<string, unknown>;
		return source['resolvable'] === true && source['resolved'] !== true;
	});
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
 *
 * Goes through `listMergeRequests` rather than building its own query, so
 * this capability has one merge-request endpoint, one query construction and
 * one classification path (this change's tasks.md 2.4). The narrowing stays
 * SERVER-side — the same `source_branch` and `state` filters it always sent —
 * rather than listing the project and filtering in memory: this runs in the
 * submit pre-flight, where a full listing would be both slower and able to
 * truncate, and where `null` is what licenses deleting a branch.
 */
async function findOpenMergeRequest(
	details: ConnectionDetails,
	sourceBranch: string
): Promise<ClientResult<OpenMergeRequest | null>> {
	const result = await listMergeRequests(details, { sourceBranch, state: 'opened' });
	if (!result.ok) {
		return result;
	}

	const first = result.value.entries[0];
	if (first !== undefined) {
		return { ok: true, value: { iid: first.iid } };
	}

	// Not reachable with a single source branch filtered server-side, and
	// guarded anyway: "nothing matched" out of an incomplete listing is the
	// one answer here that authorizes a destructive act.
	if (result.value.truncated) {
		return { ok: false, failure: 'unexpected' };
	}

	return { ok: true, value: null };
}

/**
 * Reads the path of the DOCUMENT a merge request changed, distinguishing it
 * from the attachments that commit carried alongside it. Reports "could not be
 * determined" as `ok: true, value: null` — a successful answer distinct from a
 * failed lookup — rather than guessing among several.
 *
 * THE RULE IS "EXACTLY ONE MARKDOWN FILE", not "exactly one file". It was the
 * latter until add-attachment-sync, and that version answered null for every
 * illustrated document the moment a submission started carrying the images its
 * note embeds — which is not a cosmetic loss. Three shipped behaviours read
 * this answer: the pre-submit path-mismatch check, Reset, and recovery's
 * fallback for a record with no stored path. Two of them fail safe and go
 * dead; the path-mismatch check SILENTLY STOPS BINDING, because a path it
 * cannot establish is skipped rather than refused. So the filter below is what
 * keeps the refuse-to-move guarantee alive for a document with a picture in
 * it. None of the three callers changed; the repair is here, in the one
 * function all three share (design.md decision 1).
 *
 * The filter is exact rather than heuristic UNDER THE CURRENT MODEL, and only
 * under it: attachments are images by definition, and note-in-note
 * transclusion is out of scope project-wide, so no second markdown file can
 * appear in a document's own merge request. IF TRANSCLUSION IS EVER SUPPORTED,
 * THIS RULE IS WHAT IT BREAKS — a document embedding another note would carry
 * two markdown files and go back to answering null. This paragraph is the
 * notice, so that change meets the problem rather than discovering it
 * (tasks.md 3.2).
 *
 * REJECTED: matching the changed path against `doc_id`. It looks exact and is
 * not — `doc_id` is ASCII-folded from the filename at first submit, so a note
 * named `Bảo-trì.md` has `doc_id: Bao-tri` and its remote path's basename
 * legitimately differs. That would fail for exactly the documents this
 * project's own corpus is most likely to hold.
 *
 * Classified through `classifyScopedStatus`, like the other merge-request
 * reads. Permission name NOT YET OBSERVED.
 */
async function getMergeRequestChangedPath(
	details: ConnectionDetails,
	iid: number
): Promise<ClientResult<string | null>> {
	const result = await getRaw(
		details,
		`/projects/${encodeProject(details.projectId)}/merge_requests/${iid}/changes`,
		classifyScopedStatus
	);
	if (!result.ok) {
		return failureFrom(result);
	}

	const changes = (result.value as { changes?: unknown }).changes;
	if (!Array.isArray(changes)) {
		return { ok: true, value: null };
	}

	const markdown = changes.map(changedPath).filter(isMarkdownPath);
	return { ok: true, value: markdown.length === 1 ? markdown[0] : null };
}

/** One `changes` entry's `new_path`, or null when the entry is not that shape. */
function changedPath(entry: unknown): string | null {
	if (typeof entry !== 'object' || entry === null) {
		return null;
	}

	const path = (entry as { new_path?: unknown }).new_path;
	return typeof path === 'string' && path !== '' ? path : null;
}

/**
 * Case-insensitive on the EXTENSION alone. A vault holding `Notes.MD` is
 * unusual but not wrong, and reading it as a non-document would silently cost
 * that document the same three behaviours this filter exists to preserve. The
 * path itself is never case-folded: `Known-errors/` and `known-errors/` are
 * different locations, and `submit-document.ts` compares them exactly.
 */
function isMarkdownPath(path: string | null): path is string {
	return path !== null && /\.md$/i.test(path);
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
 *
 * Exported as of add-document-recovery: the submit collision pre-flight and
 * recovery's branch-then-default content fallback both need the same
 * answer, and duplicating this call would risk the two drifting.
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
 * Narrows a failed raw read to a `ClientResult` failure, dropping the status
 * and preserving `detail` only when there is one. Spelled out once because
 * `detail` is optional rather than nullable: assigning `detail: undefined`
 * unconditionally would put the key on the object, so a caller testing for
 * its presence would find one that is not there.
 */
function failureFrom<T>(result: { failure: FailureKind; detail?: string }): ClientResult<T> {
	return result.detail === undefined
		? { ok: false, failure: result.failure }
		: { ok: false, failure: result.failure, detail: result.detail };
}

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
	return result.ok ? result : failureFrom(result);
}

/**
 * `getRaw`'s counterpart for an endpoint whose successful body is the raw
 * file itself rather than JSON — used only by `getFileContent`. Structured
 * identically to `getRaw`, including returning the raw status so a caller
 * can distinguish absence from failure the same way `branchExists` does;
 * the one difference is the success path, which returns the response text
 * verbatim instead of attempting `response.json` (which would throw on a
 * plain-text body and misreport every successful read as `unexpected`).
 */
async function getRawText(
	details: ConnectionDetails,
	path: string,
	classify: (status: number) => FailureKind
): Promise<
	{ ok: true; value: string } | { ok: false; failure: FailureKind; status: number | null; detail?: string }
> {
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

	return { ok: true, value: response.text };
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
		const failure = isContentChanged(response) ? 'content-changed' : classifyScopedStatus(response.status);
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
 * CE 19.3.0 target instance — tracked as `docs/ce-verification.md` §B2,
 * which also records what degrades if the shape differs.
 */
/**
 * Whether this failed write is the `last_commit_id` guard firing rather than
 * an ordinary bad request.
 *
 * Status alone cannot answer it: GitLab returns 400 for several unrelated
 * write refusals — a branch that already exists, an `update` against a path
 * that is not there — and reading every one of them as a concurrent edit
 * would send the author looking for a change nobody made. So the body is
 * inspected, the same way `extractPermissionDetail` below inspects it for a
 * permission name.
 *
 * MATCHING ENGLISH PROSE IS THE WEAK PART, and it is deliberate rather than
 * overlooked: GitLab reports this in no other machine-readable way. The
 * degradation is safe in the direction that matters — if the wording changes
 * or is localized this answers false, the failure classifies as `unexpected`
 * exactly as it did before, and the write is still REFUSED. A wording change
 * costs the author a precise message, never their colleague's edit.
 *
 * OBSERVED on gitlab.com 2026-09-12 (`docs/ce-verification.md` §B8); NOT yet
 * on CE 19.3.0.
 */
function isContentChanged(response: RequestUrlResponse): boolean {
	if (response.status !== 400) {
		return false;
	}

	let body: unknown;
	try {
		body = response.json;
	} catch {
		return false;
	}

	if (typeof body !== 'object' || body === null) {
		return false;
	}

	const message = (body as { message?: unknown }).message;
	return typeof message === 'string' && /changed since you started editing/i.test(message);
}

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
	listMergeRequests,
	hasUnresolvedThreads,
	findOpenMergeRequest,
	deleteBranch,
	getDefaultBranch,
	getFileContent,
	getFileCommitId,
	commitToBranch,
	getMergeRequestChangedPath,
};
