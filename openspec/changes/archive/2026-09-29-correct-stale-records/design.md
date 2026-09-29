## Context

Two defects, one sentence: the plugin writes records it will never correct.

`docs/ce-verification.md` §D0f is the reachable one and is confirmed in code.
`refreshDocumentStatuses` builds its work list from `listVaultDocuments(app)`,
which collects notes carrying a `doc_id`. A stored record whose note is gone is
not in that list, so it is never reconciled, so its `state` is frozen at
whatever the last successful submit wrote. `restorableDocuments` reads that
frozen state; `discoveryCandidates` excludes whatever `restorableDocuments`
offers. A merged document therefore sits on the restore list forever and is
suppressed from the import list, which is the one that could act on it.

§D0e is the rarer one and its trigger is unknown. A first submit created a
branch and a merge request, then wrote neither front matter nor a record. What
makes it unrecoverable rather than merely annoying is the missing `doc_id`:
every route back to a document turns that key, so the note became invisible to
the panel, to reconciliation and to the restore list at once.

The two share a shape. One record is never written; the other is never updated.
Fixing either alone would leave the other's documents in the same place.

## Goals / Non-Goals

**Goals:**

- Every document the plugin has a record for is reconciled, whether or not a
  note for it is in the vault.
- The restore list's self-emptying claim becomes true.
- A failure between a successful remote write and the local bookkeeping leaves
  a TRACKED document, never an orphaned one.

**Non-Goals:**

- Diagnosing §D0e's trigger. Worth doing, but this change makes the failure
  survivable rather than explaining it, and those are separable.
- `plugin-shell`'s stale restore-list requirement, which predates this and
  belongs to the spec-drift retro-change.
- Recovering documents ALREADY orphaned in an existing vault. See Migration.

## Decisions

### 1. Reconcile stored records, not vault notes

Pass reconciliation the union of the vault's `doc_id`s and the `doc_id`s of
stored records. The vault list stays the primary source; records add what it
cannot see.

**This is close to free, which is why it is the right fix rather than a
tempting one.** `reconcileDocuments` already takes a list of `doc_id`s and
makes ONE merge-request listing for all of them — `submission-tracking`'s
"Reconciliation reads the remote once for all documents" requires exactly that.
The marginal cost of an extra `doc_id` is at most one discussions read, and
only for a document whose merge request carries comments.

REJECTED: having `restorableDocuments` consult the remote. It was made purely
local on 2026-09-22 precisely to remove one request per record, along with the
refresh lifecycle and failure states that came with it. Putting that back to
fix a staleness problem would trade a bug for the complexity that was
deliberately deleted.

REJECTED: having `discoveryCandidates` stop deferring to a Restore entry it can
tell is settled. The deferral exists so one document never appears on two
surfaces; making it conditional on freshness needs the same information the
records already should have carried. It treats the symptom on the surface
furthest from the cause.

### 2. Reconciliation keeps its "carry forward, never recompute" rule

`writeBack` already carries `path` and `mtime` from the stored record rather
than rebuilding them, because only a submit establishes either. That rule is
load-bearing for this change: reconciling an orphaned record must correct its
`state`, `mrIid` and `branch` while leaving `path` and `mtime` alone — the
`path` is what a later Restore uses to put the note back, and erasing it while
fixing a state bug would break recovery to fix a listing.

No change to `writeBack`; this decision exists to record that it must not
acquire one.

### 3. The record is written BEFORE the front matter

On the first-submit path, `store.save` currently runs after
`writeSubmissionFrontMatter`. Reverse it.

The ordering decides what a failure in between costs. Today it costs the whole
local trace of work that already exists on the remote, and the note has no
`doc_id`, so nothing can find it again. Reversed, the same failure leaves a
tracked document whose front matter is incomplete — which reconciliation
resolves, the panel lists, and the author can see and resubmit.

**This does not require knowing why the failure happens.** An intermittent
fault on a write path will outlive any single diagnosis, and the ordering makes
the failure survivable whatever its cause.

The cost, stated plainly: a record can now exist for a document whose front
matter was never completed, so the note carries a `doc_id` and possibly no
`title` or `category`. That case is already handled — `add-discover-and-import`
established that a note carrying `doc_id` but no `category` has not been
through a first submit in this vault, and its next submit collects and writes
both (`docs/ce-verification.md` §E6). This change reaches the same state by a
different road.

### 4. The baseline is still captured from the filesystem, after the write

`captureEditBaseline` reads the adapter after the note is written, and decision
3 moves the record write before that. The baseline must therefore still be
captured at the point the note is final — either by writing the record twice
(once to claim the identity, once with the baseline) or by capturing the
baseline in the same save that follows the front-matter write.

Prefer the second: one record write that happens early and is UPDATED with the
baseline, using the store's existing baseline-only save path
(`saveEditBaseline`, added by `fix-edited-baseline`). Two full record writes
would give the same result and one more chance for the second to be skipped.

## Risks / Trade-offs

**A vault with many settled orphaned records reconciles them all on every
refresh** → They cost nothing extra in requests (decision 1) and drop off the
restore list as soon as they are corrected once, which is the point. A record
whose document is settled stays in the store, since nothing here deletes
records — reconciliation deliberately never does.

**An orphaned record for a document that no longer exists on the remote at all**
→ It resolves to nothing, exactly as a vault note with no merge request does
today, and the existing "no state label" handling applies. It does not become
recoverable and does not claim to be.

**Reversing the write order changes what a partial submit looks like** → From
an untracked note to a tracked one with incomplete front matter. That is the
trade being made deliberately, and the second is the state the plugin already
knows how to finish.

## Migration Plan

No data migration. Records already stale in an existing vault are corrected by
the first refresh after this ships, because they will now be reconciled — the
fix repairs existing damage rather than only preventing new damage.

Documents already orphaned by §D0e are NOT recovered: their notes carry no
`doc_id`, so nothing links them to the records they never got. The author adds
the `doc_id` by hand, as was done for `test-006` during the run, and
reconciliation reconnects them from that alone. Worth stating in the change's
tasks so the next person is not left looking for an automatic repair.

## Open Questions

- Whether §D0e's trigger is `createMergeRequest` answering `ok: false` for a
  merge request that WAS created, or `writeSubmissionFrontMatter` throwing. The
  console distinguishes them. This change does not depend on the answer, but
  the answer may deserve its own fix on top.
