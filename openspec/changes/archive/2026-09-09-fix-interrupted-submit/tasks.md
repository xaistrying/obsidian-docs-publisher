## 1. Read and delete primitives in git-publishing

- [x] 1.1 Add `branchExists(details, branch)` to
      `plugin/src/git-publishing/gitlab-client.ts`:
      `GET /projects/:id/repository/branches/:branch` with the branch name
      URL-encoded. Return a THREE-WAY answer — exists, absent, or lookup
      failure carrying a `FailureKind` — where only an explicit 404 maps to
      absent. Do not reuse `classifyStatus`'s output directly for this, as
      it folds 403 and 404 together into `not-reachable`; a 403 must come
      back as a lookup failure, never as absent. See design.md decision 2.
- [x] 1.2 Confirm against the target CE 19.3.0 instance that an absent
      branch actually answers 404 rather than 403 or a 200 with an error
      body (design.md's open question). Record what it returns in a code
      comment beside the classification.
      PARTIALLY DONE 2026-09-09. Confirmed on **gitlab.com**: absent → 404
      `{"message":"404 Branch Not Found"}`, existing → 200, with the branch
      name `%2F`-encoded in the path. Recorded in `branchExists`'s doc
      comment as required. What REMAINS is the instance, not the question:
      gitlab.com is SaaS/EE on continuous deployment and is not evidence
      for self-managed CE 19.3.0. Stays open, and closes with the same
      rerun `docs/access-tokens.md` §1(a) already defers — do both at once
      rather than visiting that token screen twice.
- [x] 1.3 Add `findOpenMergeRequest(details, sourceBranch)`:
      `GET /projects/:id/merge_requests?source_branch=<branch>&state=opened`.
      Return whether one exists and its `iid` when it does. A merged or
      closed merge request must NOT be reported as open. Classify a failed
      lookup through the read path, and make a failure distinguishable from
      "none exists" so the caller can abort rather than proceed.
- [x] 1.4 Add `deleteBranch(details, branch)`:
      `DELETE /projects/:id/repository/branches/:branch`. Classify through
      the WRITE path (`classifyWriteStatus`), since a fine-grained token's
      permissions can be why a delete is refused, and preserve any reported
      permission name exactly as the existing writes do. This is the
      capability's first destructive call — say so in its doc comment.
- [x] 1.5 Export the three additions and confirm nothing outside
      `git-publishing` gained an HTTP call or an endpoint shape.

## 2. Honour a frozen `doc_id`

- [x] 2.1 In `plugin/src/doc-authoring/submit-document.ts`, read `doc_id`
      from the note's front matter before deriving one. When present and
      non-empty, use it and skip `deriveDocId` entirely; when absent, derive
      from the filename exactly as now. Reuse the front-matter read that
      `submission-tracking/resolve.ts` already performs rather than adding a
      second way to read the same field.
- [x] 2.2 Confirm the frozen value is never overwritten:
      `writeSubmissionFrontMatter` must not write a different `doc_id` onto
      a note that already had one.

## 3. The pre-flight and the branch on its answer

- [x] 3.1 In `performSubmit`, ahead of the first write, call `branchExists`
      for `doc/<doc_id>`. On a lookup failure, abort before any write with
      "Submit didn't go through. Check your connection and submit again."
      On absent, continue straight to the existing create-then-open
      sequence with nothing cleared.
- [x] 3.2 When the target exists, call `findOpenMergeRequest` for it. On a
      lookup failure, abort with the same message as 3.1. When one is open,
      write and delete NOTHING and show "A document with this file name is
      already waiting for review. If that's this document, there's nothing
      more to do. If it's a different one, rename the file and submit
      again."
- [x] 3.3 When the target exists with nothing open for it, call
      `deleteBranch` and then run the normal create-then-open sequence with
      the note's CURRENT content. Delete first, create second — never the
      reverse; see design.md decision 4.
- [x] 3.4 On a failed delete, abort before any write with "Submit didn't go
      through while clearing up an earlier attempt. Check your connection
      and submit again."
- [x] 3.5 Keep the decision of what to do in `submit-document.ts`. Do not
      add a combined "prepare the target" method to `git-publishing` that
      performs the lookups and the delete behind one call — design.md
      decision 8 rejects it, and it would move the choice of what to destroy
      into the transport layer.

## 4. Retire the rename advice

- [x] 4.1 Rewrite `SUBMIT_FAILED_MESSAGE` to "Submit didn't go through.
      Check your connection and submit again." — no named cause, no rename
      advice. Update the doc comment above it, which currently explains the
      punt this change closes, to say what the message now covers and why
      renaming was removed.
- [x] 4.2 Confirm the two places renaming is still advised are untouched
      and still correct: `INVALID_FILENAME_MESSAGE` for a filename that is
      not ref-legal, and the already-awaiting-review message from 3.2.
- [x] 4.3 Vocabulary check every string added or changed: no "branch",
      "commit", "merge request", "MR", "conflict", or "main".

## 5. Correct the documentation this change overtakes

- [x] 5.1 `openspec/config.yaml`'s milestone 7a entry says "This milestone
      therefore adds git-publishing's first destructive call." Correct it:
      this change adds it, and 7a reuses it.
- [x] 5.2 `docs/document-identity.md` §5 says the same thing in its
      CONSEQUENCE FOR git-publishing paragraph. Correct it the same way.
- [x] 5.3 Re-check `openspec/config.yaml`'s context field stays under
      OpenSpec's 50 KB limit after editing — it is currently at ~46 KB, and
      the whole field is silently dropped when it goes over. `openspec new
      change` prints a warning when it does; do not ignore it.

## 7. A refused read is not a connection problem

Added 2026-09-09, from running 6.2 against the real remote: the pre-flight's
merge-request lookup was refused with `insufficient_granular_scope` naming
`[Merge Request: Read]`, and the author was told to check their connection.
The abort was correct; the message was not. See design.md decision 10.

- [x] 7.1 Rename `classifyWriteStatus` to `classifyScopedStatus` and widen
      its doc comment: it serves every call a fine-grained token's
      permissions gate — the writes, the delete, and both pre-flight
      lookups. Do NOT change `classifyStatus`; the connection check's 403
      genuinely means "not visible to you" and belongs to milestone 2.
- [x] 7.2 Give `getRaw` a classifier parameter defaulting to
      `classifyStatus`, and have `branchExists` and `findOpenMergeRequest`
      pass `classifyScopedStatus`. Carry `detail` through both so the
      permission name survives to the caller.
- [x] 7.3 Correct the `FailureKind` doc comment, which asserts reads have
      nowhere a token's scope can bite. That premise is disproved.
- [x] 7.4 Fix `extractPermissionDetail`: read `error_description` before
      `message` (the real body carries no `message`), and prefer the
      bracketed permission list over the identifier regex. Fix the fallback
      regex too — `\D*` backtracks and returned "t".
- [x] 7.5 Confirm `reportFailure` needs no change: it already routes
      `insufficient-permission` to the permission message, so correcting the
      classification is sufficient to fix what the author sees.
- [x] 7.6 Observable check — re-run 6.2 with a token still MISSING a
      required permission. Confirm the author is now told which permission is
      missing, by name, rather than being told to check their connection.
      PASSED 2026-09-09 against gitlab.com, with a token deliberately
      created without merge-request access. The author saw: "Your access
      token doesn't have permission to submit documents (missing: Merge
      Request: Read). Ask your admin to add it." Both halves of the fix are
      confirmed by that one string — the classification (a read's 403 now
      reaches `insufficient-permission` rather than `not-reachable`) and the
      detail parser (`error_description` read in preference to the absent
      `message`, and the bracketed name preferred over the identifier
      regex). Before the fix the same condition read "Submit didn't go
      through. Check your connection and submit again."

## 6. Closing the change

- [x] 6.1 Run the type checker and the production build; both clean.
- [x] 6.2 Observable check — THE FIX. Submit a document successfully, then
      close and delete its merge request in GitLab while leaving the branch
      in place, so the remote is in exactly the interrupted state (target
      present, nothing open). Remove `doc_id`, `title` and `category` from
      the note's front matter to match what an interrupted submit would
      have left. Press "Submit for review" again: it completes, the author
      sees "Waiting for review", front matter is filled in, and GitLab
      shows one branch and one open merge request — not two of either.
- [x] 6.3 Observable check — CONTENT IS FRESH. Repeat 6.2, but edit the
      note's body between the two attempts. Confirm the merge request that
      results contains the edited text, not the text from the first attempt.
- [x] 6.4 Observable check — AN OPEN SUBMISSION IS SAFE. With a document
      already submitted and awaiting review, run "Submit for review" on it
      again from the command palette. Confirm the author sees the
      already-waiting-for-review message, and that GitLab shows the original
      merge request still open, still on its original content, with no
      second merge request and no deleted branch.
- [x] 6.5 Observable check — THE FROZEN ID HOLDS. With a document already
      submitted and awaiting review, rename its file, then run "Submit for
      review" from the command palette. Confirm it still resolves to the
      frozen `doc_id`, still refuses with the already-waiting-for-review
      message, and does NOT create a second document under a new ID.
- [x] 6.6 Observable check — NO REGRESSION ON A CLEAN FIRST SUBMIT. Create
      a new document and submit it normally. Confirm it still works, and
      that the panel and the command palette behave identically.

### 6.4 result, 2026-09-09 — PASSED against gitlab.com

Ran on `test-002` from the command palette, with `!10` open against it. The
author saw the already-waiting-for-review message; the panel offered no
Submit button, which is why the palette was the only way in.

The remote was unchanged in all three respects that matter:
- `doc/test-002` still present — the destructive call did NOT fire. This is
  the safety property the whole change turns on.
- `!10` still open, still 1 commit, still the 6.3 content, its "updated"
  timestamp unmoved by this run.
- No second merge request; the project total stayed at 10.

Worth recording that this path had never executed before today. The earlier
attempt on `hello-123` was aborted by the `Merge Request: Read` refusal
BEFORE the lookup could find anything open, so the refusal branch was
unreached until the token was fixed.

### 6.3 result, 2026-09-09 — PASSED against gitlab.com

Ran on `test-002`, which was still in the interrupted state. Added
`EDITED BEFORE RETRY 2026-09-09` to the body, then submitted. Merge request
`!10` from `doc/test-002` carries the edited line.

Two details in that diff prove delete-and-recut rather than branch reuse,
which is the property design.md decision 3 turns on: the file shows as
`0 -> 100644`, a NEW file rather than a modification, and the merge request
has exactly ONE commit despite the branch having carried a commit from the
earlier attempt. Had the branch been reused, the edit would have needed an
`update` action and `last_commit_id`, which is milestone 6's.

### 6.2 result, 2026-09-09 — PASSED against gitlab.com

Ran on `test-003`, which had reached the interrupted state on its own rather
than by staging: an earlier attempt created the branch and was then refused
`Merge Request: Create`, leaving the target present with nothing open against
it and no `doc_id` in the note. Pressing Submit again completed it.

- Author saw "Waiting for review"; front matter filled in with `title`,
  `category` and `doc_id: test-003`.
- GitLab: one branch `doc/test-003`, one open merge request `!9` from it.
- The merge request list showed "Open 2", the second being an unrelated
  document from a week earlier. Read the count per-document, not in total.

This run could NOT demonstrate that `doc_id` survives unchanged across the
interruption, and that is correct rather than a gap: the failed attempt
stopped before front matter was written, so no `doc_id` had frozen and the
retry derived it from the filename. 6.5 is the check that exercises a frozen
value.

Permissions the run required, each named by GitLab in its own refusal and
recorded in `docs/access-tokens.md` §1: `Merge Request: Read`,
`Merge Request: Create`, `Branch: Delete`.
