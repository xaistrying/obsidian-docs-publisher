import { failureOf, isPushOptionsUnsupported } from './failures';
import type { GitResult } from './failures';
import { stdoutText } from './git-runner';
import type { ProcessResult } from './git-runner';
import type { ProjectAddress } from './project-address';
import { documentBranch, fetchedBranchRef, isValidRefPart } from './ref-names';
import { writeRef } from './repo';
import type { RepoContext } from './repo';
import { isUsableBranchName } from './test-access';

/**
 * Sends a commit to a document's branch, asking for a review request
 * (replace-rest-with-local-git-ssh design.md D5 steps 6 and 7, task 3.2).
 *
 * Only ever to `doc/<doc_id>`: the target is built here from an identity that
 * has been checked, so the default branch cannot be named by anything a caller
 * passes, and an identity read from a note cannot build an unsafe ref. Always to
 * the project address the caller verified and never to the name `origin`, whose
 * address and push address are settings an adopted repository may have changed.
 * Client-side hooks are skipped.
 *
 * The branch is replaced only if it is still what the caller last saw, or
 * absent when the caller saw none: a lease on an explicit value, which is also
 * how an abandoned branch is replaced in one step with no delete between.
 */
export interface PushRequest {
	address: ProjectAddress;
	docId: string;
	/** The commit to send. */
	commit: string;
	/** What the document's branch held when the caller last looked; null when it was not there. */
	expectedTip: string | null;
	title: string;
	defaultBranch: string;
}

export interface PushResult {
	/**
	 * `created`: the server reported a review request. `link-only`: the push
	 * went through and the server only offered a link, or said nothing, so the
	 * request has to be opened by hand. Partial success, not failure.
	 */
	reviewRequest: 'created' | 'link-only';
	/** Where to open a review request by hand, when the server said. */
	link: string | null;
}

const FULL_COMMIT = /^[0-9a-f]{40}$/;
const TITLE_LIMIT = 200;

/**
 * A title fit for a push option: one line, no control characters, at most 200
 * characters. A title that would be empty becomes the document's identity.
 */
export function pushTitle(title: string, fallback: string): string {
	// eslint-disable-next-line no-control-regex
	const single = title.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
	const chosen = single === '' ? fallback : single;
	return Array.from(chosen).slice(0, TITLE_LIMIT).join('');
}

/** Reads what the server said back about the review request, from the lines it prefixes with "remote:". */
export function parsePushReply(reply: string): PushResult {
	const lines = reply.split(/\r?\n/).map((line) => line.replace(/^remote:\s?/, '').trim());
	const created = lines.findIndex((line) => /^View merge request for\b/i.test(line));
	if (created !== -1) {
		return { reviewRequest: 'created', link: null };
	}
	const offered = lines.findIndex((line) => /^To create a merge request for\b/i.test(line));
	if (offered !== -1) {
		const link = lines.slice(offered + 1).find((line) => /^https?:\/\/\S+$/.test(line));
		return { reviewRequest: 'link-only', link: link ?? null };
	}
	return { reviewRequest: 'link-only', link: null };
}

function succeeded(result: ProcessResult): boolean {
	return result.spawnError === null && !result.timedOut && !result.truncated && result.exitCode === 0;
}

export async function pushDocumentBranch(ctx: RepoContext, request: PushRequest): Promise<GitResult<PushResult>> {
	// Everything that goes into the command is checked before it is built, and a
	// request that fails the check never reaches a process.
	if (!isValidRefPart(request.docId)) {
		throw new Error(`Docs Publisher: "${request.docId}" is not usable in a branch name`);
	}
	if (!FULL_COMMIT.test(request.commit) || (request.expectedTip !== null && !FULL_COMMIT.test(request.expectedTip))) {
		throw new Error('Docs Publisher: a push names full commit identifiers');
	}
	if (!isUsableBranchName(request.defaultBranch)) {
		throw new Error('Docs Publisher: the default branch is not a usable name');
	}
	const branch = documentBranch(request.docId);
	if (branch === request.defaultBranch) {
		throw new Error('Docs Publisher: refused to push to the default branch');
	}

	const ref = `refs/heads/${branch}`;
	const common = [
		'push',
		'--no-verify',
		`--force-with-lease=${ref}:${request.expectedTip ?? ''}`,
	];
	const options = [
		'-o',
		'merge_request.create',
		'-o',
		`merge_request.target=${request.defaultBranch}`,
		'-o',
		`merge_request.title=${pushTitle(request.title, request.docId)}`,
		'-o',
		'merge_request.remove_source_branch',
	];
	const target = [request.address.sshUrl, `${request.commit}:${ref}`];
	const send = (withOptions: boolean): Promise<ProcessResult> =>
		ctx.git.run({
			args: [...common, ...(withOptions ? options : []), ...target],
			cwd: ctx.cwd,
			remote: request.address.sshUrl,
		});

	let result = await send(true);
	let optionsSent = true;
	if (!succeeded(result) && isPushOptionsUnsupported(result)) {
		// Nothing was sent: git refuses before it does. So the same commit is sent
		// once, without the options, and the review request is for the author to open.
		optionsSent = false;
		result = await send(false);
	}
	if (!succeeded(result)) {
		return failureOf('push', result);
	}

	// The fetched copy now holds the pushed commit as the branch's tip, so the
	// document reads as waiting without another fetch. Best effort: the push
	// has already happened, and the next fetch puts this right if it is missed.
	const tracked = await writeRef(ctx, fetchedBranchRef(request.docId), request.commit);
	if (!tracked.ok) {
		console.error('Docs Publisher: the push went through but the fetched copy could not be updated');
	}

	const reply = parsePushReply(`${result.stderr}\n${stdoutText(result)}`);
	return { ok: true, value: optionsSent ? reply : { reviewRequest: 'link-only', link: reply.link } };
}
