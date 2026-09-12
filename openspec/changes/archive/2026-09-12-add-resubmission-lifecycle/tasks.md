## 1. git-publishing: commit primitives

- [x] 1.1 Add `getFileCommitId(details, { path, ref })` returning the
      three-way answer (exists-with-id / absent / failed), via the
      non-raw `GET .../repository/files/:file_path` endpoint.
- [x] 1.2 Generalize `createBranchWithCommit` to take the commit action
      (`create` | `update`) and an optional `last_commit_id`, instead of
      hardcoding `action: 'create'`.
- [x] 1.3 Add `commitToBranch(details, { branch, filePath, content,
      lastCommitId })` — commits an update to an existing branch, no
      `start_branch`, no branch creation.
- [x] 1.4 Confirm both commit functions build their `actions: [...]`
      payload through one shared internal helper (design.md decision 4).

## 2. submission-tracking: single-document state resolution

- [x] 2.1 Extract the open-wins/else-most-recent precedence logic
      `reconcile.ts`'s `resolveOne` already implements into a function
      both the bulk and single-document paths call.
- [x] 2.2 Add `resolveDocumentState(details, docId)`: calls
      `listMergeRequests(details, { sourceBranch })` filtered to this
      document's branch, then applies the shared precedence logic.
- [x] 2.3 Confirm `reconcileDocuments`'s existing behavior and output are
      unchanged — this is additive, not a rewrite of the bulk path.

## 3. doc-authoring: the two pre-submit checks

- [x] 3.1 Add the duplicate-`doc_id` check: scan `listVaultDocuments(app)`
      for another file sharing this note's `doc_id`; refuse before any
      remote call if found.
- [x] 3.2 Add the path-mismatch check: compare `file.path` (case-sensitive)
      against the remote path read as part of state resolution (2.2);
      refuse and name the correct path if they differ.
- [x] 3.3 Order the two checks as `docs/document-identity.md` §4 requires:
      duplicate `doc_id` first, then path mismatch.
- [x] 3.4 Confirm both checks run for every resubmit — pending,
      changes-requested, published, and not-accepted alike — not only
      for some states.

## 4. doc-authoring: the state fork replacing `clearPreviousAttempt`

- [x] 4.1 Replace `clearPreviousAttempt`'s branch-exists/open-MR-exists
      pair with a call to `resolveDocumentState` (2.2), forking on all
      four resolved states.
- [x] 4.2 Pending / changes-requested: read `getFileCommitId` on the
      existing tracked branch immediately before committing, then call
      `commitToBranch` (1.3) with `action: 'update'`. No new branch, no
      new merge request.
- [x] 4.3 Published: cut fresh from current default branch (existing
      logic, unchanged), read `getFileCommitId` on the default branch
      immediately before committing, then call the generalized
      `createBranchWithCommit` (1.2) with `action: 'update'`. Open a new
      merge request.
- [x] 4.4 Not accepted: unchanged mechanism (delete stale branch, cut
      fresh, `action: 'create'`) — no `last_commit_id` needed, since the
      file was never merged to the default branch.
- [x] 4.5 Unsubmitted: unchanged first-submit path, still preceded by
      add-document-recovery's `checkTargetPathFree` pre-flight.
- [x] 4.6 Confirm the resubmit path never optimistically sets the local
      record to `pending` — the displayed state is left to the next
      refresh (design.md decision 6).

## 5. Message wording

- [x] 5.1 Scope `ALREADY_AWAITING_REVIEW_MESSAGE` to the first-submit
      collision case only; confirm it is unreachable from the resubmit
      path once 4.1 lands.
- [x] 5.2 Add refusal copy for the duplicate-`doc_id` check (3.1),
      vocabulary-checked: no "branch", "commit", "merge request", "MR",
      "conflict", "main".
- [x] 5.3 Add refusal copy for the path-mismatch check (3.2), naming the
      correct path, same vocabulary constraint.
- [x] 5.4 Confirm the existing pending-state success notice
      (`SUBMISSION_STATE_LABELS.pending`, "Waiting for review") covers
      every path that ends in `pending` — first submit, published
      resubmit, and not-accepted resubmit alike — with no new string
      needed there.

## 6. plugin-shell: the panel action

- [x] 6.1 Replace `renderSubmitSection`'s label-only render (for any
      tracked state) with a real action button per state, matching
      plugin-shell's spec delta.
- [x] 6.2 Confirm the button routes through the same `submitForReview`
      entry point the command palette uses, so neither can drift from
      the other.
- [x] 6.3 Confirm the button appears for all four tracked states
      (pending, changes-requested, published, not-accepted) — not only
      the ones this change's own bug-fix targets.

## 7. Verification

- [x] 7.1 ALL FOUR STATES CONFIRMED 2026-09-12 on `gitlab.com` — pending,
      published, changes-requested and not-accepted. NOT on the target
      CE 19.3.0 instance; that rerun is owed and is tracked in
      `docs/ce-verification.md` §D8, not here.
      Detail and the two inferred sub-assertions in `docs/ce-verification.md`
      §D8. One complement still owed there, tracked as part of D8 rather
      than here: resolving a review thread and confirming the state returns
      to "Waiting for review".
      Manual test matrix: resubmit a document in each of the four
      tracked states, confirm the correct commit action and branch
      behavior for each, against the actual target GitLab instance.
- [x] 7.2 Confirm a stale `last_commit_id` correctly rejects an update
      commit rather than silently overwriting (concurrent-edit case).
      CONFIRMED 2026-09-12 on gitlab.com: HTTP 400, "The file has changed
      since you started editing it". Detail in `docs/ce-verification.md`
      §B8. Surfaced a separate defect in how that 400 is REPORTED — see §10.
- [x] 7.3 Confirm the duplicate-`doc_id` and path-mismatch checks refuse
      correctly and write nothing. CONFIRMED 2026-09-12 on gitlab.com —
      duplicate names the other note; a move names the path to restore; a
      case-only rename refuses identically.
      "for a resubmit in each of the four states" NARROWED to one, on the
      structural ground recorded in `docs/ce-verification.md` §D8: both
      checks precede the switch on resolved state, so they cannot vary by
      it.
- [x] 7.4 Record any newly-observed permission name or response shape for
      `getFileCommitId` and `commitToBranch` in `docs/ce-verification.md`,
      per that doc's own convention — do not assume they match
      `getFileContent`'s already-observed shape without checking.

## 8. Documentation upkeep

- [x] 8.1 Update `openspec/config.yaml`'s milestone 6 and milestone 7
      entries from "VERIFIED NOT BUILT" / "VERIFIED BROKEN" to done, once
      shipped.
- [x] 8.2 Update `docs/resubmission-lifecycle.md` to reflect the shipped
      behavior rather than the pre-change bug trace, keeping the trace as
      historical record of what was fixed.

## 9. Front matter on a resubmit — ADDED 2026-09-12, from manual testing

Found by 7.1's own run, not by review. The plugin was rewriting `title` and
`category` on every resubmit, which `openspec/config.yaml`'s front matter
contract gives it exactly one chance to do — the first submit. Barely
reachable before this change; routine after it, which makes it this
change's to fix rather than a follow-up.

- [x] 9.1 Add `readSubmissionFields(app, file)` to `front-matter.ts`:
      `title` and `category` off the note, null when either is missing,
      empty, or `category` is not one of the nine.
- [x] 9.2 Give `SubmitModal` a second, read-only shape, selected by the
      presence of the values the note already carries — no mode flag.
- [x] 9.3 Route in `submitForReview`: a note with no `doc_id` gets the
      collecting shape; a tracked note gets the confirming one, refused up
      front with `INCOMPLETE_FRONT_MATTER_MESSAGE` when the fields are not
      readable.
- [x] 9.4 Make `writeSubmissionFrontMatter` reachable ONLY from a first
      submit, via `openNewCycle`'s `completeFrontMatter` — absent on both
      resubmit paths, and absent from `pushUpdate` entirely.
- [x] 9.5 Confirm the committed content now matches the note exactly: with
      nothing rewriting front matter after the read, the one-revision lag
      dissolves rather than needing its own fix.
- [x] 9.6 Re-run D8's "Waiting for review" row against the instance:
      front matter byte-identical before and after a Send update, and the
      committed file matching the note. CONFIRMED 2026-09-12 — read-only
      dialog seeded from front matter, third commit `4809fe48` on !15, note
      untouched by the submit.

## 10. Reporting a refused stale write — ADDED 2026-09-12, from 7.2

7.2 proved the `last_commit_id` guard fires. It also showed the refusal
reaching the author as "Check your connection and submit again" — a 400
falls through `classifyScopedStatus` to `unexpected`. Wrong advice in the one
case the guard exists for: the connection is fine, and submitting again
either fails identically or discards a colleague's work. This change created
the failure mode (no resubmit sent an update before it), so it closes it.

- [x] 10.1 Add `content-changed` to `FailureKind`, and let the compiler find
      the two exhaustive `Record<FailureKind, string>` tables.
- [x] 10.2 Add `isContentChanged(response)`: 400 plus a body message matching
      GitLab's "changed since you started editing". Degrades to `unexpected`
      — the previous behaviour — if the wording ever changes, so a reworded
      error costs a precise message and never a refused write.
- [x] 10.3 Classify it in `post`, ahead of the status-only classification.
- [x] 10.4 Add `CONTENT_CHANGED_MESSAGE`, pointing at "Open in GitLab" and
      NOT at Refresh — Refresh re-reads each document's STATE and does not
      bring anyone else's edit into the note.
- [x] 10.5 CONFIRMED 2026-09-12 on gitlab.com, through the real code path.
      Console: `POST .../repository/commits — HTTP 400, classified as
      content-changed {"message":"The file has changed since you started
      editing it: test/test-009.md"}`. So the whole chain holds: GitLab's
      400, `isContentChanged` matching the body, the new `FailureKind`, and
      `reportFailure` routing to `CONTENT_CHANGED_MESSAGE` rather than the
      connection one. The temporary delay was removed and the plugin rebuilt
      in the same session; `grep` for test residue is clean and the bundle is
      back to its pre-test size.
      NOTE, correcting this task's own first wording: "edit in GitLab, then Send update" does NOT reach it.
      `pushUpdate` reads `getFileCommitId` immediately before committing, so
      an edit made beforehand is simply read as the current id and the write
      succeeds — the stale window is milliseconds, which is why 7.2 had to
      be probed with curl. To exercise it, widen the window: temporarily
      `await new Promise((r) => setTimeout(r, 30000));` after that read,
      rebuild, press Send update, edit the file on the same branch in the Web
      IDE during the pause, and let it proceed. Expect
      `CONTENT_CHANGED_MESSAGE`, not `SUBMIT_FAILED_MESSAGE`. Remove the
      delay and rebuild afterwards.
