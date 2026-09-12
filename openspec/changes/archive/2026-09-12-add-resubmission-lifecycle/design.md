## Context

`performSubmit` (`plugin/src/doc-authoring/submit-document.ts`) has one
pre-flight, `clearPreviousAttempt`, that answers two narrow questions —
does `doc/<doc_id>` exist, does it have an open merge request — and acts
on the four-way combination as if it only had two answers. Concretely:

- Pending/changes-requested (branch exists, open MR exists): refuses
  outright. Nothing written. This is milestone 6's gap.
- Published (branch absent, auto-deleted on merge): falls through to an
  ordinary first-submit commit with `action: 'create'`, which GitLab
  rejects because the file already exists on `main`. This is milestone
  7's bug, verified in `docs/resubmission-lifecycle.md` §2.
- Closed (branch exists, no open MR): deletes the stale branch, cuts
  fresh, `action: 'create'` — correct, because a closed-without-merge
  document was never merged to `main`. This already works (7a) but has no
  panel button.
- Unsubmitted (`existingDocId === null`): the existing, unaffected
  first-submit path, now preceded by add-document-recovery's path-
  collision pre-flight.

Separately, `docs/document-identity.md` §3-4 requires two checks "from the
second submit onward" — duplicate `doc_id` across two local notes, then a
local path drifted from the remote one — that this milestone pair is the
first to actually need, and neither exists in the codebase today.

Read `docs/resubmission-lifecycle.md` before this file; it carries the
verified bug trace and the reasoning this design assumes rather than
re-derives.

## Goals / Non-Goals

**Goals:**

- Every tracked state resolves to the correct write (or correct refusal)
  on resubmit, from one real state resolution rather than two ad hoc
  boolean questions.
- The two pre-submit checks (`docs/document-identity.md` §3-4) bind
  correctly, in the documented order, starting with this change.
- A real panel action exists for every tracked state.
- No document is ever written to with a stale base — `last_commit_id`
  accompanies every update commit.

**Non-Goals:**

- Milestone 7a's own mechanism (delete-then-recreate for Closed) is not
  touched, only given a button.
- Milestone 5b's panel repurposing ("Your documents" narrows to
  active-MR states, a second "Other documents" section for
  published/closed) is a separate change. This design's button renders
  wherever the document currently appears; it does not relocate rows.
- Attachments (4a) — the commit payload stays a single-file action; a
  multi-action array is that milestone's to add.
- Any change to reconciliation's own behavior for the panel's batch
  refresh (`reconcileDocuments`, used by `renderDocumentList`).

## Decisions

### 1. State resolution: a new, single-document, branch-filtered call —
not `reconcileDocuments` reused as-is, and not a third independent
re-derivation

`reconcileDocuments` answers "what state is every one of these `doc_id`s
in" with ONE unfiltered `listMergeRequests` call shared across all of
them — correct for the panel's batch refresh, wasteful for resubmit,
which only ever needs one document's answer and would otherwise paginate
through the whole project's merge-request history to get it.

`listMergeRequests` already accepts a `sourceBranch` filter
(`MergeRequestQuery.sourceBranch`), unused by `reconcileDocuments` because
its shared listing can't be filtered per-document. Submit's resolution
uses it: `listMergeRequests(details, { sourceBranch: branch })`, then the
SAME open-wins/else-most-recent precedence `reconcile.ts`'s `resolveOne`
already implements.

DECIDED: extract that precedence logic out of `resolveOne` into a
function both callers share (`resolveMergeRequestState(entries): ...` or
equivalent), and add a new, thin, submission-tracking-owned function —
`resolveDocumentState(details, docId)` — that fetches the filtered
listing and applies the shared logic. `reconcileDocuments` calls the same
shared logic against its own bulk listing; `performSubmit` calls the new
function for one document. One precedence rule, two fetch strategies,
matched to two different callers' actual needs.

REJECTED: calling `reconcileDocuments` with a single-element array. It
would work, but every resubmit would then pay for an unfiltered,
un-paginated-away listing call sized to the whole project, for a question
answerable with one filtered query — the over-fetch `docs/resubmission-
lifecycle.md` §3 flagged.

REJECTED: a third, independent re-derivation (what `clearPreviousAttempt`
already is). Two implementations of "what state is this document in,"
one for the panel and one for submit, is exactly the drift risk `docs/
resubmission-lifecycle.md` §3 raised as the reason to reuse in the first
place.

### 2. The two pre-submit checks run against the resolved state, in the
documented order, before any write

`docs/document-identity.md` §4: duplicate `doc_id` first, then path
mismatch — reversed, a duplicated note reads as "moved."

- **Duplicate `doc_id`**: scan `listVaultDocuments(app)` for any OTHER
  file whose `doc_id` equals this note's. A hit refuses before any remote
  call — this is a purely local check and the cheapest one to run first
  regardless of order-of-checks, since it costs nothing to ask before
  spending a network round trip on the second check.
- **Path mismatch**: compare `file.path` (case-sensitive, per §4) against
  the path this change's own state resolution already read from the
  resolved merge request's changed file — no second remote call, since
  decision 1's resolution already has to look at the merge request to
  determine state, and its path is available from the same read
  (mirroring the existing `getMergeRequestChangedPath` call recovery
  already uses for its own legacy-record fallback).

Both checks bind for EVERY resubmit (pending, changes-requested,
published, closed) — `docs/document-identity.md` §4 says "from the second
submit onward," not "only for some resolved states." Closed's existing
delete-then-recreate path gains these two checks now for the first time,
same as the other three.

### 3. The commit verb and `last_commit_id` are decided by the resolved
state, not re-derived per call site

- **Pending/changes-requested**: commit to the existing branch,
  `action: 'update'`, `last_commit_id` read fresh from that branch
  immediately before the commit (not cached from the state resolution
  above — state resolution reads the merge request, not the file's
  current commit on the branch, and the two can be milliseconds apart
  under concurrent edits).
- **Published**: cut fresh from current `main` (unchanged), commit
  `action: 'update'`, `last_commit_id` read fresh from `main` immediately
  before the commit, for the same reason.
- **Closed**: delete stale branch, cut fresh, `action: 'create'` (file
  never existed on `main` — never merged). No `last_commit_id`: `create`
  has nothing to be stale relative to.
- **Unsubmitted**: unchanged, `action: 'create'`.

Reading `last_commit_id` needs a new `git-publishing` call —
`getFileCommitId(details, { path, ref })`, mirroring `getFileContent`'s
three-way shape (exists-with-id / absent / failed) for the identical
reason: a failed read must refuse the commit, never fall through to
"proceed without it." `getFileContent` itself is not reused for this,
because it hits the `/raw` endpoint (content only, no metadata); this
calls the non-raw `GET .../repository/files/:file_path` endpoint instead,
which returns `last_commit_id` directly and makes a second content read
unnecessary where only the id is needed.

### 4. Two commit call shapes, one shared internal payload builder

`createBranchWithCommit` (branch creation + commit, `start_branch` set)
stays for Closed and Published. A new sibling, `commitToBranch` (no
`start_branch`), covers Pending/changes-requested. Both take the action
verb and optional `last_commit_id` as parameters instead of
`createBranchWithCommit` hardcoding `'create'`, and both build the same
`actions: [{...}]` payload shape internally — the only difference between
the two exported functions is whether `start_branch` is present, matching
`openspec/config.yaml`'s own architecture note ("Subsequent revisions
commit to the existing branch, so they omit `start_branch`").

REJECTED: one function with an `isNewBranch: boolean` flag. Two named
functions read at the call site as what they do; a boolean forces the
reader back to the implementation to know which behaviour `true` means.

### 5. Message wording

`ALREADY_AWAITING_REVIEW_MESSAGE` no longer fires from the resubmit path
— pending/changes-requested now push an update instead of refusing. It
remains exactly as-is for `checkTargetPathFree`'s first-submit collision
case, which is a genuinely different document and keeps needing the
hedge. A new success notice is not needed: `SUBMISSION_STATE_LABELS.pending`
("Waiting for review") already covers every path that ends in `pending`,
first submit included.

Two new refusal messages, vocabulary-checked (no "branch", "commit",
"merge request", "MR", "conflict", "main"):
- Duplicate `doc_id` found locally.
- Local path no longer matches the remote path (names the correct path,
  per `docs/document-identity.md` §4's own requirement).

Exact copy is a specs/tasks concern, not fixed here.

### 6. Pushing an update does not itself resolve "changes-requested" — the
roadmap's "flips back to pending" is corrected here

Milestone 6's own roadmap text says sending an update "commits to the
existing branch/MR and flips back to pending." That is not mechanically
true: `add-document-status`'s reconciliation resolves changes-requested
purely from whether the merge request carries unresolved review threads
(`docs/resubmission-lifecycle.md`'s dependency), and pushing a new commit
does not resolve an existing thread on GitLab — only the reviewer
resolving it, or the author resolving it themselves in GitLab, does.

DECIDED: the push succeeds and the note's content reaches the branch
regardless of thread state; the document's DISPLAYED state is left to the
next reconciliation refresh, exactly as every other state change already
is (`add-document-status` design.md decision 5: render from what's known,
refresh only on explicit request). It SHALL NOT optimistically flip the
local cache to pending before the remote agrees. A document pushed while
changes-requested may therefore still read as changes-requested
immediately afterward, until threads are resolved and the author (or the
panel's Refresh) asks again — which is correct, not a bug: the review
comment is still open.

REJECTED: optimistically setting the local record to pending on a
successful push. It would show the author a state the remote does not
yet agree with, contradicting the "remote decides" principle
add-document-status established, and would self-correct back to
changes-requested on the next refresh anyway — a confusing flicker for no
benefit.

## Risks / Trade-offs

**Reading `last_commit_id` immediately before commit adds one request to
every update path** → Accepted: the alternative (reusing a value read
during state resolution) risks committing against a stale id if anything
changed between resolution and write, which is exactly the silent-
overwrite risk `last_commit_id` exists to prevent in the first place.

**The path-mismatch check's remote path now comes from state resolution's
existing merge-request read rather than a dedicated call** → Depends on
decision 1 actually surfacing that path; if the resolution function is
built without it, this check needs its own read. Flagged for whoever
implements decision 1 to confirm before decision 2 is built on top of it.

**Two new local-vault-wide checks (duplicate `doc_id` scan) run on every
resubmit** → Cheap (in-memory front-matter reads Obsidian already
caches), and runs first specifically because it's cheap, per decision 2.

## Open Questions

- Exact function names and module boundaries for decision 1's extracted
  precedence logic — `reconcile.ts` vs. a new file — left to
  implementation, following `submission-tracking`'s existing convention
  of one file per direction of "what does the remote know."
- Whether `getFileCommitId` and `getFileContent` should be unified into
  one call that optionally skips the content body — left to
  implementation; GitLab's non-raw file endpoint returns both from one
  request, so there may be no reason to keep them separate once this is
  built.
