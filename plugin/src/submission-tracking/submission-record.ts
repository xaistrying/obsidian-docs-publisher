import type { ConnectionDetails, ProjectAccess } from '../git-publishing/gitlab-client';
import { normalizeHost } from '../git-publishing/gitlab-client';
import type { ConnectionState } from '../platform-config/connection-state';

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
	/**
	 * The merge request this record's state came from.
	 *
	 * OPTIONAL because an IMPORTED document has none: it was already on the
	 * default branch when this vault first saw it, so no merge request of this
	 * plugin's making ever produced it. Every record written by a submit has
	 * one. Anything that reads it must say what it does without one —
	 * `restorableDocuments` skips such records, which is correct twice over,
	 * since an imported document is published and Restore excludes published.
	 */
	mrIid?: number;
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
	/**
	 * The note's modification time as of this submit, so the panel can tell a
	 * document the author has edited since from one they have not.
	 *
	 * MTIME AND NOT A CONTENT HASH, deliberately. `TFile.stat.mtime` is in
	 * Obsidian's memory and readable synchronously, and the panel re-renders
	 * on every note switch and every front-matter edit — hashing would mean an
	 * async file read per tracked document on every one of those.
	 *
	 * The cost is a false positive: a note touched without being changed reads
	 * as edited. For a list whose job is "what might need you", that errs in
	 * the harmless direction — it offers an action the author can ignore,
	 * rather than hiding one they needed.
	 *
	 * Undefined for every record written before this field existed. Absent is
	 * read as NOT edited (`hasLocalEdits`): those records have no baseline, and
	 * guessing "edited" would light up every document the author has ever
	 * published at once.
	 *
	 * An `EditBaseline` rather than a number, so the only way to set it is
	 * `captureEditBaseline` (fix-edited-baseline design.md decision 2). It was
	 * once written from `file.stat.mtime` at three call sites and maintained by
	 * none, and every document read as edited from the moment it was sent.
	 */
	mtime?: EditBaseline;
	/**
	 * The project this record describes a document on.
	 *
	 * ABSENT MEANS NOT KNOWN, and not known is NOT the configured project
	 * (scope-records-to-their-project design.md decision 1). Every record
	 * written before this field existed lacks it, and so does one the remote
	 * has never matched. Stamped only on evidence — a submit or import that just
	 * wrote there, or a reconciliation that matched its `doc_id` there — never
	 * because a project happens to be configured. `belongsToProject` is the one
	 * reader.
	 */
	project?: ProjectRef;
}

/**
 * A project as a record identifies it: the platform address plus the
 * canonical numeric id. The address is part of it because the same path on
 * two instances is two unrelated projects; the numeric id rather than what the
 * author typed, because the settings accept either an id or a path for the
 * same project (design.md decision 2).
 */
export interface ProjectRef {
	host: string;
	id: number;
}

export function projectRef(details: ConnectionDetails, access: ProjectAccess): ProjectRef {
	return { host: normalizeHost(details.host).toLowerCase(), id: access.id };
}

/**
 * The project the plugin is pointed at, or null when no connection check has
 * established one. Null matches nothing, so an unverified connection shows no
 * stored state rather than one from wherever the details used to point.
 */
export function configuredProject(details: ConnectionDetails, state: ConnectionState): ProjectRef | null {
	return state.kind === 'verified' ? projectRef(details, state.access) : null;
}

/**
 * Whether this record belongs to the configured project — the ONE comparison,
 * so no surface writes its own (§D0h was a surface that did not ask at all).
 * False for an absent record, an unstamped one, or no configured project.
 */
export function belongsToProject(
	record: SubmissionRecord | undefined,
	project: ProjectRef | null
): record is SubmissionRecord {
	return (
		record?.project !== undefined &&
		project !== null &&
		record.project.host === project.host &&
		record.project.id === project.id
	);
}

declare const editBaselineBrand: unique symbol;

/**
 * A note's modification time as read from the FILESYSTEM after a plugin
 * write. Branded so a plain number — `file.stat.mtime`, above all, which is
 * Obsidian's cached stat and can still hold the pre-write value — cannot be
 * stored as one. Produced only by `captureEditBaseline`.
 */
export type EditBaseline = number & { readonly [editBaselineBrand]: true };

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

/**
 * The marker for a document whose record names a DIFFERENT project and that
 * the configured one holds nothing for — `inAnotherProject`. Not a state
 * label: it says where the document's review lives, not how it stands, and an
 * author who configured the wrong project needs it before pressing submit
 * (scope-records-to-their-project tasks.md 6.1).
 */
export const IN_ANOTHER_PROJECT_LABEL = 'In another project';
