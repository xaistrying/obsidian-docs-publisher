/**
 * What an author is told when their role, rather than their details, is the
 * obstacle.
 *
 * Shared rather than written at each surface: the panel shows these as a state
 * and the authoring gate says the same sentence in a `Notice`. An author who
 * reads one and then triggers the other must not be told two different things
 * about the same role.
 *
 * Kept out of `connection-state.ts`, which answers which band a state falls in
 * and holds no copy, and out of the panel, which owns only the copy that is
 * specific to being a panel.
 */

/**
 * The LOCKED band — levels 0, 10 and `null`. The connection genuinely
 * succeeded, so the next action is not "check your details".
 * See `docs/gitlab-roles.md` §4.
 */
export const NO_DOCUMENT_ACCESS_MESSAGE =
	"Your GitLab account does not have access to this project's documents. " +
	'Ask your admin for access.';

/**
 * The READ-ONLY band — Planner and Reporter. Names the role the author holds,
 * because "you cannot add to this" is only actionable alongside what they do
 * have. Role names are shown literally — see `docs/gitlab-roles.md` §7.
 */
export function readOnlyMessage(roleLabel: string): string {
	return (
		`Your ${roleLabel} access lets you read this project's documents but not add to them. ` +
		'Ask your admin for Developer access.'
	);
}

/**
 * Shown when the configured project's repository has no commits yet.
 *
 * NOT A NICETY, and not the same as "something went wrong". In an empty
 * GitLab repository the FIRST branch created becomes the default branch, so
 * a first submit into one makes that document's own `doc/<doc_id>` the
 * default, its review cannot open (source and target would be the same
 * branch), and every later submit is refused by the collision check against
 * the document's own file. A real project was left permanently unusable this
 * way on 2026-09-21, which is why the plugin now refuses before writing
 * rather than reporting afterwards.
 *
 * Says what to do, and says it in a way that works from the platform's own
 * UI. Vocabulary-checked like every author-facing string: no "branch",
 * "commit", "merge request", "MR", or "main" — "starting file" is the plain
 * way to say what a repository needs before anything can be published into
 * it. "Open in GitLab" remains the one sanctioned naming of the platform.
 */
export const EMPTY_REPOSITORY_MESSAGE =
	'This project has no files yet, so there is nothing to publish into. ' +
	'Add a starting file to it in GitLab — a README will do — then try again.';
