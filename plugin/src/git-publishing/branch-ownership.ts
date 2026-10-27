import { failureOf } from './failures';
import type { GitResult } from './failures';
import { stdoutText } from './git-runner';
import type { ProcessResult } from './git-runner';
import { fetchedBranchRef, fetchedDefaultRef, sentRef } from './ref-names';
import { readRef } from './repo';
import type { RepoContext } from './repo';

/**
 * Whether a document's branch holds commits this vault did not build
 * (replace-rest-with-local-git-ssh design.md D5 pre-checks 5 and 7, task 3.3).
 *
 * "This vault built it" means reachable from the commit this vault last
 * recorded as sent for the document, and never an email address: an address
 * changes with the author's identity and the machine, and comparing it would
 * call the author's own earlier work someone else's.
 *
 * Every answer is yes, no or "could not read", and a failed read is never "no":
 * a caller decides whether to push over a branch from this, and reading a
 * failure as "nobody else touched it" would license overwriting a reviewer's work.
 */
export type Answer = 'yes' | 'no' | 'failed';

function ran(result: ProcessResult): boolean {
	return result.spawnError === null && !result.timedOut && !result.truncated;
}

/**
 * Whether the fetched branch's tip is one this vault built. A vault that has
 * recorded nothing for the document built nothing on it, so the answer is "no".
 */
export async function tipBuiltHere(ctx: RepoContext, docId: string): Promise<Answer> {
	const sent = await readRef(ctx, sentRef(docId));
	if (!sent.ok) {
		return 'failed';
	}
	const tip = await readRef(ctx, fetchedBranchRef(docId));
	if (!tip.ok || tip.value === null) {
		return 'failed';
	}
	if (sent.value === null) {
		return 'no';
	}
	const ancestry = await ctx.git.run({ args: ['merge-base', '--is-ancestor', tip.value, sent.value], cwd: ctx.cwd });
	if (ran(ancestry) && ancestry.exitCode === 0) {
		return 'yes';
	}
	return ran(ancestry) && ancestry.exitCode === 1 ? 'no' : 'failed';
}

/**
 * Whether the fetched branch carries a commit that is not on the default
 * branch, was not built here, and changes one of the given paths. A commit that
 * changes some other file does not count: a reviewer's note on another document
 * is none of this send's business.
 */
export async function foreignCommitTouching(
	ctx: RepoContext,
	docId: string,
	defaultBranch: string,
	paths: readonly string[]
): Promise<GitResult<boolean>> {
	if (paths.length === 0) {
		return { ok: true, value: false };
	}
	const sent = await readRef(ctx, sentRef(docId));
	if (!sent.ok) {
		return sent;
	}
	const args = ['rev-list', '--count', fetchedBranchRef(docId), `^${fetchedDefaultRef(defaultBranch)}`];
	if (sent.value !== null) {
		args.push(`^${sent.value}`);
	}
	args.push('--', ...paths);
	const counted = await ctx.git.run({ args, cwd: ctx.cwd });
	if (!ran(counted) || counted.exitCode !== 0) {
		return failureOf('rev-list', counted);
	}
	return { ok: true, value: Number(stdoutText(counted).trim()) > 0 };
}
