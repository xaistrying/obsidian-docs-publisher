## 1. Write path in git-publishing

- [x] 1.1 Extend `ClientResult`'s failure variant in
      `plugin/src/git-publishing/gitlab-client.ts` with an optional
      `detail?: string`, and add `'insufficient-permission'` to `FailureKind`.
- [x] 1.2 Add `createBranchWithCommit(details, { branch, filePath, content })`:
      `POST /repository/commits` with `start_branch` set to the given branch
      name and a single `create` action. Classify failures through the
      existing `classifyStatus` path, plus the new permission-detail
      extraction below.
- [x] 1.3 Add `createMergeRequest(details, { sourceBranch, title })`:
      `POST /merge_requests` targeting the project's default branch.
- [x] 1.4 Add permission-detail extraction: when a write response body
      carries GitLab's `insufficient_granular_scope`-style error naming a
      permission, classify as `'insufficient-permission'` and return the
      named permission as `detail`; when the body doesn't parse as expected,
      still return `'insufficient-permission'` with no detail. Confirm the
      exact response shape against the target CE 19.3.0 instance (design.md's
      open question) rather than assuming the gitlab.com shape from the
      spike.

## 2. Submission-tracking capability

- [x] 2.1 Create `plugin/src/submission-tracking/` with the `SubmissionRecord`
      type (`docId`, `branch`, `mrIid`, `state`), `state` typed to
      accommodate the full enum (`pending | changes-requested | published |
      closed`) even though this milestone only ever writes `pending`.
- [x] 2.2 Add persistence keyed by `docId` against plugin data (`data.json`),
      and a lookup that resolves a record from a note's own front-matter
      `doc_id` — never from the note's file path.
- [x] 2.3 Add the state → author-facing label mapping, with `pending` →
      `"Waiting for review"`.

## 3. The submit modal

- [x] 3.1 Create the submit modal: `title` (text, required), `category`
      (dropdown of the nine fixed values, required), and a read-only line
      showing the note's current vault path as the target remote path. Submit
      control disabled until both fields are non-empty.
- [x] 3.2 Reuse the gate from `create-document.ts` (connection details →
      verified check → Developer access) in front of opening the modal,
      rather than duplicating the checks.
- [x] 3.3 On confirm: derive the candidate `doc_id` from the note's current
      filename, ASCII-fold Vietnamese diacritics, and validate it's
      git-ref-legal (no spaces, none of `~^:?*[\`, no leading dot, no
      trailing `.lock`). Refuse and tell the author to rename the file if
      validation fails, before any remote call.

## 4. Wiring the submit sequence

- [x] 4.1 On confirm with a valid candidate `doc_id`: call
      `createBranchWithCommit` with branch `doc/<doc_id>`, the note's current
      path, and its current content. On success, call `createMergeRequest`
      with that branch and the entered `title`.
- [x] 4.2 Only after both calls succeed: write `title`, `category`, and
      `doc_id` into the note's front matter (extend `front-matter.ts`), then
      create the submission-tracking record and show the pending label as
      confirmation.
- [x] 4.3 On any failure of either call — an explicit remote rejection or a
      network failure of unknown outcome — leave the note's front matter
      untouched, create no tracking record, and show: "Submit didn't go
      through. This can happen from a dropped connection, or because another
      document is already using this file name. Rename the file to get a new
      ID, then submit again." Do not distinguish the failure's cause in this
      message.
- [x] 4.4 On the `insufficient-permission` classification specifically, show
      a distinct message naming the missing permission when `detail` is
      present: "Your access token doesn't have permission to submit
      documents (missing: {detail}). Ask your admin to add it." Fall back to
      the message in 4.3's style, without a permission name, when `detail` is
      absent.

## 5. Entry point

- [x] 5.1 Register a "Submit for review" command in `plugin/src/main.ts` for
      the active note, using a plain `callback`, matching the "New Document"
      registration pattern.
- [x] 5.2 Add a "Submit for review" control to the panel for the currently
      open, unsubmitted document.

## 6. Closing the change

- [x] 6.1 Run the type checker and the build; both clean.
- [x] 6.2 Observable check — a full first submission: with a document created
      by "New Document" and connected as a Developer, run "Submit for
      review". Fill in title and category, confirm the shown target path is
      correct, and submit. The note's front matter now carries `title`,
      `category`, and `doc_id`; opening the project in GitLab shows a new
      branch, a commit, and an open merge request; the plugin confirms
      "Waiting for review".
- [x] 6.3 Observable check — blocked submission: open the submit modal and
      leave `category` unset. Confirm the submit control stays disabled and
      no request is made.
- [x] 6.4 Observable check — the punt path: submit a document, then (without
      changing the note) trigger the same submit sequence again so the
      commit call targets a branch name that already exists on the remote.
      Confirm the author sees the "Submit didn't go through…" message, the
      note's front matter is unchanged, and renaming the file and submitting
      again succeeds under a new `doc_id`.
- [x] 6.5 Observable check — gating: confirm "Submit for review" refuses by
      name for an unverified connection and for a sub-Developer role, exactly
      as "New Document" does, from both the panel and the command palette.
      Unverified-connection refusal confirmed directly, from both surfaces.
      Sub-Developer role refusal not independently re-run — accepted on the
      strength of `requireAuthoringGate` being the exact same shared function
      "New Document" already relies on for that branch, unchanged by this
      change.
