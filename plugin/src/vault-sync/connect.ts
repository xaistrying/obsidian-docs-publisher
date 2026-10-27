import { AUTHOR_MESSAGES } from '../author-messages';
import type { GitFailureKind } from '../git-publishing/failures';
import { parseProjectAddress } from '../git-publishing/project-address';
import type { ProjectAddress } from '../git-publishing/project-address';
import { CONNECTED_REF, SYNCED_REF, fetchedDefaultRef } from '../git-publishing/ref-names';
import {
	advanceHead,
	discardNewRepository,
	emptySyncedCommit,
	ensureExclude,
	fetchProject,
	headRelation,
	initRepository,
	inspectRepo,
	projectUsesSha1,
	readDefaultBranch,
	readRef,
	writeRef,
} from '../git-publishing/repo';
import type { RepoContext } from '../git-publishing/repo';

/**
 * Connecting a vault to its project (replace-rest-with-local-git-ssh design.md
 * D6, task 2.3).
 *
 * Adopts the vault without touching a file in it. A folder with no repository
 * gets one made, linked and brought level with the project by a mixed reset,
 * which moves the index and nothing on disk, so every note the vault holds
 * simply reads as different from, or absent from, the project's copy. A folder
 * that already is a repository is adopted only when that is safe, and then
 * nothing at all moves: it is checked, and the two bookkeeping refs are
 * written.
 *
 * Refusals change nothing — not a file, not the repository, not its settings —
 * and are told in plain words that say what to do. A failure (the network, a
 * missing program) is a different answer from a refusal and is reported as the
 * kind it is, for the setup screen to word.
 */
export type ConnectRefusal = 'foreignOrigin' | 'differentVersion' | 'unsentChanges' | 'nestedVault';

export type ConnectResult =
	| { ok: true; message: string }
	| { ok: false; kind: 'refused'; reason: ConnectRefusal; message: string }
	| { ok: false; kind: 'failed'; failure: GitFailureKind };

function refused(reason: ConnectRefusal): ConnectResult {
	return { ok: false, kind: 'refused', reason, message: AUTHOR_MESSAGES[reason] };
}

function failed(failure: GitFailureKind): ConnectResult {
	return { ok: false, kind: 'failed', failure };
}

const CONNECTED: ConnectResult = { ok: true, message: AUTHOR_MESSAGES.vaultConnected };

export async function connectVault(ctx: RepoContext, address: ProjectAddress): Promise<ConnectResult> {
	const report = await inspectRepo(ctx);
	if (!report.ok) {
		return failed(report.failure);
	}
	const found = report.value;
	if (found.present && !found.topLevelIsVault) {
		return refused('nestedVault');
	}
	return found.present ? adopt(ctx, address, found) : create(ctx, address);
}

/** A repository is already here. Adopt it only if all four things that make that safe hold. */
async function adopt(
	ctx: RepoContext,
	address: ProjectAddress,
	found: { origin: string | null; branch: string | null; objectFormat: 'sha1' | 'other' }
): Promise<ConnectResult> {
	if (found.objectFormat !== 'sha1') {
		return failed('unexpected');
	}
	const origin = found.origin === null ? null : parseProjectAddress(found.origin);
	if (origin === null || origin.sshUrl !== address.sshUrl) {
		return refused('foreignOrigin');
	}

	const connected = await readRef(ctx, CONNECTED_REF);
	if (!connected.ok) {
		return failed(connected.failure);
	}
	if (connected.value !== null) {
		// Already done: nothing changes, and the author is told so.
		return CONNECTED;
	}

	const defaultBranch = await readDefaultBranch(ctx, address);
	if (!defaultBranch.ok) {
		return failed(defaultBranch.failure);
	}
	if (found.branch !== defaultBranch.value) {
		return refused('differentVersion');
	}
	const fetched = await fetchProject(ctx, address);
	if (!fetched.ok) {
		return failed(fetched.failure);
	}
	const tip = await readRef(ctx, fetchedDefaultRef(defaultBranch.value));
	if (!tip.ok || tip.value === null) {
		return failed(tip.ok ? 'empty-repository' : tip.failure);
	}
	const relation = await headRelation(ctx, tip.value);
	if (!relation.ok) {
		return failed(relation.failure);
	}
	if (relation.value === 'diverged') {
		return refused('unsentChanges');
	}

	// HEAD, not the fetched tip, so that notes older than the project's are
	// brought up by the next update and not shown as the author's own changes.
	const head = relation.value === 'unborn' ? { ok: true as const, value: tip.value } : await readRef(ctx, 'HEAD');
	if (!head.ok || head.value === null) {
		return failed(head.ok ? 'unexpected' : head.failure);
	}
	return record(ctx, head.value);
}

/** No repository: make one, link it, fetch, record, and bring the index level. Takes back everything it made if any step fails. */
async function create(ctx: RepoContext, address: ProjectAddress): Promise<ConnectResult> {
	const sha1 = await projectUsesSha1(ctx, address);
	if (!sha1.ok) {
		return failed(sha1.failure);
	}
	if (!sha1.value) {
		return failed('unexpected');
	}
	const defaultBranch = await readDefaultBranch(ctx, address);
	if (!defaultBranch.ok) {
		return failed(defaultBranch.failure);
	}

	const made = await initRepository(ctx, address, defaultBranch.value);
	if (!made.ok) {
		return failed(made.failure);
	}
	const abandon = async (failure: GitFailureKind): Promise<ConnectResult> => {
		await discardNewRepository(ctx);
		return failed(failure);
	};

	const fetched = await fetchProject(ctx, address);
	if (!fetched.ok) {
		return abandon(fetched.failure);
	}
	const tip = await readRef(ctx, fetchedDefaultRef(defaultBranch.value));
	if (!tip.ok || tip.value === null) {
		return abandon(tip.ok ? 'empty-repository' : tip.failure);
	}
	// Nothing has been received yet, so the base is empty and the first update
	// downloads the project. (An adopted repository records its HEAD instead.)
	const nothing = await emptySyncedCommit(ctx);
	if (!nothing.ok) {
		return abandon(nothing.failure);
	}
	const recorded = await record(ctx, nothing.value);
	if (!recorded.ok) {
		await discardNewRepository(ctx);
		return recorded;
	}
	// The one command that moves the index and HEAD, and only for a repository
	// just made: a mixed reset, which writes nothing to the working tree.
	const moved = await advanceHead(ctx, tip.value);
	if (!moved.ok) {
		return abandon(moved.failure);
	}
	return CONNECTED;
}

/** The two bookkeeping refs, and the ignore file. Nothing else is written. */
async function record(ctx: RepoContext, commit: string): Promise<ConnectResult> {
	const excluded = await ensureExclude(ctx);
	if (!excluded.ok) {
		return failed(excluded.failure);
	}
	for (const ref of [SYNCED_REF, CONNECTED_REF]) {
		const written = await writeRef(ctx, ref, commit);
		if (!written.ok) {
			return failed(written.failure);
		}
	}
	return CONNECTED;
}
