# Verifying this plugin against a real GitLab instance

Every remote behaviour this plugin depends on was established against
**gitlab.com** (SaaS, Enterprise Edition, continuous deployment). The target
instance is **self-managed Community Edition 19.3.0**. Those are not the same
product, and this project has already been wrong twice about assuming one
carries over to the other:

- the `insufficient_granular_scope` error body did not have the shape the code
  parsed, so the author never saw which permission to ask for; and
- reads turned out to be scope-gated at all, which the code had assumed they
  were not.

Both were found by running against a real instance, not by reading docs. This
file is the checklist for doing that deliberately instead of by accident.

> **Nothing here is blocking.** The plugin is built and its type checker and
> production build are clean. What is unproven is how the *remote* behaves,
> and every item below says what breaks if the assumption turns out wrong.

---

## 0. Before you start

**Record which instance you tested on.** This matters more than it sounds. If
you run these against gitlab.com, you have re-confirmed what is already known
and learned nothing about CE 19.3.0 — the evidence does not transfer in that
direction. If your personal instance is self-managed, note its exact version
from Help → Version; a CE instance at a different version is better evidence
than gitlab.com but still not the target.

Fill this in when you run the checks:

| | |
|---|---|
| Instance URL | |
| Edition (CE / EE / gitlab.com) | |
| Version | |
| Date run | |
| Project used | |

**You need:**

- A project you can push to and administer, with at least one other account
  able to comment on a merge request (for §C and §D2). A second account of
  your own works.
- A fine-grained personal access token, created through the default token
  screen — **not** "Generate legacy token". See `access-tokens.md` §1 for why
  this project uses fine-grained tokens and nothing else.
- The plugin installed in a vault, with the developer console open
  (Ctrl+Shift+I). Every failure this plugin classifies is logged there with
  its URL, status and classification; the panel deliberately shows the author
  a plain sentence instead.

**How to read each item.** *Assumed* is what the code believes today. *Where
it bites* names the function that believes it. *If it's wrong* is the actual
consequence — read this one first, because several of these fail safe and are
not worth blocking on.

---

## A. Token type and permission names

The fine-grained token spike (`access-tokens.md` §1) ran entirely on
gitlab.com. This section is its deferred rerun — item (a) in that file.

### A1. The default token screen is the fine-grained flow

- **Assumed:** creating a personal access token lands on the fine-grained
  screen, and the legacy `api` scope is one click further in under "Generate
  legacy token". Already confirmed on the target instance; included here
  because a personal instance at a different version may differ.
- **Where it bites:** the settings tab's guidance, which points authors at the
  fine-grained flow and never mentions legacy scopes.
- **If it's wrong:** the setup guide sends authors to a screen that is not
  there. Cosmetic but immediately confusing.

- [ ] Checked. Notes:

### A2. All six operations succeed with a fine-grained token

The operations, in the order a document goes through them:

| # | Operation | API call |
|---|---|---|
| 1 | read the account | `GET /user` |
| 2 | create branch + commit | `POST /projects/:id/repository/commits` with `start_branch` |
| 3 | open a merge request | `POST /projects/:id/merge_requests` |
| 4 | list merge requests | `GET /projects/:id/merge_requests` |
| 5 | add a note | `POST /projects/:id/merge_requests/:iid/notes` |
| 6 | merge | `PUT /projects/:id/merge_requests/:iid/merge` with `sha` |

- **Assumed:** all six work on a scoped fine-grained token. Confirmed on
  gitlab.com; fine-grained enforcement became generally available on
  Self-Managed at 19.2, so 19.3.0 should support it, but "should" is the word
  this whole file exists to remove.
- **Where it bites:** everything. Operations 5 and 6 belong to milestone 8 and
  are not built yet — check them anyway, because discovering a gap there now
  is far cheaper than discovering it mid-milestone.
- **If it's wrong:** the fallback is the legacy `api` flow documented in
  milestone 2, and the deprecation risk in `access-tokens.md` §2 comes back
  into play. This is the one item on this page that could change a decision
  rather than a line of code.

- [ ] Checked. Which of the six failed, if any:

### A3. The three observed permission names

`access-tokens.md` §1 records these as names GitLab reported *itself* in an
`insufficient_granular_scope` refusal, discovered by removing permissions one
at a time:

- `Merge Request: Read` — the submit pre-flight, and now the document list
- `Merge Request: Create` — opening the merge request
- `Branch: Delete` — deleting an abandoned branch

- **Assumed:** CE 19.3.0 spells them the same way.
- **Where it bites:** `extractPermissionDetail` passes whatever name GitLab
  gives straight through to the author, so a *different* name is harmless —
  the author is told the truth either way. What matters is whether a refusal
  names a permission at all (see B2).
- **If it's wrong:** the setup guide lists checkboxes that do not exist under
  those names. Worth correcting in `access-tokens.md`, not worth blocking on.

- [ ] Checked. Names as CE reports them:

### A4. The discussions read — NOT OBSERVED ANYWHERE

This is the one genuinely unknown permission, added by the document-status
milestone.

- **Assumed:** `GET /projects/:id/merge_requests/:iid/discussions` is covered
  by `Merge Request: Read`, because it is a sub-resource of the merge request.
  **This is reasoning, not a finding.** Nobody has ever exercised it against a
  token that lacks the permission, so no refusal has named it.
- **Where it bites:** `hasUnresolvedThreads` in `gitlab-client.ts`.
- **If it's wrong:** the refresh fails for any document that carries comments,
  while documents with none resolve normally. The author sees most of their
  documents update and the discussed ones fail — which reads as an
  intermittent fault rather than a missing checkbox. Exactly the trap
  `Merge Request: Create` versus `Merge Request: Read` already sets.
- **How to check:** issue a token with `Merge Request: Read` and confirm the
  document list resolves a document that has comments on it. Then, if you want
  the permission's actual name, remove permissions one at a time until the
  discussions read is the thing that breaks.

- [ ] Checked. Permission CE names for it:

### A5. Branch read and commit creation — never mapped

- **Assumed:** nothing. Every token tested so far happened to hold these, so
  their permission names are simply unknown.
- **Where it bites:** `branchExists` and `createBranchWithCommit`.
- **If it's wrong:** not applicable — there is no assumption to be wrong. This
  is a gap in the setup guide, which cannot tell an admin which boxes to tick
  for operations nobody has isolated.

- [ ] Mapped. Names:

### A6. Reading a file's raw content — NOT OBSERVED ANYWHERE

Added by add-document-recovery, which brought the first read of repository
file content.

- **Assumed:** `GET /projects/:id/repository/files/:file_path/raw` is gated
  the same class of permission as other repository-content reads, but no
  refusal has ever named it. Used by the submit path-collision pre-flight and
  by recovery's content fetch.
- **Where it bites:** `getFileContent` in `gitlab-client.ts`.
- **If it's wrong:** the path-collision pre-flight and recovery both fail as
  insufficient-permission for a token otherwise able to submit — worth the
  same explicit setup-guide note as A4's trap.
- **How to check:** issue a token without the repository-content permission,
  attempt a first-time submit or a recovery, and read the console entry.

- [ ] Checked. Permission CE names for it:

### A7. The merge-request-changes read — NOT OBSERVED ANYWHERE, and possibly deprecated

Also added by add-document-recovery, used only by recovery's
merge-request-fallback path lookup (a record with no stored path).

- **Assumed:** `GET /projects/:id/merge_requests/:iid/changes` is covered by
  the already-observed `Merge Request: Read`, being a sub-resource of the
  merge request exactly as the discussions read (A4) is assumed to be. Not a
  finding — the same reasoning A4 exists to distrust.
- **SEPARATE, LARGER RISK, not merely a permission question:** GitLab
  deprecated this exact endpoint (in favour of `GET
  .../merge_requests/:iid/diffs`) starting 15.7, with removal flagged for a
  future major release. This project has not confirmed whether CE 19.3.0
  still serves it at all — if it was removed, every call fails regardless
  of permissions, and no amount of token configuration fixes it. This is
  worth checking FIRST, before spending time on the permission question
  below, because a 404/410 here is not what `getMergeRequestChangedPath`'s
  own "could not be determined" answer is built for — it is failure, not an
  ambiguous-changed-path case, and should classify accordingly.
- **Where it bites:** `getMergeRequestChangedPath` in `gitlab-client.ts`.
- **If it's wrong (permission):** a legacy record (no stored path) with an
  open review fails to resolve as recoverable even though its content is
  reachable — reads as "not recoverable" rather than as a missing checkbox.
- **If it's wrong (removed):** the merge-request fallback never works on
  this instance at all, for any legacy record, regardless of token
  configuration — worth knowing before this milestone is called done rather
  than discovering it the first time an author needs the fallback.
- **How to check:** call the endpoint directly against a real merge request
  on the target instance first, independent of the plugin, and confirm it
  returns 200 with a `changes` array rather than 404/410/301. Only then
  isolate the permission the way A4 describes.

- [ ] Checked. Endpoint still served: yes / no. Permission CE names for it:

### A8. The non-raw file read, and the update commit — NOT OBSERVED ANYWHERE

Added by add-resubmission-lifecycle, which brought the first read of a
file's metadata and the first commit that is not a `create`.

- **Assumed:** `GET /projects/:id/repository/files/:file_path?ref=<ref>` (no
  `/raw`) is gated by the same permission as A6's raw variant, and a commit
  carrying `action: 'update'` with `last_commit_id` is gated by the same
  write permission A5's `create` commit already uses — whether to an
  existing branch (no `start_branch`) or to one created in the same call.
  Neither has ever been refused, so neither permission has ever been named.
  DO NOT assume A6's answer covers the first of these without checking: it is
  a different endpoint, and a fine-grained token gates per-resource.
- **Where it bites:** `getFileCommitId` and `commitToBranch` in
  `gitlab-client.ts`, plus `createBranchWithCommit`'s `update` path.
- **If it's wrong:** every resubmit of a tracked document fails as
  insufficient-permission for a token that can submit a NEW document
  perfectly well — a confusing split, and worth the same explicit
  setup-guide note as A4's and A6's traps.
- **How to check:** submit a document, merge it, then resubmit it and read
  the console entry if it is refused. Repeat for a document left under
  review, which exercises `commitToBranch` rather than
  `createBranchWithCommit`.

- [x] **Both endpoints are served and permitted.** OBSERVED 2026-09-12 via
  D8's published resubmit ON GITLAB.COM, not on CE 19.3.0:
  `getFileCommitId` and `createBranchWithCommit`'s `update` path both
  succeeded with the Owner-level token in use. That proves
  the endpoints exist and are reachable; it does NOT name a permission,
  because nothing was refused. `commitToBranch` (the no-`start_branch`
  sibling) was exercised separately the same day — see D8's
  "Waiting for review" row — and also succeeded with the same token.
- [ ] Permission CE names for each, from a deliberately under-scoped token:

---

## B. Response shapes the code parses

These are the ones that fail *silently* or fail *loudly in the wrong place*,
so they are worth more attention than their size suggests.

### B1. A missing branch answers 404 with a recognizable body

- **Assumed:** `GET /projects/:id/repository/branches/:branch` for an absent
  branch returns HTTP 404 with `{"message":"404 Branch Not Found"}`, and an
  existing one returns 200. Observed on gitlab.com 2026-09-09, with the branch
  name `%2F`-encoded in the path, which routed correctly.
- **Where it bites:** `branchExists`, which treats **only** an explicit 404 as
  absence and every other outcome as a lookup failure. That three-way shape is
  deliberate: the caller uses this answer to decide whether to *delete* a
  branch, so a failure reported as absence would license both a destructive
  act and a write that cannot succeed.
- **If it's wrong:** if CE answers 403, the submit aborts having written
  nothing — a surprise that costs a submit, not data. That is why this was
  accepted as deferred rather than blocking. If CE answers 200 with an error
  body, that is worse and worth knowing.
- **How to check:** submit a document, then submit a second one whose branch
  does not exist, and watch the console for the branch lookup's status.

- [ ] Checked. Status and body for an absent branch:

### B2. A refused call names its permission in a parseable body

- **Assumed:** the refusal body is

  ```json
  {"error":"insufficient_granular_scope",
   "error_description":"Access denied: This operation requires a fine-grained
    personal access token with the following project permissions:
    [Merge Request: Read]."}
  ```

  with the permission in square brackets, and `error_description` present
  rather than `message`. The code reads `error_description` first *because*
  the earlier version read `message` alone, which the real body does not
  carry — so the detail was always dropped and the author never saw which
  permission to ask for.
- **Where it bites:** `extractPermissionDetail`.
- **If it's wrong:** it degrades rather than breaks. The author still gets the
  insufficient-permission classification and still sees "Your access token
  doesn't have permission…", just without the `(missing: …)` parenthetical —
  the code drops the parenthetical entirely rather than inventing a name.
- **How to check:** issue a token *without* `Merge Request: Read`, press
  Refresh in the panel, and read the console entry for the listing call.

- [ ] Checked. Actual body:

### B3. The merge-request listing carries the fields the code requires

`toMergeRequestSummary` treats `iid`, `state` and `source_branch` as
**required** — if any one is missing from any entry, the whole refresh fails
as `unexpected`. `web_url` and `user_notes_count` degrade individually.

- **Assumed:** all five appear on `GET /projects/:id/merge_requests`.
- **Where it bites:** `toMergeRequestSummary`, and therefore every refresh.
- **If it's wrong:** a missing `web_url` costs the "Open in GitLab" link for
  that document. A missing `user_notes_count` is read as *unknown*, not as
  zero, so the discussions read happens anyway — slower but still correct.
  A missing `iid`, `state` or `source_branch` fails the entire refresh, which
  is loud and obvious rather than subtly wrong.
- **How to check:** call the endpoint directly with `curl` and look at one
  entry, or watch the console after a refresh.

- [ ] Checked. Missing fields, if any:

### B4. Merge-request states are exactly `opened` / `closed` / `merged` / `locked`

- **Assumed:** those four and no others. `opened` and `locked` both count as
  open; `merged` resolves as Published and `closed` as Not accepted.
- **Where it bites:** `settledState` in `reconcile.ts`, which **refuses** any
  state it does not recognize rather than guessing — guessing between
  Published and Not accepted would be a coin flip printed to the author as
  fact.
- **If it's wrong:** the whole refresh fails with an `unexpected`
  classification, and the console names the unrecognized state and the
  document it refused to resolve. Loud, diagnosable, and one line to fix.

- [ ] Checked. Any state seen that is not one of the four:

### B5. A discussion's notes carry `resolvable` and `resolved`

- **Assumed:** `GET /projects/:id/merge_requests/:iid/discussions` returns an
  array of discussions, each with a `notes` array, and a thread counts as
  unresolved when any note has `resolvable: true` and `resolved` not true.
  Notes that are not resolvable — system notes, plain comments — cannot hold a
  thread open and are ignored.
- **Where it bites:** `hasUnresolvedNote` in `gitlab-client.ts`.
- **If it's wrong:** the document never reaches "Changes requested" and reads
  as "Waiting for review" forever — which is precisely the class of silent
  wrongness this milestone existed to remove. **This is the most
  consequential silent failure on the page.** §D2 is the check that catches
  it end-to-end.

- [ ] Checked. Actual note shape:

### B6. Pagination behaves as the loop assumes

- **Assumed:** `per_page=100` is honoured, and a page returning fewer than 100
  entries is the last page. The listing follows up to 10 pages (1,000 merge
  requests) and reports `truncated` when it hits that cap.
- **Where it bites:** `listMergeRequests`.
- **If it's wrong:** if `per_page` is capped lower than 100 by the instance,
  the loop reads a short page and stops early — treating documents beyond it
  as never submitted, which is the one wrong answer that sends an author to
  submit a document that already exists. Worth checking if your project has
  more than 100 merge requests.
- **How to check:** on a project with more than 100 merge requests, confirm
  the document list resolves one whose merge request is older than the
  hundredth.

- [ ] Checked. Effective `per_page`:

### B7. A missing file answers 404, and an existing one returns raw text

Added by add-document-recovery.

- **Assumed:** `GET /projects/:id/repository/files/:file_path/raw?ref=<ref>`
  for an absent path returns HTTP 404 (body unexamined — the code never reads
  it, unlike the branch check), and an existing one returns 200 with the
  file's raw content as the entire body, not wrapped in JSON.
- **Where it bites:** `getFileContent`, via `getRawText` — the one read in
  this plugin whose successful body is not JSON. Getting this wrong the other
  way (treating a JSON-wrapped body as the file's literal content) would
  recreate a note whose content is a JSON envelope instead of the document.
- **If it's wrong:** a 404 with an unexpected shape still resolves correctly,
  since the body is never parsed — only the status matters. A 200 whose body
  is not the raw file (e.g. JSON-wrapped) would silently corrupt every
  recovered note's content, which is the one outcome worth checking for
  directly rather than assuming.
- **How to check:** submit a document, then read it back with `curl` against
  the raw endpoint and confirm the body is exactly the file's content with no
  wrapping; then request a path that does not exist and confirm 404.

- [ ] Checked. Status and body shape for both cases:

### B8. The non-raw file read carries `last_commit_id`

Added by add-resubmission-lifecycle.

- **Assumed:** `GET /projects/:id/repository/files/:file_path?ref=<ref>`
  returns 200 with a JSON object carrying a non-empty string
  `last_commit_id`, and answers 404 for an absent path exactly as B7's raw
  variant does. Note this is the opposite shape to B7: this body IS JSON, and
  it is read through `getRaw` rather than `getRawText` for that reason.
- **Also assumed:** a commit whose `last_commit_id` no longer matches the
  file's current state is REJECTED with a non-2xx status rather than applied.
  This is the whole point of sending it — an instance that ignores the field
  would silently overwrite a reviewer's edit and nothing in the plugin would
  notice.
- **Where it bites:** `getFileCommitId` in `gitlab-client.ts`, and every
  update commit that carries what it returns.
- **If it's wrong (field absent):** the read returns `unexpected` and the
  resubmit refuses having written nothing, with a console entry naming the
  path and ref. A safe failure, but a dead end for the author until it is
  fixed.
- **If it's wrong (stale id accepted):** far worse, and silent — a
  concurrent edit is overwritten with no error anywhere. Check this one
  directly rather than inferring it from a successful ordinary resubmit.
- **How to check:** read the endpoint with `curl` for a file that exists and
  confirm `last_commit_id` is present; then take that id, change the file
  through the web UI, and POST a commit still carrying the old id — confirm
  it is rejected.

- [x] **Field present, and the read works.** OBSERVED INDIRECTLY 2026-09-12,
  via D8's published resubmit against `gitlab.com/styl-group1/kb-docs` — NOT
  the target CE instance: the submit
  completed, and it could only have done so by reading a non-empty
  `last_commit_id` off this endpoint — `getFileCommitId` refuses the whole
  submit and logs the path and ref when the field is missing or empty. The
  endpoint is served, is permitted for an Owner token, and carries the field.
  NOT observed directly with `curl`, so the exact body shape is still
  unrecorded.
- [x] **A stale id is actually REJECTED.** CONFIRMED 2026-09-12 on
  gitlab.com, deliberately and outside the plugin — read the id, pushed a
  revision from the panel to move it, then POSTed an update still carrying
  the old id:

      HTTP 400
      {"message":"The file has changed since you started editing it:
                  test/test-009.md"}

  So the field is enforced, not merely accepted, and the `last_commit_id`
  this change threads through every update path is a real guard rather than
  decoration. Two earlier runs returned 201 and proved nothing: the first
  sent an unsubstituted placeholder, the second sent an id that had never
  gone stale. A probe that cannot fail is not evidence — the script now
  aborts unless it has watched the id actually move.
  NOT re-run on CE 19.3.0. Worth repeating there specifically: this is the
  one assumption in this file whose failure mode is SILENT.
  THE BODY TEXT IS NOW LOAD-BEARING, as of the fix this run prompted.
  `isContentChanged` in `gitlab-client.ts` matches
  `/changed since you started editing/i` against the message above, because a
  400 alone cannot tell a concurrent edit from a branch that already exists.
  If CE words it differently, or localizes it, the write is still REFUSED —
  it just classifies as `unexpected` and the author gets the vaguer message.
  So check the exact wording on CE, and widen the pattern if it differs.

---

## C. The changes-requested mechanism

**Status: shipped on the fallback; this section is an optimization, not a
correctness gap.**

"Changes requested" is currently derived by reading a merge request's
discussions, gated on the listing's `user_notes_count` being greater than
zero — so a document nobody has commented on costs no extra request, and one
that has comments costs exactly one.

The alternative is `blocking_discussions_resolved`, a field that may appear on
each listing entry and would cost nothing extra at all. It was **not** adopted,
because GitLab documents it in terms of the project setting "All threads must
be resolved before merging" and does not show it in its listing examples —
so it might be absent, or present and permanently `true`, and the second of
those is silent. The fallback is correct under every one of those outcomes,
which is why it shipped without the spike being run.

If the checks below show the field is present **and** meaningful, switching to
it removes one request per discussed document and touches exactly one call
site: `hasUnresolvedThreads` in `gitlab-client.ts`.

### C1. Does the listing entry carry `blocking_discussions_resolved`?

Open a merge request, then read `GET /projects/:id/merge_requests` and look at
the entry for it in three states:

| Situation | `blocking_discussions_resolved` reads |
|---|---|
| one unresolved review thread | |
| that thread resolved | |
| no comments at all | |

- [ ] Checked. Field present at all: yes / no

### C2. Repeat with the project setting off and on

Settings → Merge requests → **"All threads must be resolved before merging"**.

| Setting | Unresolved thread | Thread resolved | No comments |
|---|---|---|---|
| OFF | | | |
| ON | | | |

- [ ] Checked.

**Reading the result:**

- Field absent, or `true` regardless of threads with the setting OFF → **keep
  the fallback.** Nothing to do; delete nothing.
- Field tracks the threads with the setting OFF → **switch to it.** No project
  configuration needed.
- Field tracks the threads only with the setting ON → **your call.** Switching
  then makes that setting a prerequisite this project owns and must state
  plainly in the setup guide, in exchange for one fewer request per discussed
  document. On a four-person corpus that is probably not worth a configuration
  dependency.

- [ ] Decision recorded, and `design.md` decision 4 updated if it changed.

---

## D. End-to-end checks in the running plugin

> **INSTANCE USED SO FAR: `gitlab.com` (SaaS, EE).** Everything recorded as
> observed in D8 below was run there, not against the target self-managed
> CE 19.3.0. Per §0 that evidence does not transfer — it establishes that the
> PLUGIN's own logic is right, which was the open question for
> add-resubmission-lifecycle, and establishes nothing about CE. Every D8 row
> is owed a rerun on the target instance before this file's A- and B-section
> assumptions can be struck.

These are the checks that actually prove the document-status milestone. They
are not API probes — run them in Obsidian, against a real project, and watch
the panel.

Set up three documents first: one **published** (merge request merged), one
**awaiting review** (open, no comments), one **not accepted** (closed without
merging).

### D1. The fix itself

Open the panel. All three documents are listed with the right label, and in
particular the published one **no longer reads "Waiting for review"** — that
single wrong sentence, shown forever for every document ever submitted, is the
bug this whole milestone existed to fix.

- [ ] Passes.

### D2. Changes requested, and back again

Leave an unresolved review thread on the open document's merge request.
Refresh → it reads **"Changes requested"**. Resolve the thread. Refresh → it
returns to **"Waiting for review"**.

Both halves matter. A mechanism that can enter the state but never leave it is
worse than one that never enters it. This is also the end-to-end check for B5.

- [ ] Enters the state.
- [ ] Returns from it.

### D3. Reconciles with no local state at all

Delete `data.json`, reload the plugin, open the panel and refresh. Every
document still resolves to its correct state, from front matter alone.

This is the case that proves the remote is the source of truth rather than a
place the plugin happens to write to — and it is the same case as a note
pulled onto a second machine, a vault restored from backup, or a plugin
reinstall.

- [ ] Passes.

### D4. Self-healing

Hand-edit `data.json` to set a published document's state back to `pending`.
Refresh. The panel shows **"Published"** and the stored record is corrected on
disk.

This also covers the narrow case the interrupted-submit change left open: a
submission whose remote calls succeeded but whose local record failed to save.

- [ ] Panel shows the right state.
- [ ] `data.json` was corrected.

### D5. No request on edit

With the panel open and the network tab or console watching, type in a note
and edit its front matter. The panel redraws and **no request is made**.

The panel re-renders on `file-open`, on `active-leaf-change` and on every
`metadataCache` change. Wiring the remote read into the render path is the
natural-looking mistake, and it would put a request behind every keystroke
that touches front matter. Statically, `main.ts` imports only *types* from
`gitlab-client.ts`, so no render path can reach the network — but that is an
argument, and this is the observation.

- [ ] Passes.

### D6. A failed refresh

Break the connection — a wrong host, or revoke `Merge Request: Read` — and
refresh.

- [ ] The list keeps its states rather than blanking.
- [ ] The author is told the refresh did not succeed.
- [ ] A permission refusal names the permission: "Your access token doesn't
      have permission to check your documents' status (missing: …)".

The third depends on B2. If the parenthetical is missing, check B2's body
shape before assuming the panel is at fault.

### D7. Recovery, end to end

Added by add-document-recovery. tasks.md 6.2-6.7 are the authoritative
observable checks for this change; this entry exists so this file's own
end-to-end section does not go silent about it. Run them here against the
real target instance rather than only wherever they were first exercised, and
record which of B7/A6/A7 above they end up confirming.

- [ ] Passes, against this instance.

### D8. Resubmission, in all four states

Added by add-resubmission-lifecycle. The authoritative observable checks for
that change (its tasks.md 7.1-7.3), recorded HERE rather than there because
they can only be run against a real instance and because their results are
what this file exists to hold.

Take one document through each state and resubmit it from the panel button:

- [x] **Waiting for review** — the revision reaches the existing review. No
      second review is opened, and the one that exists keeps its number.
      OBSERVED 2026-09-12, same document as the published case below:
      "Send update" produced commit `64bf857e` — "Update test/test-008.md" —
      on merge request !15, which stayed Open, kept its number, and went from
      1 commit to 2 with Changes still 1. No second merge request was opened.
      The panel showed "Your update was sent. Refresh to see where the review
      stands." and the state stayed "Waiting for review". `commitToBranch`
      works against this instance.
      FOUND BY THIS RUN, and now fixed: the modal re-collected `title` and
      `category`, and the plugin wrote both back to the note afterward —
      a breach of `openspec/config.yaml`'s front matter contract ("the plugin
      never writing again"), which ALSO made every revision commit the
      PREVIOUS revision's `title`, since content is read before that write.
      The resubmit modal is read-only now and writes nothing. RE-RUN THE
      SAME DAY against the fix: the confirmation dialog rendered Title
      `test-008-03` and Category `SOP` read-only — seeded from the note's
      own front matter, with no editable control — and Submit produced a
      third commit `4809fe48` on !15, still Changes 1, still one review.
      The note's front matter was unchanged by the submit, which is the
      point: there is no longer any code path that writes it on a resubmit.
      The one-revision lag is gone with it — what reaches the remote is
      read from the note and nothing rewrites the note afterward.
- [~] **Changes requested** — same as above, and the document STILL reads
      "Changes requested" after a refresh, because the review thread is
      still open. That is correct, not a bug (design.md decision 6); it
      moves only when the thread is resolved.
      DETECTION AND PUSH OBSERVED 2026-09-12 on !15: a diff-line comment
      carrying a Resolve thread button moved the panel from "Waiting for
      review" to "Changes requested" on Refresh — a real round trip, since
      the store held `pending` beforehand — and Send update then landed
      commit `c31dc73d` as the fifth on !15, one review, Changes still 1,
      no second merge request.
      REFRESH-AFTER-PUSH CONFIRMED the same day, incidentally rather than
      deliberately: `refreshDocumentStatuses` reconciles EVERY tracked note,
      not only the active one, so the refreshes run while testing test-009
      re-read test-008 from the remote too — and it kept reporting
      changes-requested. That is the real assertion: the push did not move
      the state and the remote agrees. (Worth noting for future runs: the
      panel reading "Changes requested" immediately after a push proves
      nothing on its own, since `pushUpdate` writes the resolved state into
      the store and the panel renders from the store.)
      STILL OWED: resolve the thread, refresh, and confirm it returns to
      "Waiting for review". Without that half, a state that is merely STUCK
      looks identical to one that is correct.
      Also observed, and it belongs to §9's fix rather than here: !15's diff
      showed `- title: "test-008"` → `+ title: test-008-03`, so the
      committed file carries the same title as the note. The one-revision
      lag is gone, visibly.
- [x] **Published** — a fresh branch is cut from the current default branch,
      the file is UPDATED rather than created (this is the bug the change
      fixed — `docs/resubmission-lifecycle.md` §2), a new review opens, and
      the author is told "Waiting for review".
      OBSERVED 2026-09-12 on `gitlab.com/styl-group1/kb-docs` — NOT the
      target CE 19.3.0 instance, so this transfers no evidence to it (§0) —
      document `test/test-008.md`: the panel offered "Submit a new version",
      the submit produced merge request !15 from `doc/test-008` into `main`
      carrying exactly 1 commit and 1 changed file, and the panel then read
      "Waiting for review" with the button changed to "Send update". The
      update commit was ACCEPTED against a path already on `main` — which is
      the failure this change exists to fix, and it is fixed. Note the branch
      name is `doc/test-008`, derived from the frozen `doc_id`, even though
      the submit carried the new title `test-008-02`: identity did not follow
      the title, as `docs/document-identity.md` §3 requires.
- [x] **Not accepted** — the abandoned branch is cleared, the file is
      created, a new review opens, and the author is told "Waiting for
      review".
      OBSERVED 2026-09-12 on a purpose-made document, `test/test-009.md` —
      deliberately NOT test-008, which is already on `main` and would take
      the update path instead. !16 was closed unmerged with its branch left
      in place; Refresh reported "Not accepted" and the panel offered
      "Submit again"; submitting opened a NEW merge request !17 while !16
      stayed closed, and the panel returned to "Waiting for review".
      TWO SUB-ASSERTIONS ESTABLISHED BY INFERENCE, not by direct reading,
      and recorded as such: (1) the stale branch really was deleted — GitLab
      refuses to create a branch that already exists, and `start_branch` is
      always set, so !17 existing at all means `doc/test-009` was gone
      first; (2) the commit verb really was `create` — GitLab refuses an
      `update` against a path that is not there, and this file was never
      merged to `main`, so a wrong verb would have failed the commit rather
      than producing !17. Both are one click from direct confirmation
      (!17 → Commits: message `Add test/test-009.md`, count 1) if a later
      reader wants it observed rather than deduced.

Then the two refusals. Originally written as "attempted from a document in
EVERY one of the four states above"; NARROWED 2026-09-12 to one state, on a
structural argument rather than to save effort. Both checks sit in
`performResubmit` BEFORE the switch on resolved state — duplicate, then
resolution, then path, then the fork — so they cannot behave differently per
state. Six of the eight runs would have re-exercised identical code. If that
ordering ever changes, restore the four-state requirement with it:

- [x] A second note carrying the same `doc_id` refuses the resubmit, names
      the other note, and writes nothing anywhere (not to the remote, not to
      front matter, not to `data.json`).
      OBSERVED 2026-09-12 on gitlab.com, from a pending document: copying
      `test/test-009.md` to `test/test-009 1.md` in Obsidian carried the
      front matter across, `doc_id` included, and Send update from the
      ORIGINAL refused with "Another note in this vault is the same document:
      test/test-009 1.md. Delete that copy, or clear its document ID, then
      submit again." The "writes nothing" half was NOT verified against the
      remote in this run; it holds by construction, which is the stronger
      claim anyway — this check returns before any remote call is made, and
      the path check below returns after reads but before any write.
- [x] A note moved since its last submission refuses the resubmit, names the
      path to restore, and writes nothing. Repeat with a move that changes
      only letter case — it must refuse the same way.
      OBSERVED 2026-09-12, both halves, after deleting the duplicate above
      (with it present the duplicate check fires first and masks this one —
      which is the documented ordering working, not interference):
      moving `test-009.md` to the vault root refused with "This document
      belongs at test/test-009.md. Move the note back there, then submit
      again."; renaming it to `Test-009.md` in the same folder refused
      identically. The case-only half was expected to be possibly
      untestable on Windows/WSL — it was not: Obsidian performed the rename
      and the check caught it.

- [x] The concurrent-edit guard: edit the document through the web UI while
      the panel holds it, then resubmit. The write must be REJECTED rather
      than overwriting the web edit. See B8, which is where this actually
      gets decided.
      OBSERVED 2026-09-12. Note for anyone repeating it: this CANNOT be
      reached by editing in GitLab and then pressing Send update. The commit
      id is read as late as possible — immediately before the write — so an
      earlier edit is simply read as current and the write succeeds. The
      narrow window is the code being correct, not a gap. It was exercised by
      temporarily inserting a 30-second pause between the read and the write,
      editing on the branch during it, and letting the write proceed: HTTP
      400, classified `content-changed`, and the author was told someone else
      had changed the document rather than to check their connection.

### D9. Reset, and the panel's two sections

Added by add-reset-and-panel-scope (its tasks.md 6.1-6.5), recorded HERE for
the same reason D8 is: they can only be run against a real instance, and this
file is where that evidence lives. NOT RUN AS OF 2026-09-13 — the change
shipped with its code paths reasoned through and its build clean, and
everything below still owed.

Reset is the plugin's only destructive local write, so treat an unexpected
result here as blocking rather than cosmetic.

- [ ] **Reset restores exactly.** Edit a note whose document is **awaiting
      review**, press Reset, confirm. The note afterwards matches what the
      document carries on its own tracked branch **byte for byte, front
      matter included**. Repeat with a document in **changes requested**.
      If the front matter differs at all, the write is re-asserting fields it
      must not touch — see `openspec/config.yaml`'s front matter contract.
- [ ] **Dismissing writes nothing.** Press Reset and dismiss the prompt every
      way out it has — Cancel, Escape, the close button, clicking away. The
      note is untouched in all four. A single path that writes anyway is the
      exact case the NO CI PIPELINE amendment exempts Reset on.
- [ ] **A finished review refuses cleanly.** MERGE the document's merge
      request — or close it AND then press "Delete source branch" — WITHOUT
      refreshing the panel, then press Reset.
      CORRECTED 2026-09-13, this check's own first wording said "merge or
      close". Closing ALONE does not work and is not a bug: closing leaves
      the branch standing, so `fetchResetContent` finds the file exactly
      where it expects and the reset SUCCEEDS. What this check needs is the
      branch GONE, which a merge does (source-branch deletion is on by
      default) and a close does not. The note
      is left untouched and the author is told the reset did not happen. It
      must NOT pull the default branch's content — that would be content from
      a different cycle, written over local work. This is the one check that
      exercises `fetchResetContent`'s missing fallback, so it is the one
      worth running first.
- [ ] **The sections partition.** With a document in each of the five states
      — never submitted, awaiting review, changes requested, published, not
      accepted — "Your documents" holds the first three and "Other documents"
      holds the last two. Then break the refresh so one document resolves to
      nothing: it stays in "Your documents" with no state label, and does not
      move.
- [ ] **The resubmit actions still work after the narrowing.** Open a
      published note and a not-accepted note in turn. Each still offers its
      own resubmit action ("Submit a new version" / "Submit again") and each
      still works, even though neither is in "Your documents" any more. No
      Reset button appears for either.

Depends on A6/A7 and B7: Reset reads the merge request's changed path and
then the file's raw content. A failure here may be either of those rather
than the reset logic — check which call refused before assuming the latter.

---

## Recording what you find

- A confirmed assumption: add the instance and date to the relevant note in
  `access-tokens.md` §1 or to the source comment that carries the caveat, and
  strike the "unconfirmed on CE" wording. A caveat left standing after it has
  been settled costs the next reader the same doubt.
- A **contradicted** assumption: record what the instance actually did —
  status, body, field values — not just that it differed. The observed form is
  what the next person needs; "it didn't work" is not.
- Either way, note it here first. This file is the single place that knows
  what has and has not been proven against a real instance.
