## Why

Resubmitting a tracked document is broken or missing for three of its four
possible states. A document that is Pending or Changes-requested cannot be
revised at all — the plugin refuses outright and writes nothing. A
Published document's resubmit is actively broken — it cuts a fresh branch
correctly but then commits with `action: 'create'` against a path that
already exists on `main`, so GitLab rejects the write and the author sees
"Submit didn't go through. Check your connection and submit again," which
names no cause and is not what happened. Only the fourth state (Closed /
"Not accepted") already works, and even that has no button — only the
command palette reaches it, silently.

This is scoped as one change rather than split along the roadmap's
milestone 6 / milestone 7 numbering because both defects live in the exact
same function (`performSubmit`'s pre-flight) and the exact same one-line
bug (`createBranchWithCommit`'s hardcoded commit verb). Splitting them
would mean two changes editing the same function within days of each
other for the same underlying reason: `performSubmit` today asks two
narrow, ad hoc questions (does the branch exist, is there an open merge
request) where it needs to ask one real one — what state is this document
in — and act on all four answers. That question, once asked, resolves
every state in the same pass; answering it for only one state and leaving
the others as they are would be the "abstraction with no full user-visible
surface" the proposal rule warns against, not a smaller increment.

Full background, including the verified bug trace and the design options
considered, is in `docs/resubmission-lifecycle.md` — read it before
`design.md`.

## What Changes

- `performSubmit` (`plugin/src/doc-authoring/submit-document.ts`) gains a
  real state resolution in place of `clearPreviousAttempt`'s narrower
  branch-exists / open-MR-exists pair, forking on the document's actual
  reconciled state:
  - **Pending / Changes-requested**: commits the current note content to
    the existing tracked branch. No new branch, no new merge request.
    State returns to "Waiting for review".
  - **Published**: cuts a fresh branch from current `main` (unchanged,
    already correct) but commits with `action: 'update'` and the file's
    `last_commit_id` instead of `action: 'create'`. Opens a new merge
    request. State becomes "Waiting for review", exactly as a first
    submit.
  - **Closed ("Not accepted")**: unchanged behaviour (delete the stale
    branch, cut fresh, `action: 'create'`), now reachable from a real
    button instead of only the command palette.
  - **Unsubmitted**: unchanged — the existing first-submit path.
- `git-publishing` gains a way to commit an update to an existing branch
  without creating one (the pending/changes-requested path), and
  `createBranchWithCommit`'s hardcoded `action: 'create'` becomes a
  parameter the caller decides, carrying `last_commit_id` when updating.
- The panel (`plugin/src/main.ts`, `renderSubmitSection`) gains a real
  action button for every tracked state. Today it shows only the state
  label and returns once any record exists.
- `ALREADY_AWAITING_REVIEW_MESSAGE`'s hedge ("if that's this document...
  if it's a different one...") is retired for the resubmit path, where it
  can no longer actually be a different document — see
  `docs/resubmission-lifecycle.md` §5. The wording for the collision case
  that genuinely can be a different document (a first submit's path
  pre-flight, `checkTargetPathFree`) is unaffected.
- **NEW, and previously missing entirely:** the two pre-submit checks
  `docs/document-identity.md` §3-4 require from "the second submit
  onward" — a duplicate `doc_id` across two local notes, then a local
  path that has drifted from the document's remote path — do not exist
  anywhere in the codebase today. The roadmap assigns both to this exact
  milestone pair ("this is the first milestone where a document is
  submitted a SECOND time"), and this proposal is that first second
  submit, so it is where they must first bind, in that order. A resubmit
  that would previously have silently succeeded now correctly refuses in
  either case.
- **BREAKING (internal only, no data migration):** `SubmissionRecord`
  writes are unaffected; no stored shape changes.

### Deferred, deliberately

- Milestone 7a (Closed / "Not accepted") keeps its current mechanism
  untouched — only its panel button is added here, since that button is
  shared surface with this change's own panel work.
- Milestone 5b (Reset, and repurposing "Your documents" into a
  pending-only list plus an "Other documents" section) is a separate,
  already-scoped change. This proposal's new button renders in whatever
  list currently shows the document; it does not itself move documents
  between panel sections.
- Milestone 8 (Merge), milestone 9 (Discover & Import), and milestone 3a
  (default directory) are unrelated and untouched.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `submission-tracking` — the resubmission decision (which of the four
  states a document is in, and what action that implies) moves from
  `doc-authoring`'s narrow pre-flight to a real, reusable state
  resolution. Whether this reuses `reconcileDocuments` directly or adds a
  narrower single-document variant is a `design.md` decision, not fixed
  here.
- `git-publishing` — the commit call gains a verb parameter and
  `last_commit_id`, and gains a variant that commits to an existing
  branch without creating one.
- `doc-authoring` — `performSubmit`'s pre-flight is replaced by the
  4-way fork; message wording changes for the resubmit path.
- `plugin-shell` — the panel gains a real action per tracked state instead
  of a label-only render.

## Impact

- `plugin/src/doc-authoring/submit-document.ts` — `performSubmit`,
  `clearPreviousAttempt` (replaced by the state fork), message constants,
  the two new pre-submit checks.
- `plugin/src/submission-tracking/document-status.ts` — `listVaultDocuments`
  is the data the duplicate-`doc_id` check scans.
- `plugin/src/git-publishing/gitlab-client.ts` — `createBranchWithCommit`
  (verb becomes a parameter), a new commit-to-existing-branch function.
- `plugin/src/submission-tracking/` — the state-resolution logic this
  reuses or narrows from `reconcile.ts`.
- `plugin/src/main.ts` — `renderSubmitSection`.
- `docs/resubmission-lifecycle.md`, `openspec/config.yaml` (milestones 6
  and 7) — updated once this ships, from "not built" / "broken" to done.
