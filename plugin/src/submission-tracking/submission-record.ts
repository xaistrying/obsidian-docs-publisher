/**
 * One record per submitted document, persisted in the plugin's own data and
 * keyed by `doc_id` — never by file path. `docs/document-identity.md` §3
 * establishes `doc_id`, not the path, as the identity that survives a
 * rename; a record keyed by path would silently orphan itself the first
 * time the author renames the file post-submit, which the design explicitly
 * allows.
 */
export interface SubmissionRecord {
	docId: string;
	/** `doc/<docId>` — derivable from `docId`, stored for convenience. */
	branch: string;
	mrIid: number;
	state: SubmissionState;
}

/**
 * The full submission-state enum, so this type accommodates milestones 5+
 * (`changes-requested`, `published`, `closed`) without a data migration.
 * This milestone only ever writes `pending` — `unsubmitted` is the absence
 * of a record, not a stored state, since nothing is tracked before a first
 * successful submit.
 */
export type SubmissionState = 'pending' | 'changes-requested' | 'published' | 'closed';

/**
 * Author-facing label for each state, never the internal name and never a
 * git-vocabulary term. Only `pending` is reachable through this milestone;
 * the rest are provisional placeholders reserved for milestone 5+ to revise
 * once those transitions are actually built.
 */
export const SUBMISSION_STATE_LABELS: Record<SubmissionState, string> = {
	pending: 'Waiting for review',
	'changes-requested': 'Changes requested',
	published: 'Published',
	closed: 'Closed',
};
