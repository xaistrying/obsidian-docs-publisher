# Resubmission lifecycle: milestones 6, 7, 7a — what shipped, and the bug it fixed

Background for the three milestones that all touch the same code path:
`performSubmit` in `plugin/src/doc-authoring/submit-document.ts`, when a
document already has a frozen `doc_id`.

SHIPPED 2026-09-12 as one change, `add-resubmission-lifecycle`. All three
milestones are DONE in `openspec/config.yaml`. §0 below is the behaviour as
it now stands and is what to read first; §1-§3 are kept VERBATIM as the
pre-change record — what was verified by reading the code earlier the same
day, ahead of proposing the change — because the bug trace is the reasoning
the fix rests on and a later reader deciding whether to touch this path
needs to see what it used to do. Read them as history, not as current
behaviour. §4-§6 are annotated in place where they are now out of date.

Read `docs/document-identity.md` §5 first — branch recreation is settled
there and this doc does not re-derive it.

## 0. What it does now

`performSubmit` forks once, on whether the note carries a frozen `doc_id`.

**No `doc_id`** — a first submit, unchanged: `checkTargetPathFree`, then
`clearPreviousAttempt`, then cut a branch and commit `create`, open a merge
request, tell the author "Waiting for review".

**A `doc_id`** — `performResubmit`, which asks two questions and then acts on
the real state:

1. **Duplicate `doc_id`** across two notes in this vault — purely local,
   costs no request, refuses naming the other note. First, per
   `docs/document-identity.md` §4's load-bearing order.
2. **Path mismatch** — the note's path against the path the document's own
   merge request changed, case-sensitive; refuses naming the path to restore.
   A path that could not be ESTABLISHED (no submission, or a merge request
   that changed other than exactly one MARKDOWN file) is never read as "no
   path".

   The markdown qualifier arrived with add-attachment-sync (2026-09-13) and
   is the reason this check still binds. A submission now carries the note
   AND the images it embeds, so the old "exactly one file" rule would have
   answered "could not be determined" for every illustrated document — and
   this check SKIPS on that answer rather than refusing, so it would have
   stopped binding silently. The rule lives in `getMergeRequestChangedPath`;
   nothing here changed to accommodate it.

Both bind for every resolved state, not for some. Then
`resolveDocumentState` (`submission-tracking/document-state.ts`) resolves
this ONE document from a branch-filtered listing, sharing
`resolveMergeRequestState` with the panel's bulk pass so the two cannot
answer differently, and the fork runs:

```
pending / changes-requested  → read last_commit_id on the branch, then
                               commitToBranch, action: update. No new
                               branch, no new merge request. The stored
                               state is carried through unchanged — never
                               set to pending (§ below, and the roadmap's
                               own "flips back to pending" is corrected in
                               config.yaml).
published / not accepted     → clear any lingering branch, cut fresh from
                               the CURRENT default branch, read
                               last_commit_id there, commit update if the
                               file is present and create if it is not,
                               open a new merge request, "Waiting for
                               review".
no submission at all         → clearPreviousAttempt, then cut fresh and
                               create. The interrupted-attempt path.
```

The commit verb for the fresh-cycle paths is READ rather than inferred from
the state — published normally means the file is there and not-accepted
normally means it is not, but a Maintainer may have moved a published file
and someone else may have published into a turned-down document's path. One
read covers both.

`last_commit_id` is read immediately before each write and never carried
over from state resolution: resolution reads the merge request, not the
file's current commit, and a reviewer editing in the Web IDE between the two
is exactly what the field exists to catch.

The panel offers a named action for all four states — "Send update" for the
two under review, "Submit a new version" / "Submit again" for the two whose
cycle is over — all routed through the same `submitForReview` the command
palette calls, so the fork lives in one place.

## 1. What the code did BEFORE this shipped, per resolved state

> Historical. Kept verbatim; §0 above is current.

`performSubmit` (`submit-document.ts:128-208`) does not ask reconciliation
what state a tracked document is in. It re-derives a narrower answer itself,
through `clearPreviousAttempt` (`submit-document.ts:296-325`): does
`doc/<doc_id>` exist, and if so, does it have an open merge request. Walking
every state `reconcile.ts` can resolve a document to, against that pair of
questions:

- **unsubmitted** (`existingDocId === null`): the collision pre-flight
  (`checkTargetPathFree`, add-document-recovery) runs, then an ordinary
  `createBranchWithCommit` with `action: 'create'`. Works.
- **pending** or **changes-requested** (branch exists, open MR exists):
  `clearPreviousAttempt` shows `ALREADY_AWAITING_REVIEW_MESSAGE` and returns
  `false`. Nothing is written. This is milestone 6's territory and it is
  currently a dead end, not a resubmit — the author cannot revise a document
  under active review from the panel or the command at all.
- **closed** ("Not accepted"; branch exists, no open MR): `clearPreviousAttempt`
  deletes the stale branch, then falls through to the same `create`-action
  commit as a first submit, against a fresh branch cut from current `main`.
  This is milestone 7a's mechanism and it already works, because a
  closed-without-merge document was never merged — the file genuinely does
  not exist on `main`, so `create` is correct. It was built by
  fix-interrupted-submit and add-document-recovery for a different reason
  (clearing an interrupted attempt) and happens to also serve 7a's case; see
  §4 for what's still missing to call 7a itself done.
- **published** (branch absent — auto-deleted on merge): `clearPreviousAttempt`
  finds nothing to clear and returns `true` immediately. `performSubmit` falls
  straight to `createBranchWithCommit` with `action: 'create'` — **against a
  file that already exists on `main`, since it was published.** This is the
  bug. See §2.

## 2. The bug: milestone 7 could not work as the code was written

> Historical, and FIXED 2026-09-12 — `createBranchWithCommit` takes the
> commit action as a parameter now and carries `last_commit_id` on an
> update. Kept verbatim because the trace is the reasoning the fix rests on.

`createBranchWithCommit` (`plugin/src/git-publishing/gitlab-client.ts:213-227`)
hardcodes the commit action:

```ts
actions: [{ action: 'create', file_path: params.filePath, content: params.content }],
```

Trace a **published** document's resubmit:

```
branchExists(doc/<id>)        → false   (GitLab auto-deleted it on merge)
clearPreviousAttempt          → true, nothing to clear
createBranchWithCommit        → cut doc/<id> fresh from current main
                                 main ALREADY HAS this file — it's published
                               → action: 'create' against an existing path
                               → GitLab rejects the commit
                               → classified as an undifferentiated failure
                               → SUBMIT_FAILED_MESSAGE:
                                 "Check your connection and submit again"
```

`docs/document-identity.md` §5 resolved *which branch* to cut ("current
`main`, never anything cached") for exactly this case (case 2, "Published,
new cycle") but never addressed the commit *verb* — because §5 was written
answering the branch-recreation question, and the verb only diverges once
a caller actually attempts the write against a path that pre-exists on the
cut-from ref. Milestone 7 needs `action: 'update'` here, with the file's
current `last_commit_id` (the same field milestone 6 was already going to
need — see the roadmap entry's own note that 6 "builds `last_commit_id`,
claiming to be the first update to an existing file").

The read that would tell `create` and `update` apart already exists in the
codebase, built for a different purpose: `checkTargetPathFree`
(`submit-document.ts:226-250`) reads whether a file exists at a path on a
given ref, via `getFileContent`, to decide whether to *refuse* a first
submit. The same read, on the branch about to be committed to, would decide
which commit action a resubmit needs. That's not a new remote call to
design — it's an existing one aimed at a state-fork instead of a refusal.

## 3. The state-fork, once 6 and 7 both exist

> Historical. Built as diagrammed, with the open question below ANSWERED:
> submit reuses reconciliation's precedence (`resolveMergeRequestState`) but
> fetches its own branch-filtered listing rather than calling
> `reconcileDocuments`, so there is one source of truth for "what state is
> this document in" without submit paying for a project-wide listing. See
> the change's design.md decision 1.

If milestone 6 (pending/changes-requested → push to existing branch, no new
MR) and milestone 7 (published → cut fresh, `update`) both get built,
`performSubmit`'s pre-flight becomes a 4-way fork rather than the current
2-question boolean:

```
resolve THIS document's current state
        │
  ┌─────┴──────┬─────────────┬────────────┐
unsubmitted  pending/     published     closed
             changes-req
  │            │             │             │
create,      commit to    cut fresh     delete stale
action:      EXISTING     from main,    branch, cut
create       branch,      action:       fresh, action:
             NO new MR    UPDATE        create
             (milestone 6, (milestone 7, (7a, works
              not built)    not built)    today)
```

**Open question, not decided here:** should this fork resolve its own
state, the way `clearPreviousAttempt` narrowly does today, or should
`performSubmit` call `reconcileDocuments`/the same `resolveOne` the panel
already uses for exactly this question? Reusing it means one source of
truth for "what state is this document in" instead of two independently
maintained answers (the panel's full reconciliation, and submit's narrower
branch/MR pair) that could in principle disagree. Arguing against reuse:
reconciliation is written to resolve every tracked document in one pass
(`docs/document-identity.md` §2's "one call total, not one per note"),
where submit only ever needs the answer for the one document in hand — reusing
it as written would over-fetch. Whoever designs 6/7 should settle this
rather than inherit the current split by default.

## 4. What 7a needed to be called done — DELIVERED 2026-09-12

> `renderSubmitSection` renders a per-state action button now, for all four
> tracked states, and the two pre-submit checks bind for the closed path as
> they do for the other three. The section below describes the code as it
> was; 5b still owns which LIST the row appears in.

The delete-then-recreate mechanism works today, but nothing in
`renderSubmitSection` (`plugin/src/main.ts:400-423`) offers an action for
*any* tracked document — it shows the state label and returns for every
non-null record:

```ts
const record = this.resolveSubmission(file);
if (record !== null) {
    statusContainer.createEl('p', { text: SUBMISSION_STATE_LABELS[record.state], ... });
    return;   // no button, for pending, changes-requested, published, AND closed
}
```

The only reachable path to resubmitting a tracked document today is the
command palette's "Submit for review" command, which calls
`submitForReview()` unconditionally (gated only on "a markdown file is
open," not on the document's tracked state) — so it already exercises 7a's
delete-then-recreate mechanism for a **closed** document, just with no
panel affordance telling the author that's the available action, and no
distinct wording from a first submit. Closing 7a means wiring a real
button into this render function for the closed state at minimum, and
6/7's forks land in the same place once they exist. RESOLVED 2026-09-12
(`docs/panel-tracking-scope.md`): 5b narrows "Your documents" to
pending/changes-requested and adds a second, lower-prominence "Other
documents" section for published/closed records — 7a's (and 6/7's) button
for those two states renders in that second section, not the narrowed
list. `renderSubmitSection`/`renderDocumentRow` are shared surface between
this milestone set and 5b either way and should be designed together.

## 5. Message wording — RESOLVED 2026-09-12

> `ALREADY_AWAITING_REVIEW_MESSAGE` is scoped to the first-submit path
> alone and keeps its hedge, which is correct there: a note with no `doc_id`
> yet genuinely may be colliding with a stranger's document. It is
> unreachable from a resubmit. The resubmit path got three strings of its
> own instead — `duplicateDocIdMessage`, `pathMismatchMessage`, and
> `UPDATE_SENT_MESSAGE`, which reports the push WITHOUT claiming a state,
> for the reason §0 gives.

`ALREADY_AWAITING_REVIEW_MESSAGE` (`submit-document.ts:71-74`) hedges
between "this is your own pending document" and "a different document
collided" — necessary today because `clearPreviousAttempt` is called from
both the tracked-resubmit path and (indirectly, via the same branch name)
the untracked first-submit path. Once resubmission gets its own fork
(§3), the `existingDocId !== null` branch can never actually be a
different document — `branchForDocId` is deterministic on a value already
frozen in this note's own front matter — so the message can stop hedging
and instead present the real action (push to the existing branch / open
"Changes requested" for editing) rather than a dead end. Exact wording is a
specs/tasks concern, vocabulary-checked like everything else here: no
"branch", "commit", "merge request", "MR", or "main".

## 6. Milestone 8's boundary, for completeness

Milestone 8 (Review and merge) is unaffected by any of the above — it
reads and acts on a different resource (protected-branch merge
permissions, per `docs/gitlab-roles.md`) and its governance question is
already resolved (self-merge accepted, `openspec/config.yaml`'s
architecture decisions). Worth deciding alongside it, not covered here:
whether the existing per-document "Open in GitLab" link
(`status.submission.webUrl`, which points at the merge request) is what an
in-app Merge surface should also deep-link from for file preview, or
whether a file-specific `/-/blob/<branch>/<path>` link serves a genuinely
different reading intent (content preview vs. reviewing a diff) worth
offering separately.

## Open questions — all answered 2026-09-12

- **Does submit resolve state via its own pre-flight or via
  reconciliation (§3)?** Neither wholesale: it shares reconciliation's
  precedence and fetches its own branch-filtered listing.
- **Exact commit-action decision point?** Read before every write that is
  not a plain `create`, including the common pending/changes-requested
  path. That path was expected to need no such read — it never changes
  verbs — but it needs `last_commit_id` anyway, and the same call returns
  both, so the round trip buys the staleness guard rather than the verb.
- **Message wording (§5)?** Resolved above.

## What is still open here

- ~~The revision path commits the note's content as it stands BEFORE
  `writeSubmissionFrontMatter` runs~~ — FIXED 2026-09-12, same day, after a
  manual test surfaced it. Worth recording in full, because the visible
  symptom and the actual defect were not the same thing.
  The symptom: a resubmit that changed `title` in the modal pushed the
  PREVIOUS revision's title to the remote while the local note got the new
  one, leaving the committed file permanently one revision behind. Observed
  on `test/test-008.md` — local `test-008-03`, committed `test-008-02`.
  The defect underneath: the plugin was writing `title` and `category` back
  to the note on EVERY resubmit at all. `openspec/config.yaml`'s front
  matter contract ("WHO WRITES WHAT, AND WHEN") gives the plugin exactly one
  moment to write those two — the first submit — and says they are "by
  hand, by the author, at any time thereafter, with the plugin never writing
  again". Nearly unreachable before this change, since the only resubmit
  that worked was the closed one; routine after it.
  The fix is the contract, not the ordering: `writeSubmissionFrontMatter`
  runs only when `openNewCycle` is given `completeFrontMatter`, which only a
  first submit passes. The resubmit modal shows `title` and `category`
  read-only, read from the note by `readSubmissionFields`, and refuses with
  `INCOMPLETE_FRONT_MATTER_MESSAGE` when either is missing or when
  `category` is not one of the nine — a refusal rather than a prompt,
  because prompting would mean writing the answer. The staleness dissolved
  with it: nothing rewrites the note, so what is committed IS the note.
- The open review's TITLE does not follow a later `title` edit. A new cycle
  (published or not-accepted) names its review from the note's current
  `title`, but an update pushed to an existing review leaves that review's
  title as it was opened. DECIDED 2026-09-12 to leave it: renaming would
  need a merge-request write this capability does not have, and the drift is
  visible rather than silent. Follow-up work, not a defect.
  CONFIRMED 2026-09-12, and it cuts the other way too, which is the better
  argument for the decision than the one above: !15 was renamed BY HAND in
  GitLab to `test-008-04` while the note's `title` stayed `test-008-03`, and
  a subsequent Send update (commit `82824472`) left the rename standing. A
  plugin that renamed the review on every update would have silently undone
  a deliberate edit someone made on the platform. Leaving it alone is not
  merely cheaper — it is the behaviour that does not overwrite a human.
  Shape of the drift, for whoever picks this up: the two never reconverge
  within a cycle, and they reset at each cycle boundary, since a new review
  is named from the note's `title` at the moment it opens.
- Milestone 5b still owns which panel section a published or not-accepted
  document's row renders in (`docs/panel-tracking-scope.md`). This change
  added the action; it did not move the row.
