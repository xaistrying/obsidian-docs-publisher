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
	/**
	 * The document's remote path, captured at the moment of a successful
	 * submit — added by add-document-recovery, going forward only. Undefined
	 * for every record persisted before this field existed, which is every
	 * record that exists as of that change shipping. Recovery falls back to
	 * reading the path off the record's still-open merge request for those
	 * (`recover.ts`) rather than treating the absence as an error. See that
	 * change's design.md decision 1.
	 */
	path?: string;
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
 * git-vocabulary term. Every one of these is now reachable: reconciliation
 * resolves all four from the remote, so none is a placeholder any more.
 *
 * `closed` reads "Not accepted" and not "Closed". The old label was recorded
 * as provisional while the state was unreachable; it is the author vocabulary
 * `openspec/config.yaml` settled on, and "Closed" both leaks the platform's
 * own word and tells an author nothing about what happened to their document.
 */
export const SUBMISSION_STATE_LABELS: Record<SubmissionState, string> = {
	pending: 'Waiting for review',
	'changes-requested': 'Changes requested',
	published: 'Published',
	closed: 'Not accepted',
};

/**
 * The label for a document the remote holds nothing for.
 *
 * Deliberately NOT a member of `SubmissionState` or of the table above:
 * `unsubmitted` is the absence of a record rather than a stored state, and
 * giving it a key would invite something to persist it.
 *
 * "Not submitted yet" and never "Draft" — decided 2026-09-11, resolving a
 * contradiction between `openspec/config.yaml` lines 340 and 699. The same
 * file rejects `draft` as a STATE name precisely because it collides with
 * GitLab's own Draft merge requests, and using it as the label the author
 * reads would reintroduce that ambiguity at the one surface that matters.
 */
export const UNSUBMITTED_LABEL = 'Not submitted yet';
