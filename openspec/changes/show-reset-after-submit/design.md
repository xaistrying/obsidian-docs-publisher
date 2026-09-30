## Context

The open-note section of the panel reads a document's state from two
sources (`plugin/src/main.ts`):

- The label and the resubmit button's name come from `effectiveState(status,
  record, project)`. It uses the resolved status when there is one and falls
  back to the stored record, which a submit writes at once.
- Reset comes from `renderResetAction`, which calls
  `resettableDocument(statuses.statusFor(docId))`. `statusFor` reads
  `DocumentStatusHolder`, the in-memory map of states resolved in this
  session. Only `refreshDocumentStatuses` writes it, through `recordSuccess`,
  which replaces the whole map. `clear` empties it when the connection
  changes.

A submit writes the stored record and never the holder. So:

- **First submit.** There is no status, so the label falls back to "Waiting
  for review" and Reset is withheld (§D0d).
- **New version of a published or not-accepted document.** The status still
  says `published` or `closed`, and it beats the stored record's `pending`.
  The note keeps its old label and its old button ("Submit a new version" or
  "Submit again") until a refresh, although a review is now open.

The gate itself stays. The plugin-shell spec ties Reset to the resolved state,
and §D0d agrees: a stored state can be left over from an earlier session.

Every submit that opens a review goes through **`openNewCycle`**
(`plugin/src/doc-authoring/submit-document.ts`), called from three places:

- `performSubmit` for a first submit;
- `performResubmit` when a document with a frozen `doc_id` has no submission on
  the remote, including an imported document's first submit;
- `openFreshCycle`, for published and not accepted.

"Send update" is `pushUpdate`, which commits to the existing branch and never
reaches `openNewCycle`.

## Goals / Non-Goals

**Goals:**
- Reset, the label and the resubmit button agree right after any submit that
  opened a review, with no refresh.
- The Reset gate keeps its current rule: no change to `resettableDocument` or
  `renderResetAction`'s logic.

**Non-Goals:**
- Any change to what "Send update" shows (config milestones 6/7/7a).
- Any change to Restore.
- New author-facing copy.
- Coordinating a submit with a refresh already running.

## Decisions

### 1. What makes pending certain after `openNewCycle`, as read from the code

The claim is that once `openNewCycle` has succeeded, a refresh would resolve
the document as `pending` with the returned review number. Here is the
evidence for each part of it:

- **Open, and the only open one.** Before `openNewCycle` runs, every caller
  has already established that nothing is open from this branch:
  - `clearPreviousAttempt` stops when it finds a branch *and* an open review;
  - `openFreshCycle` runs only after `resolveDocumentState` has resolved
    `published` or `closed`, which are the "nothing open" answers, and then
    clears the branch;
  - the `submission === null` path runs `clearPreviousAttempt` too.

  So the review `createMergeRequest` just returned is the one open review for
  `doc/<doc_id>`. Under `resolveMergeRequestState`'s precedence, "an open
  merge request wins".
- **Not changes-requested.** `hasUnresolvedThreads` counts only notes that are
  `resolvable` and not `resolved` (`hasUnresolvedNote`). A review created a
  moment ago carries no reviewer threads. The only notes GitLab adds on
  creation are system notes, which are not resolvable. `openNewCycle`'s own
  comment already says this: "it is open by construction, and it cannot yet
  carry a review thread."
- **Draft status doesn't matter.** `createMergeRequest` posts `source_branch`,
  `target_branch` and `title` and nothing else, so no draft flag is sent. A
  title the author starts with "Draft:" could still make GitLab mark it as a
  draft, but `resolveMergeRequestState` never reads draft status. A refresh
  would give `pending` either way.
- **Even the unlikely miss is safe for Reset.** A reviewer could open a thread
  in the seconds before the author looks. That turns the true state into
  changes-requested, which `resettableDocument` accepts too. Reset would only
  be offered wrongly if the review had *ended* in those seconds. That is the
  same staleness any resolved state has, and Reset's read already refuses it
  (decision 6).

### 2. The write lives in `openNewCycle`, right after `store.save`

`openNewCycle` is the one place a review is opened, so one call there covers
all three routes and nothing else can reach it. The call goes directly after
the existing `store.save({ state: 'pending', … })`, so the stored record and
the resolved state become true at the same moment. That is before the
front-matter write, so a failed front-matter write can't leave a record
without a resolved state. A first submit whose front-matter write fails
leaves the note without a `doc_id`, and `renderResetAction` returns early for
that anyway.

*Rejected: writing it from `main.ts` after the submit.* `submitForReview`
returns before the remote sequence runs, and its outcome isn't reported back.
Finding it out would mean reporting results up through every path in
`performSubmit`, which costs more than passing one argument down.

### 3. A dedicated holder method with pending hard-coded, not a generic setter

`DocumentStatusHolder` gains one method, working name
`recordNewReview(docId, mrIid)`. It sets `{ docId, submission: { state:
'pending', mrIid, webUrl: null } }` for that one document and notifies
listeners, which triggers the view's existing `scheduleRender`. It leaves
`lastOutcome` alone: recording one document is not a refresh, so the list's
"check failed" line and section suffixes stay accurate for everything else.

*Rejected: `set(document: ResolvedDocument)`.* That would make it one line of
code for `pushUpdate` to write `pending`, which is exactly the flip the
config rejected. Hard-coding the state keeps the restriction in the type.

The holder reaches `openNewCycle` as an explicit parameter, following the path
`store` already takes: `submitForReview` → `performSubmit` →
`performResubmit` / `openFreshCycle` → `openNewCycle`. `main.ts`'s
`submitForReview` passes `this.documentStatuses`. A callback would mean the
same number of signature changes, plus an indirection.

### 4. "Send update" records nothing

`pushUpdate` is left as it is. A resolved state from before the update stays
as it was. An unresolved one stays unresolved.

For the unresolved case, the author sees what they see today:

- the label from the stored record ("Waiting for review" or "Changes
  requested");
- "Send update";
- no Reset;
- the existing notice "Your update was sent. Refresh to see where the review
  stands.", which already points at Refresh.

This case needs a session where no refresh has resolved the document: the
first refresh failed, or the connection changed. Opening the panel refreshes,
so it is uncommon.

*Noted, not done:* `performResubmit` does resolve the state freshly from the
remote before the push (`resolveDocumentState`), so that pre-push answer is a
genuine resolved state. Recording it would not be a flip. It is still
excluded here, because this change's scope is "only where this session's own
write makes the state certain", and that answer comes from a read, not from
the write. It is listed in the proposal as deferred.

### 5. Restore is unchanged, because it is already honest

`restorableDocuments` is built from stored records alone, so being offered
Restore proves nothing about the state. A restore writes nothing to the
remote. `fetchResetContent` reads the review's changed path and the file on
the document's branch. That shows the branch exists, not that the review is
open or has no threads. So a restore can't record a resolved state honestly.

It doesn't need to. `refreshDocumentStatuses` has reconciled every stored
record since `correct-stale-records`, not only the vault's notes, so a record
whose note was deleted still gets a holder entry. After any successful refresh
in this session, restoring that note brings it back with its `doc_id`, and
`renderResetAction` finds the entry: Reset shows with no further refresh.
§D7's "no Reset after restore" was observed on 2026-09-27, before that change
(2026-09-29), when refresh covered vault notes only. Task 3.6 re-runs it.

Before any refresh has succeeded, Reset stays hidden after a restore. That is
the gate working as intended, and the proposal lists it as deferred.

### 6. No link, and no new failure messages

`createMergeRequest` parses only `iid`, so the recorded entry carries
`webUrl: null`. The row's "Open in GitLab" link, which requires a non-null
`webUrl`, appears on the next refresh. After a new cycle this also drops the
link to the previous, finished review, which was out of date anyway.

Parsing `web_url` would change git-publishing's parser for a link, which is
out of scope.

Failure paths are unchanged: every failure in `openNewCycle` returns before
`store.save`, so nothing is recorded. A Reset pressed after the review has
been published and its branch removed gets the existing
`RESET_UNAVAILABLE_MESSAGE`: "This document's review has already finished, so
nothing was reset. Refresh to see where it stands now."

### 7. Nothing persisted

The holder is session memory by design, and a stored state from an earlier
session is precisely what the gate refuses to trust. The submit already saves
its record to `data.json`, so nothing is added there. After a reload, the
document is unresolved until the refresh that runs when the panel opens.

## Risks / Trade-offs

- **[A refresh already running when the submit completes.]** Its
  `recordSuccess` replaces the map with an answer that may have been read
  before the review existed. Reset disappears again until the next refresh.
  → Accepted: this can only take Reset away, never offer it wrongly. The
  older race between a refresh's write-back and the submit's `store.save`
  is not touched here.
- **[The review ends seconds after it was opened.]** → Same staleness as any
  resolved state. Reset's branch read refuses with the existing message
  (decision 6).
- **[A signature change on the path `add-action-busy-states` also edits.]**
  Both changes add a parameter to `submitForReview`. → They are independent;
  whichever lands second rebases (see tasks.md).
- **[`openNewCycle` is exported for `tests/submit-ordering.test.ts`.]** The
  test's call gains the holder argument. → Updated in the same task, which
  also adds the assertions for this change.

## Migration Plan

None. Nothing is stored. The change ships with the next build and rolls back
with it.

## Open Questions

None blocking. Whether Send update should record its pre-push resolved state
(decision 4) is a candidate for a later change.
