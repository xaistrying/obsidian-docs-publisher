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
