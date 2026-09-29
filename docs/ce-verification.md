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
| Instance URL | `https://git.styl.solutions` |
| Edition (CE / EE / gitlab.com) | **CE**, observed 2026-09-22 — `/api/v4/license` answers 404, and EE serves that endpoint. A negative tell rather than proof; Help → Version states it outright and is still owed. |
| Version | **19.4.0**, read from Help → Version on 2026-09-22. **NOT 19.3.0**, which every other document in this project still says. `/api/v4/version` is a dead end for confirming it — it answers 403, needing the INSTANCE permission `Metadata: Read` that no plugin call uses and no token should be granted. Help → Version is the only practical route, and it is a page, so this row goes stale silently whenever the instance is upgraded. |
| Date run | 2026-09-14 (§E); 2026-09-22 (§§A–C, reads **and** writes) |
| Project used | `ivan/service.doc.kb` (the real corpus) |
| Account, 2026-09-22 | `pham.ngoc.trai` (id 370) — **Maintainer (40)**, no group access. NOT the Developer this run was specified to use, and no second account was available. See the single-account note below. |

> **Partial run, and TWICE ASTERISKED.** §E ran 2026-09-14. A pass over §§A–C
> ran 2026-09-22 via
> `openspec/changes/archive/2026-09-29-verify-against-target-instance/probe.py`, reads first and
> then `--writes`. Edition is now observed; the version is not, and cannot be
> read through the API on a token this project would ever issue.
>
> The write pass closed the three items whose failure mode is SILENT — B9,
> B10 and B11 — against the real instance rather than against gitlab.com.
> B10 is the one worth naming: CE **enforces** `last_commit_id` on an action
> that is not the first, and words the refusal the way `isContentChanged`
> matches. Had it ignored the field, a reviewer's edit could have been
> overwritten with nothing in the plugin noticing.
>
> **Asterisk 1 — the account was Maintainer (40), not Developer (30).** That is
> the substitution the top of this file forbids. Nothing in the 2026-09-22 run
> answers "can an L1/L2 author do this"; it answers "can a Maintainer do this",
> which was never in doubt.
>
> **DECIDED 2026-09-22, deliberately and with the cost understood:** a second
> account at Developer could not be obtained on this project in the available
> time, and downgrading the only Maintainer would have made §§C2, D1, D2, D8
> and D9 unrunnable — merging, toggling the project's thread-resolution
> setting, and leaving review threads all need Maintainer, and a downgraded
> account cannot restore itself. So §D is being run SINGLE-ACCOUNT AS
> MAINTAINER, knowingly.
>
> What that costs, precisely, so nobody later mistakes it for a clean run:
> §D establishes that the PLUGIN's logic is correct end to end. It does NOT
> establish the access floor — that an author holding Developer can create and
> submit. The token screen states the rule that makes this unfixable by
> tokens alone: *"Permissions not included in your assigned role have no
> effect."* An eight-permission token on a Maintainer account still acts as a
> Maintainer, so no token narrowing substitutes for the role.
> **THE ACCESS FLOOR REMAINS UNVERIFIED and is owed before release.** §E1
> already establishes the one place the roles demonstrably diverge: merge is
> Maintainer-only, so an author will never see it.
>
> Self-review is the second compromise, and a smaller one: D2 and B5 need an
> unresolved review thread, which a single account can leave on its own merge
> request. The thread is `resolvable` regardless of who wrote it, so the
> MECHANISM is genuinely exercised; what is not exercised is the realism of a
> different person reviewing. Record which of the two a given result speaks to.
>
> **Asterisk 2 — the token was not narrowed.** Every call SUCCEEDED, so no
> refusal named a permission, so §A learned nothing it was written to learn.
> A call that succeeds tells you the endpoint exists and is reachable. It does
> not tell you which permission it wanted, and §A is entirely about the latter.
>
> What the run DID settle is in §B and §C, where the question is what a
> response looks like rather than what it costs.
>
> **THE VERSION WAS WRONG EVERYWHERE, and the way it was wrong is the point.**
> `access-tokens.md` §1 stated the instance was CE **v19.3.0**, "checked via
> the instance's Help/version page". That page read **19.4.0** on 2026-09-22.
> Every document in this project inherited 19.3.0 from that one sentence.
>
> The likeliest explanation is benign — GitLab ships monthly, and an instance
> checked at 19.3.0 some weeks ago is at 19.4.0 now. That is exactly what
> makes it worth recording rather than quietly correcting: **the target
> version is not a constant.** A finding dated "confirmed on CE 19.3.0" is a
> claim about an instance that no longer exists, and nobody noticed for as
> long as nobody looked.
>
> Practical consequence, which is small: nothing in this project turns on
> 19.3 versus 19.4. The version-gated facts are `detailed_merge_status` (15.6)
> and fine-grained token enforcement, generally available on Self-Managed at
> 19.2 — 19.4.0 clears both by more than 19.3.0 did. No decision changes.
> What changes is that this row now carries a date, and the next reader knows
> to distrust it if the date is old.

> **THE TWO INSTANCES DEMONSTRABLY DIVERGE, and the probe caught it by
> accident 2026-09-27.** Run against `gitlab.com` rather than the target, the
> edition tell inverted: `/api/v4/license` answered **403 `[License: Read]`**
> instead of CE's **404**. Same request, same probe, same token type,
> different platform — SaaS/EE serves an endpoint the target does not have at
> all.
>
> That is a small thing in itself and a large thing as evidence. It is a
> live demonstration of the rule at the top of this file: gitlab.com results
> do not transfer to CE, and "they are the same really" is exactly the
> assumption this project has already been wrong about twice. Any result
> below carrying `gitlab.com` is about the PLUGIN, never about the target.

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

- [x] Checked. CONFIRMED 2026-09-22 on `git.styl.solutions`, CE 19.4.0, both
      ways round.
      **From the API:** the refusal in §0 came back
      `{"error":"insufficient_granular_scope", …}` naming a permission the way
      the token screen spells it (`Metadata: Read`), so fine-grained
      enforcement is live on this version.
      **From the screen:** the token page presents "Add resource permissions"
      with a "Resource and permission selector" — a searchable resource tree on
      the left, granted resources with per-resource permission dropdowns on the
      right. Resource access is tabbed **Group and project / User / Global**,
      which is where §0's "instance permissions" wording for `Metadata: Read`
      comes from: it is a Global-tab permission, not a project one.
      The page's own instruction is worth quoting to authors verbatim, because
      it is this project's advice already: *"Add only the minimum resource and
      permissions needed for your token. Permissions not included in your
      assigned role have no effect."* The second sentence matters for §D — a
      Developer's token cannot be granted past Developer, so an over-granted
      token on a Maintainer account is not a substitute for testing as one.

      **A TOKEN WITH NO PERMISSIONS CANNOT BE CREATED.** Observed 2026-09-22:
      submitting the form with every resource removed is refused with *"Add at
      least one resource with permissions."* This matters for how §A is run —
      "narrow to nothing and let every refusal name itself" is not available as
      a first move. The narrowest legal start is ONE resource, and which one is
      chosen shapes what the run can see: pick something inert and the project
      may not be visible at all, turning every refusal into a 404 that names
      nothing (`classifyStatus` reads 403 and 404 alike as "not visible to
      you"). `Project: Read` is the sane floor — it is almost certainly
      required anyway, and it keeps later refusals as named 403s.

      THE OVER-GRANT IS CONFIRMED, which §2.10 needs. The token in use holds,
      among others, `Work Item: Create`, `Merge Request Approval Rule: Read`
      and `Protected Branch: Read` — none of which any plugin call touches —
      plus `Commit: Update` and `Branch: Create`, which the proposal suspected
      were unnecessary because the plugin only POSTs commits and creates
      branches through the commits API's `start_branch`. Suspected, not yet
      disproven: only a narrowed token settles whether they are required.

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

- [x] Partially checked — 2026-09-22 on `git.styl.solutions` / `ivan/service.doc.kb`, **as Maintainer**.
      **1 (`GET /user`) and 4 (`GET …/merge_requests`) succeeded.** 2 and 3 are
      writes and were not run; 5 and 6 are milestone 8 and were not run.
      Reads beyond the six also succeeded: the repository tree, a branch read,
      the raw and non-raw file reads, the discussions read and
      `/merge_requests/:iid/changes`.
      **Write pass the same day: 2 and 3 also succeeded.** `POST …/commits`
      with `start_branch` → **201** (operation 2, and A5's create half);
      `POST …/merge_requests` → **201** (operation 3);
      `DELETE …/repository/branches/:branch` → **204**, which is
      `Branch: Delete`'s endpoint working. **4 of the 6 are now exercised on
      CE.** 5 (add a note) and 6 (merge) belong to milestone 8 and were not
      run.
      **Operation 6's permission named on a refusal, 2026-09-28** (dated
      2026-09-29 local) on `gitlab.com/styl-group1/kb-docs`:
      `PUT /merge_requests/32/merge` answered **403** with
      `[Merge Request: Merge]`. The account holds Owner there, so this is the
      TOKEN's limit and not the role's — which is the distinction worth
      having, since §E1 establishes that merging is also Maintainer-gated on
      the target project. Two independent gates, and this run isolated the
      token one.
      It also confirms §A2.10's list is right to EXCLUDE it. The plugin never
      merges; an author's token that could merge would hold a permission the
      plugin has no use for, and on a project where merge is the sole
      enforcement boundary (§E1) that is the one over-grant that would
      actually matter.

      **Operation 1's permission is now named.** OBSERVED 2026-09-22 on `git.styl.solutions` (CE 19.4.0), from a token narrowed to `Project: Read` alone:
      `GET /user` refused with `[User: Read]` — a **user**-tab permission, not
      a project one, so it is granted on the token screen's "User" tab and an
      author ticking only project permissions will miss it. That is the same
      trap `Merge Request: Create` versus `Read` sets, on a different axis, and
      it bites HARDER: `getCurrentUser` is what "Test connection" calls first,
      so a token missing it fails at the very first step with nothing else
      having been tried.
      The item is still not discharged: 2 and 3 have been exercised only on an
      UNSCOPED token, so their permission names are unknown, and the account
      remains Maintainer throughout.

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

- [x] Checked. **`Merge Request: Read` re-confirmed on CE**, OBSERVED 2026-09-22 on `git.styl.solutions` (CE 19.4.0), from a token narrowed to `Project: Read` alone:
      `GET /projects/:id/merge_requests?state=all` refused with
      `[Merge Request: Read]` — the same spelling gitlab.com used, so the name
      transfers and the setup guide can state it without hedging.
- [x] **The other two, re-confirmed on CE** — OBSERVED 2026-09-22 on `git.styl.solutions` (CE 19.4.0), from a token holding `Project: Read` alone.
      `POST /projects/:id/merge_requests` refused with `[Merge Request: Create]`
      and `DELETE /projects/:id/repository/branches/:branch` with
      `[Branch: Delete]`. All three gitlab.com names transfer to CE unchanged,
      so the setup guide can state them flatly.
      Named WITHOUT writing anything: this instance evaluates permission before
      existence, so both calls were aimed at a branch that does not exist and
      answered with the permission rather than with 404.

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

- [x] Checked. **`Merge Request: Read`** — OBSERVED 2026-09-22 on `git.styl.solutions` (CE 19.4.0), from a token holding `Project: Read` alone.
      `GET /projects/:id/merge_requests/1/discussions` refused with
      `[Merge Request: Read]`, the SAME permission the listing itself needs.
      So the sub-resource reasoning this file distrusted on principle turns
      out to have been correct: the discussions read adds no new checkbox.
      This was described above as "the one genuinely unknown permission". It is
      known now, and the answer is the reassuring one — a token that can list
      merge requests can read their discussions, so there is no configuration
      in which document states resolve but "Changes requested" silently never
      fires for want of a separate grant.

### A5. Branch read and commit creation — never mapped

- **Assumed:** nothing. Every token tested so far happened to hold these, so
  their permission names are simply unknown.
- **Where it bites:** `branchExists` and `createBranchWithCommit`.
- **If it's wrong:** not applicable — there is no assumption to be wrong. This
  is a gap in the setup guide, which cannot tell an admin which boxes to tick
  for operations nobody has isolated.

- [x] **Branch read: `Branch: Read`.** OBSERVED 2026-09-22 on `git.styl.solutions` (CE 19.4.0), from a token narrowed to `Project: Read` alone:
      `GET /projects/:id/repository/branches/main` refused with
      `[Branch: Read]`. The gap this item recorded — "every token tested so far
      happened to hold these" — is closed for the read half.
      NOTE, because it changes what §B1 can be checked with: the refusal is
      identical for a branch that EXISTS and one that does not. Asking for
      `does-not-exist-probe` on this token answered 403 `[Branch: Read]`, not
      404 — permission is evaluated before existence. So an under-scoped token
      cannot tell "absent" from "refused", which is exactly why
      `classifyScopedStatus` keeps them as different kinds and why §B1 must be
      checked on a token that HOLDS `Branch: Read`.
- [x] **Commit creation: `Commit: Create`.** OBSERVED 2026-09-22 on `git.styl.solutions` (CE 19.4.0), from a token holding `Project: Read` alone:
      `POST /projects/:id/repository/commits` carrying `start_branch` refused
      with `[Commit: Create]`.
      **Note what it did NOT name: `Branch: Create`.** The plugin creates a
      branch through this call's `start_branch` rather than through the
      branches API, and the refusal asks only for `Commit: Create` — which is
      the first evidence for the proposal's suspicion that `Branch: Create` is
      an unnecessary grant. NOT YET PROOF; see the sequential-refusal caveat
      in §A2.10.

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

- [x] Checked. **`Repository: Read`** — OBSERVED 2026-09-22 on `git.styl.solutions` (CE 19.4.0), from a token holding `Project: Read` alone.
      `GET /projects/:id/repository/files/:path/raw?ref=…` refused with
      `[Repository: Read]` — the same permission the tree read wants (§E5), not
      a separate file-level one. The expectation recorded above, that this
      would be gated the way `branchExists` is, was half right: it IS repository
      content, but `Branch: Read` and `Repository: Read` are DIFFERENT
      checkboxes, and reading a file needs the latter.

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
- **WIDER BLAST RADIUS than when this item was written.** It said "used only
  by recovery's fallback"; that is no longer true. As of
  add-resubmission-lifecycle and add-attachment-sync, three behaviours read
  this answer — the pre-submit path-mismatch check, Reset, and recovery's
  fallback — and the first of them SKIPS its check rather than refusing when
  the path cannot be determined. So an endpoint that is gone or refused does
  not merely disable recovery's fallback: it silently removes the
  refuse-to-move guarantee from every document. Check this one first.
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

- [x] **Endpoint still served: YES.** OBSERVED 2026-09-22 on `git.styl.solutions` / `ivan/service.doc.kb`.
      `GET /projects/:id/merge_requests/1/changes` returned **200** — not 404,
      not 410, not a redirect. The deprecation worry in the item above does not
      bite on this version, and recovery's fallback path has an endpoint to
      call. The `changes` array's own shape was not inspected.
- [x] **Permission: `Merge Request: Read`.** OBSERVED 2026-09-22 on `git.styl.solutions` (CE 19.4.0), from a token holding `Project: Read` alone:
      `GET /projects/:id/merge_requests/1/changes` refused with
      `[Merge Request: Read]`. Expectation confirmed — a sub-resource of the
      merge request, gated by the merge request's own permission, exactly as
      the discussions read is. Recovery's fallback path lookup needs no
      checkbox of its own.

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
- [x] **The non-raw read works on CE.** OBSERVED 2026-09-22 on `git.styl.solutions` / `ivan/service.doc.kb`:
      `GET …/repository/files/Global%2FContribution-Guide.md?ref=main` returned
      **200** carrying `last_commit_id`
      `'122a8a6d627411058405457f51f7787ea93d740a'` and `encoding: "base64"` with
      `content` present. That is B8's read half and E7 together. The UPDATE
      commit was not run — reads-only pass.
- [x] **The non-raw READ: `Repository: Read`.** OBSERVED 2026-09-22 on `git.styl.solutions` (CE 19.4.0), from a token holding `Project: Read` alone:
      `GET …/repository/files/:path?ref=…` refused with `[Repository: Read]`,
      the same as the raw variant (§A6) and the tree (§E5). One checkbox covers
      every repository-content read this plugin makes.
- [x] **The UPDATE commit: `Commit: Create`.** Same endpoint and same
      permission as the create — OBSERVED 2026-09-22 on `git.styl.solutions` (CE 19.4.0), from a token holding `Project: Read` alone. The plugin
      POSTs every write to `/repository/commits`, whatever verbs the `actions`
      array carries, so one checkbox covers create and update alike.
      **`Commit: Update` is therefore not required**, confirming the proposal's
      second suspected over-grant — subject to the same §A2.10 caveat.

---

### A2.10. THE MINIMUM PERMISSION LIST — derived 2026-09-22, NOT YET VERIFIED

Every name below was reported by CE 19.4.0 itself on `git.styl.solutions`,
from a token narrowed to `Project: Read` alone and then asked to do each of
the plugin's calls. This is the list onboarding has never had.

**User tab** (not "Group and project" — the tab is the trap):

| Permission | Why |
|---|---|
| `User: Read` | `GET /user`. The FIRST call "Test connection" makes. |

**Group and project tab:**

| Permission | Why |
|---|---|
| `Project: Read` | `GET /projects/:id` — the role check |
| `Repository: Read` | the file tree, and every file read, raw or not |
| `Branch: Read` | does this document's branch already exist |
| `Branch: Delete` | removing an abandoned branch on resubmit |
| `Commit: Create` | every write — create AND update, one endpoint |
| `Merge Request: Read` | the listing, its discussions, and its `/changes` |
| `Merge Request: Create` | opening the review |

Eight in total. For comparison, the token this project had been using carried
seventeen.

**NOT REQUIRED, on this evidence** — each was granted on the old token and
none was ever named by a refusal: `Work Item: Create`,
`Merge Request: Approval Rule: Read`, `Protected Tag: Read`,
`Repository: Tag: Read`, `Protected Branch: Read`, `Commit: Update`,
`Branch: Create`, `Code: Push`. The last three are the interesting ones, and
the reasoning is the proposal's: the plugin POSTs commits rather than updating
them, creates branches through the commits API's `start_branch` rather than
the branches API, and never uses git-over-HTTP.

**NECESSARY, AND NOW ALSO SUFFICIENT.** GitLab names ONE missing permission
per refusal, not all of them, so each entry above was confirmed NECESSARY the
moment something was refused without it — but that reasoning cannot establish
that the list is COMPLETE. Granting `Commit: Create` might simply have moved
the commit call's refusal on to a second requirement never yet visible,
`Branch: Create` being the obvious candidate.

- [x] **Verified sufficient 2026-09-22.** A token holding exactly these eight
      and nothing else ran both probe passes — reads with an explicit `--file`
      and `--mr`, then `--writes`. **Every call answered 2xx**, through commit
      creation (201), the multi-action commit (201), merge request creation
      (201) and branch deletion (204). No new permission name appeared
      anywhere. `Branch: Create` is NOT required, which settles the proposal's
      suspicion rather than leaving it as reasoning.
      The only refusal left in the run is `/api/v4/version` wanting the
      Global-tab `Metadata: Read`, and that is correct and deliberate: no
      plugin call touches it, so it stays off the list. An author's version is
      read from Help → Version, not by the plugin.

This list is now what onboarding tells an author to ask for.

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

- [x] Checked. CONFIRMED 2026-09-22 on `git.styl.solutions` / `ivan/service.doc.kb`.
      `GET …/repository/branches/does-not-exist-probe` → **HTTP 404**, body
      `{"message":"404 Branch Not Found"}`. Classified `not-reachable`, which
      is what `branchExists` reads as "absent". As assumed.
      RE-CHECKED on the verified eight-permission token: still 404, still that
      body. That is the reading which counts, per §A5's note — on a token
      LACKING `Branch: Read` the same request answers **403**, because
      permission is evaluated before existence, so an under-scoped token
      cannot tell absent from refused at all.

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

- [x] Checked. **CONFIRMED on CE** — 2026-09-22 on `git.styl.solutions` / `ivan/service.doc.kb`. This is the
      more important of the two assumptions this file opens with, and on this
      version the body has exactly the shape `extractPermissionDetail` parses:

          HTTP 403
          {"error":"insufficient_granular_scope",
           "error_description":"Access denied: This operation requires a
            fine-grained personal access token with the following instance
            permissions: [Metadata: Read]."}

      `error_description`, a bracketed permission spelled as the token screen
      spells it. Run through the client's own parse, it yields
      `'Metadata: Read'` — so the author WOULD be told which permission to ask
      for. The gitlab.com fix holds on CE 19.4.0.

      **One wording difference, and it costs nothing:** CE says "the following
      INSTANCE permissions" here where gitlab.com's recorded body said
      "PROJECT permissions". The parse never looked at that word — it takes
      whatever is in brackets — so both forms extract correctly.

      **Scope of the evidence, stated plainly:** this refusal came from
      `/api/v4/version`, an INSTANCE-scoped call the plugin never makes. It was
      the only refusal the run produced, because the token was un-narrowed and
      every plugin call succeeded. A PROJECT-scoped refusal — the
      `Merge Request: Read` case that started all this — has still not been
      seen on CE. The shape is the same in GitLab's source for both, and the
      parse is indifferent to the difference, so this is close to settled; it
      is not the same as having watched it.
- [ ] Re-confirm against a PROJECT-scoped refusal, from a narrowed token.

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

- [x] Checked. CONFIRMED 2026-09-22 on `git.styl.solutions` / `ivan/service.doc.kb`: **none missing.**
      `iid`, `state`, `source_branch`, `web_url` and `user_notes_count` were
      all present on the listing entry. `toMergeRequestSummary` has everything
      it treats as required, and both degrading fields too.
      Read from a ONE-ENTRY listing — the project has a single merge request —
      so this confirms the shape CE emits, not that every entry in a long
      listing carries them.

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
      **PARTIALLY ANSWERED 2026-09-22 on `git.styl.solutions` /
      `ivan/service.doc.kb`. Two of the four seen, no surprises.**
      The first run returned one entry, `merged`. A later run the same day —
      after the write pass's probe merge request had been closed — returned two
      entries, `['closed', 'merged']`. Both are spelled exactly as
      `settledState` expects, so half the vocabulary is confirmed on CE and
      nothing outside the four has appeared.
      **ANSWERED ON CE 2026-09-29** on `git.styl.solutions` /
      `ivan/service.doc.kb`: `states seen=['closed', 'merged', 'opened']`
      across the project's four merge requests. Three of the four spellings
      observed on the TARGET, all exactly as `settledState` expects, and
      nothing outside the four.
      `locked` remains unseen anywhere. It is a transient GitLab holds during a
      merge and a poll may never catch it; recorded as unobservable rather than
      as un-run. What keeps that cheap is that an unrecognized state FAILS
      LOUDLY — `settledState` refuses rather than guessing — so a fifth
      spelling would cost a refresh and a console line, never a wrong state
      shown to an author as fact.
      Also seen 2026-09-27 on `gitlab.com` across 25 merge requests, which adds
      only that no fifth spelling appears in a listing an order of magnitude
      larger.
      `locked` is still unseen anywhere. `locked` is a transient GitLab holds
      during a merge and a poll may never catch it; if it cannot be observed,
      record THAT rather than leaving this item looking un-run. What keeps the
      gap cheap is that an unrecognized state FAILS LOUDLY — `settledState`
      refuses rather than guessing — so an unseen fifth spelling costs a
      refresh and a console line, never a wrong state shown to an author as
      fact.

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
      **STILL OPEN after 2026-09-22 on `git.styl.solutions` / `ivan/service.doc.kb` — and this is the item
      the file calls the most consequential silent failure on the page, so read
      the caveat rather than the headline.**
      The discussions read returned 200 with 1 discussion holding 1 note. Of
      the two keys, only `resolvable` was present; `resolved` was absent.
      **That is not yet a contradiction.** GitLab omits `resolved` on notes
      that are not resolvable — system notes and plain comments — and a single
      note on a merged merge request is most likely exactly that. The plugin's
      rule (`resolvable && !resolved`) answers false for such a note, which is
      correct. What the run did NOT produce is a note with `resolvable: true`,
      which is the only kind that can hold a thread open and the only kind this
      item is about.
      **ANSWERED 2026-09-27**, on `gitlab.com/styl-group1/kb-docs` (SaaS/EE)
      with a published diff-line review on merge request !26:

          discussions=2  notes=2
          note keys seen=['resolvable', 'resolved']
          unresolved by the plugin's rule: True

      Both keys are present on a genuinely resolvable note, and
      `hasUnresolvedNote`'s rule — `resolvable && !resolved` — computes TRUE
      against it. This is the first time the question has actually been asked:
      every earlier run found only `resolvable`, because the only notes
      available were non-resolvable ones that GitLab omits `resolved` from.

      **CONFIRMED ON CE 2026-09-29** — `git.styl.solutions` /
      `ivan/service.doc.kb`, merge request !4 with a published diff-line
      thread:

          discussions=1  notes=1
          note keys seen=['resolvable', 'resolved']
          unresolved by the plugin's rule: True

      Both keys present on a genuinely resolvable note, on the TARGET
      instance, and `hasUnresolvedNote`'s rule computes True against it.
      §0's rule is satisfied in both directions now: the RULE is plugin logic
      and holds everywhere, and the SHAPE has been read on CE rather than
      transferred from EE.
      This was the last item in this file carrying "owed on CE". The
      silent-failure mode it exists to catch — a document reading "Waiting for
      review" forever while a reviewer waits — is ruled out on the instance
      that matters.

      **A trap found while getting here, worth the setup guide's attention.**
      A reviewer who writes diff comments and never clicks Submit review
      leaves GitLab with ZERO discussions — pending review notes live on a
      separate `draft_notes` endpoint and are invisible to `/discussions`
      until published. The plugin therefore reports "Waiting for review",
      which is CORRECT (nothing has been said yet) but will read to an author
      as the reviewer having done nothing, and to the reviewer as feedback
      having been delivered. No code change: the remote genuinely carries no
      feedback. `probe.py` now checks `draft_notes` whenever discussions come
      back empty, so this cannot be mistaken for B5 failing again.

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
      **ANSWERABLE WITHOUT A FIXTURE, as of 2026-09-27.** `probe.py` now prints
      GitLab's pagination headers, so `X-Per-Page` reports the effective page
      size directly instead of being inferred from how many entries came back.
      **ANSWERED ON CE 2026-09-29, and with real pagination rather than a
      single page.** On `git.styl.solutions` / `ivan/service.doc.kb` the
      repository tree answered:

          pagination: per-page=100 page=1 total=183 pages=2 next='2'

      So CE honours the 100 the loop asks for, and this corpus is large enough
      that the loop MUST page — 183 entries over two pages, with `X-Next-Page`
      pointing at the second. The assumption is no longer inferred from a
      listing that fitted on one page; the multi-page case is the observed one.
      The merge-request listing on the same run read `per-page=100 total=4
      pages=1`, the single-page case, so both branches of the loop are covered.
      Also seen on `gitlab.com` 2026-09-27 at `per-page=100 total=25 pages=1`.
      **NOT EXERCISED 2026-09-22 on `git.styl.solutions` / `ivan/service.doc.kb`.** The listing asked for
      `per_page=100` and came back with 1 entry, so the loop stopped on page 1
      and no second page was ever requested. Nothing was learned about whether
      CE honours `per_page=100`, or caps it lower — which is the whole question.
      Needs a listing of more than one page's worth, or an explicit small
      `per_page` to force a second request.

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

- [x] Checked. CONFIRMED, both cases — 2026-09-22 on `git.styl.solutions` / `ivan/service.doc.kb`.
      **Exists:** `GET …/files/Global%2FContribution-Guide.md/raw?ref=main` →
      **200**, 13,764 bytes, body starting
      `---\nid: GLB-CONTRIB-001\ntitle: How to Contribute to the Know…` — the
      file's own bytes, front matter included, with no JSON wrapping. What
      `getRawText` expects.
      **Absent:** `…/files/no-such-file-probe.md/raw?ref=main` → **404**, body
      `{"message":"404 File Not Found"}`. Distinguishable from a permission
      refusal, which is what the three-way read needs — and confirmed on the
      verified eight-permission token, the only token on which that
      distinction is observable: without `Repository: Read` the same request
      answers 403, not 404.

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
  **The READ half is now confirmed on CE** — 2026-09-22 on
  `git.styl.solutions`: `GET …/repository/files/Global%2FContribution-Guide.md?ref=main`
  returned 200 with `last_commit_id`
  `'122a8a6d627411058405457f51f7787ea93d740a'`, a non-empty string as assumed.
  **The GUARD half is now confirmed too** — same day, via `probe.py --writes`:
  a stale `last_commit_id` was REFUSED with HTTP 400 and gitlab.com's exact
  wording, so `isContentChanged` fires and the failure classifies
  `content-changed`. See §B10, which records the body. The assumption in this
  file whose failure mode is SILENT is no longer an assumption on this
  version.
  THE BODY TEXT IS NOW LOAD-BEARING, as of the fix this run prompted.
  `isContentChanged` in `gitlab-client.ts` matches
  `/changed since you started editing/i` against the message above, because a
  400 alone cannot tell a concurrent edit from a branch that already exists.
  If CE words it differently, or localizes it, the write is still REFUSED —
  it just classifies as `unexpected` and the author gets the vaguer message.
  So check the exact wording on CE, and widen the pattern if it differs.

### B9. A commit with several actions and mixed verbs is accepted

Added by add-attachment-sync. **This is the irreducible one of the three: a
test can only assert what this project BELIEVES the API wants, and this file
exists because that belief has been wrong twice already.**

- **Assumed:** `POST /projects/:id/repository/commits` accepts an `actions`
  array with more than one entry, and accepts `create` and `update` entries
  mixed in the same array, applying all of them as a single commit — so a
  rejected action leaves NONE of the files written and no branch
  half-created.
- **Where it bites:** `createBranchWithCommit` and `commitToBranch` in
  `gitlab-client.ts`, which is every write path the plugin has.
- **If it's wrong:** every submit of a document that embeds an image fails.
  A document that embeds nothing still builds a single-entry array, exactly
  as it did before this change, so the no-attachment case is unaffected either
  way — which is the one thing that makes this a survivable surprise rather
  than a broken plugin.
- **How to check:** submit a document embedding two images, one of which is
  already on the default branch (so its verb is `update`) and one of which is
  not (`create`). Confirm one commit lands carrying all three files.

- [x] **ALSO CONFIRMED ON CE 19.4.0**, 2026-09-22 on `git.styl.solutions` /
  `ivan/service.doc.kb`, via `probe.py --writes`. One commit carried an `update` of a
  markdown file (with `last_commit_id`) and a `create` of a PNG (with
  `encoding: "base64"`): **HTTP 201**. Mixed verbs in one `actions` array work
  here as they do on SaaS, so the attachment-sync commit shape is no longer
  gitlab.com-only evidence.
- [x] Checked. CONFIRMED 2026-09-13 on `gitlab.com/styl-group1/kb-docs` — NOT
  on the target CE 19.3.0 instance (§0). `test-015` embedded two images, one
  already on `main` from a merged `test-014` and one not. ONE commit
  `cb4133e9` carried all three files with the verbs mixed:

      new      test/img-new.png
      modified test/img-shared.png
      new      test/test-015.md

  So `actions` accepts several entries, accepts `create` and `update` in the
  same array, and applies them as one commit.
  ALSO OBSERVED, and it settles the ordering question cheaply: the commit
  message read `Add test/test-015.md`. `commitMessage` names `actions[0]`, so
  the note really is first in the array. The `/diff` listing above is NOT
  evidence of order — GitLab sorts it by path, which is why `img-` precedes
  `test-` there.
  TRAP THAT COST TWO RUNS, worth repeating for whoever reruns this on CE:
  installing a new `main.js` changes nothing until Obsidian RELOADS the
  plugin. Two documents published without their attachments and looked like
  an embed-resolution bug; the running code simply predated this change.

### B10. A per-action `last_commit_id` is honoured beyond the first action

- **Assumed:** the guard B8 confirmed for a single-action commit applies
  per-action: a stale `last_commit_id` on the SECOND or later entry is
  refused, not ignored.
- **Where it bites:** every attachment an illustrated document shares with
  another document. The note is always first in the array, so an attachment's
  guard is never the first one.
- **If it's wrong:** SILENT, and it is the same silent failure B8 warns
  about, one position further along. Two authors revising documents that
  embed the same image would overwrite each other's version of it with no
  error anywhere. This is the check worth doing carefully.
- **How to check:** exactly as B8, but with the stale id on the second
  action rather than the first. Read an attachment's `last_commit_id`,
  change that file through the web UI, then POST a two-action commit whose
  first action is a valid note write and whose second carries the now-stale
  id. Confirm the whole commit is rejected and the note is NOT written.
  A probe that cannot fail is not evidence — confirm the id actually moved
  before sending.

- [x] **ALSO CONFIRMED ON CE 19.4.0**, 2026-09-22 on `git.styl.solutions` /
  `ivan/service.doc.kb`, via `probe.py --writes`. **This is the one that mattered**, because an
  instance that IGNORED the field would overwrite a reviewer silently. CE does
  not ignore it. A commit whose SECOND action carried a `last_commit_id` made
  stale by the preceding commit was refused:

      HTTP 400
      {"message":"The file has changed since you started editing it:
                  probe/ce-verification-1790057532/probe.md"}

  Two things confirmed at once. The guard is enforced **beyond the first
  action** — the first action of that same commit was a `create` that would
  have succeeded on its own, and the whole commit was rejected. And the WORDING
  is identical to gitlab.com's, so `isContentChanged`'s prose match fires on CE:
  the failure classifies `content-changed`, not `unexpected`, and the author is
  told someone changed the document rather than to try again. The concern
  recorded in §B8 — that CE might word or localize it differently — does not
  materialize on this version.
- [x] Checked. CONFIRMED 2026-09-13 on `gitlab.com/styl-group1/kb-docs` — NOT
  on the target CE 19.3.0 instance (§0). Run by `b10.sh` at the repo root,
  which creates the staleness itself with a legitimate intermediate commit
  rather than relying on a hand edit, and aborts unless it has watched the id
  actually move.
  Two actions were sent against `doc/test-015`: a VALID note update first,
  then an attachment update carrying a now-stale id.

      probe commit : HTTP 400
      {"message":"The file has changed since you started editing it:
                  test/img-shared.png"}

  BOTH halves hold, and the body proves the first one rather than implying
  it: the refusal NAMES `test/img-shared.png`, which is `actions[1]`, so the
  server evaluated the second action's guard rather than stopping at the
  first. And the note's `last_commit_id` was identical before and after, so
  the valid action was rolled back with the refused one — the commit is
  atomic, which is what "one commit or not at all" depends on.
  CONSEQUENCE worth noting for whoever reads the author-facing side: a
  refusal caused by an ATTACHMENT still reaches the author as
  `CONTENT_CHANGED_MESSAGE`, which says "Someone else changed this document".
  Accurate about what happened and about what to do, slightly imprecise about
  WHICH file moved — it may have been an image the document embeds rather
  than the note. Left as-is; noted so it is a known imprecision rather than a
  surprise.

### B11. Binary content survives as base64 through `requestUrl`

- **Assumed:** an action carrying `encoding: "base64"` alongside base64
  content produces a file on the remote byte-identical to the local one, and
  Obsidian's `requestUrl` does not mangle that content on the way.
- **Where it bites:** `commitActions` in `gitlab-client.ts`, which sets
  `encoding` per action, and `readAttachmentBytes` in `vault-attachments.ts`,
  which produces the base64 through Obsidian's own `arrayBufferToBase64`.
- **If it's wrong:** images publish corrupted rather than missing, which is
  worse than the bug this change fixes — a broken embed is visible, a
  corrupted PNG may not be until someone opens it.
- **How to check:** submit a document embedding a PNG. Confirm the image
  renders in the GitLab UI, then download the committed file and compare its
  checksum against the local one (`sha256sum`). Rendering alone is not
  enough: a truncated file can still render.

- [x] **ALSO CONFIRMED ON CE 19.4.0**, 2026-09-22 on `git.styl.solutions` /
  `ivan/service.doc.kb`, via `probe.py --writes`. A 1x1 PNG committed with
  `encoding: "base64"` and read back from `/raw` was **byte-identical**. The
  small size is the weakness of this particular check — it exercises the
  encoding path but not a payload large enough to hit any chunking or size
  behaviour, which the 2026-09-13 gitlab.com run did at 280,747 bytes. Between
  the two, encoding correctness is established on CE and size behaviour on
  SaaS; a large binary on CE is the remaining gap, and it is a small one.
- [x] Checked. CONFIRMED 2026-09-13 on `gitlab.com/styl-group1/kb-docs` — NOT
  on the target CE 19.3.0 instance (§0). Run by `b11.sh` at the repo root.
  A 1920x1080 PNG committed through the plugin came back byte-identical:
  280747 bytes both sides, `file` reporting the same PNG on each, matching
  PNG magic, and equal sha256. So `encoding: "base64"` per action and
  `readAttachmentBytes`'s use of Obsidian's `arrayBufferToBase64` round-trip
  through `requestUrl` without mangling.
  METHOD NOTE, because the first attempt reported a FALSE mismatch: a bare
  `curl -o` with no status check wrote an auth-failure JSON body into the
  file and the checksum then compared that against a PNG. The shell variable
  holding the token was simply unset — the probe scripts prompt for it rather
  than exporting it. `b11.sh` checks the HTTP status before comparing
  anything, and prints sizes, `file` output and header bytes so a mismatch
  says WHICH kind it is. Do not re-run this with a bare checksum.

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

- [x] Checked. **PRESENT — YES.** OBSERVED 2026-09-22 on `git.styl.solutions` / `ivan/service.doc.kb`.
      `blocking_discussions_resolved` appears on the merge-request LISTING
      entry on CE 19.4.0, not only on the single-MR read. The long-standing
      question of whether this field is EE-only, or listing-omitted, is
      answered for this version: it is neither.
      This does not change the shipped mechanism, which reads discussions
      directly and is correct either way (see C2). What it removes is the
      doubt about whether the cheaper path was ever available here.

### C2. Repeat with the project setting off and on

Settings → Merge requests → **"All threads must be resolved before merging"**.

| Setting | Unresolved thread | Thread resolved | No comments |
|---|---|---|---|
| one way | **Changes requested** | **Waiting for review** | Waiting for review |
| the other | **Changes requested** | **Waiting for review** | Waiting for review |

- [x] Checked. **THE SETTING MAKES NO DIFFERENCE** — 2026-09-27 on
      `gitlab.com/styl-group1/kb-docs`, merge request !26, all four readings
      taken from the panel's active-document state line.
      A reopened thread read "Changes requested"; flipping the project setting
      and refreshing left it at "Changes requested". Resolving the thread read
      "Waiting for review"; flipping the setting back and refreshing left it at
      "Waiting for review". The state tracked the THREAD in every case and the
      setting in none.
      That is the shipped mechanism behaving as designed: it reads discussions
      directly (`hasUnresolvedNote`) rather than the merge request's
      `blocking_discussions_resolved`, so it cannot be coupled to a project
      toggle. §C1 established the field IS present on this platform; this
      establishes the plugin does not lean on it.
      PLUGIN LOGIC, so it transfers to CE — the behaviour under test is the
      plugin's own choice of source, not a platform response shape.
      **Worth stating in the setup guide as a non-requirement:** nobody needs
      to configure "All threads must be resolved" for document states to be
      correct. A prerequisite that does not exist is still worth naming, since
      its absence is otherwise indistinguishable from nobody having checked.

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

### D0. FINDINGS FROM THE 2026-09-27 RUN — TWO FIXED, ONE OPEN

**TRIAGE of this whole set lives in
`openspec/changes/archive/2026-09-29-verify-against-target-instance/triage.md`** — which finding
is fixed where, which are carried elsewhere, and which of them are not failures
at all. This section records what was OBSERVED; that file records what was
decided about it.

**STATUS AS OF 2026-09-27, after `fix-edited-baseline` and
`name-panel-sections-by-next-actor` shipped:**

- **D0a — resolved by redesign.** The panel no longer has a section a
  submitted document falls out of. It now names sections by who acts next:
  "Needs you" and "Waiting on reviewers". A submitted, untouched document
  appears in the latter, under "Sent and unchanged. Nothing to do until a
  reviewer responds." The surprise recorded below — a document vanishing at
  the moment you submit it — no longer happens.
- **D0b — FIXED.** `captureEditBaseline` reads the baseline from the adapter
  rather than `TFile.stat`, all three write paths take it from there, and
  Reset now calls `store.saveEditBaseline` on both its overwrite and create
  paths. The row renders the edited marker ALONGSIDE the state rather than
  instead of it. The blocked items below are readable again.
- **D0c — STILL OPEN.** Reset's confirmation still takes ~3 seconds with no
  busy state. `CHECKING_LABEL` remains wired to Refresh alone.
- **D0e — ORPHANING PREVENTED, CAUSE UNKNOWN (2026-09-29,
  `correct-stale-records`).** A first submit now records the document before
  writing front matter. Why the original submit failed is still not diagnosed.
- **D0f — FIXED AND OBSERVED 2026-09-29 (`correct-stale-records`). FORMERLY NOT YET
  OBSERVED.** Refresh reconciles every stored record, not only the vault's
  notes.
- **D0h — FIXED 2026-09-29 (`scope-records-to-their-project`).** A record
  carries the project it belongs to, and no surface shows its state or offers
  an action from it unless that project is the configured one.

The entries below are kept as written, because what they record is how the
defects presented and how they were traced — which is the part worth having
next time. Read them as history, not as current behaviour.

### D0. FINDINGS FROM THE 2026-09-27 RUN, before D1 could be read

Two things surfaced while building §D's three document states. Recorded here
because the §D checks below cannot be read honestly without them.

#### D0a. A submitted document disappears from the panel — SUPERSEDED 2026-09-27

**SUPERSEDED by `name-panel-sections-by-next-actor`, 2026-09-27 — not yet
observed.** A submitted, untouched document no longer disappears: it MOVES
from "Needs you" (the renamed "Your documents", same `needsAuthor` rule) to a
new "Waiting on reviewers" section, collapsed by default, whose heading count
goes up by one. That count is the feedback a submit landed. Published and
untouched documents are still listed nowhere. The record below describes the
panel before that change and is kept as the reason for it. Confirm the move
with D9's "Needs you" checks.

Reported as "after Submit for review the document does not appear in Your
documents; it only appears after pressing Reset."

That is the panel behaving as specified. "Your documents" means WORK OWED as
of the 2026-09-22 narrowing (`needsAuthor` in `document-status.ts`), and a
freshly submitted document is `pending` with no local edits — it is waiting on
a reviewer, not on the author, so it is deliberately not listed. The panel no
longer carries a roll-call of everything ever submitted; that list was the one
section here that could not be acted on.

**No longer timing-dependent, as of 2026-09-27 (fix-edited-baseline).** This
entry used to carry a caveat that the disappearance was unpredictable: the
stale submit baseline in §D0b made a freshly submitted note read as edited
some of the time, and an edited pending document IS work owed, so it was
listed instead. With the baseline read from the filesystem, a submitted and
untouched document reads as not edited every time, and leaving the list is
simply the design. (Observed 2026-09-27: that change's tasks.md 5.1.)

NOT A DEFECT, but worth recording that it surprised the person who
commissioned the narrowing, which is a UX signal rather than a correctness
one. A document vanishing at the moment you submit it reads as a failed
submit. If that is worth changing it is a design question for its own
milestone, not a fix — the confirming Notice ("Waiting for review") and the
"Documents you can restore" count are the only feedback that a submit landed.

#### D0b. Reset marks the note "Edited — not sent yet" — FIXED 2026-09-27, OBSERVED

**FIXED by `fix-edited-baseline`, 2026-09-27.** All three symptoms below
shared the root cause recorded here — the `mtime` baseline was written in
three places and maintained in none — and all three are addressed:

- The baseline has one producer, `captureEditBaseline`
  (`document-status.ts`), which reads the FILESYSTEM via
  `app.vault.adapter.stat` rather than `TFile.stat`. The stored field is a
  branded `EditBaseline`, so a plain `file.stat.mtime` no longer compiles
  into a record. Submit (both paths) and Import go through it.
- Reset and Restore now record a baseline after their write, through
  `SubmissionStore.saveEditBaseline`, which takes nothing but the baseline —
  state, branch and path cannot move. The `doc-authoring` spec's "writes no
  tracking record" is narrowed to exactly that.
- The row shows the state label ALWAYS, and the marker — now "Unsent edits" —
  beside it rather than instead of it.

Unit-tested (`tests/edit-baseline.test.ts`), including a fake whose cached
stat lags the disk, which is the shape the submit race had. **OBSERVED
2026-09-27** on `gitlab.com/styl-group1/kb-docs` (`fix-edited-baseline`
tasks.md §5): a freshly submitted, untouched note is not listed and its
stored baseline equals its disk mtime to the millisecond; a reset note is not
listed; an edit after it lists the row with its state AND "Unsent edits".

Existing records with a stale baseline keep it until that document's next
submit, import or reset (that change's design.md, Migration). A row showing
"Unsent edits" on an untouched note in an upgraded vault is that, not a
regression.

The original finding, kept as the record of what was wrong:

The reason the document APPEARS after Reset, and it is backwards.

- **What happens:** press Reset on a document under review. The note is
  rewritten with the remote's content, so it is now byte-identical to what
  reviewers are reading. The panel then lists it under "Your documents"
  labelled **"Edited — not sent yet"**.
- **Why:** `hasLocalEdits` (`document-status.ts:203`) is
  `file.stat.mtime > record.mtime`. `restoreDocument`
  (`reset-document.ts`) deliberately "writes no tracking record", so the
  write bumps the file's mtime and the baseline stays where the last submit
  left it. Every reset therefore reads as an edit.
- **Why it is the wrong answer specifically:** a reset is the ONE moment the
  note is guaranteed to match the review exactly. The panel asserts the
  opposite, and asserts it about the author's own destructive action, so the
  author is told their discarded work is still pending — inviting them to
  "Send update" a revision that changes nothing.
- **It is also self-clearing in the worst way:** pressing Send update saves a
  new baseline, so the false label disappears after a pointless commit.

**THE SAME CLASS ON THE SUBMIT PATH, observed 2026-09-27 on
`gitlab.com/styl-group1/kb-docs`.** A document submitted 12 seconds earlier,
0 words long, untouched since, was labelled "Edited — not sent yet" in the
panel. Nothing had edited it.

`submitForReview` captures its baseline as `file.stat.mtime` immediately after
the front-matter write, and the comment at `submit-document.ts:650` states the
intent plainly: "Read AFTER any front-matter write above, so the baseline is
the note as it now stands on disk." The intent is right; `TFile.stat` is
Obsidian's CACHED stat and can still hold the pre-write value at that instant,
so the baseline lands one write behind and the note reads as edited from the
moment it is submitted. A suspected race rather than a proven one — it needs
the two values logged either side of the write to confirm — but the observed
symptom is not otherwise explainable on a note nobody touched.

**IT ALSO MASKED EVERY STATE LABEL IN THE LIST — observed 2026-09-27.**
`renderDocumentRow` showed `EDITED_LABEL` *instead of* the state's label, so
with every document reading as edited no row in "Your documents" could display
a state — a document in "Changes requested" still read "Edited — not sent
yet" after a refresh. That rule assumed `edited` was rare; it is now additive
(see the resolution above).

#### D0d. Reset is withheld right after a submit, beside a label that says otherwise

Reported 2026-09-27: "I created test-004, I edited it, but it doesn't show the
Reset button — it only appears when I hit Refresh."

- **Reproduced in the code.** The two sit in the same section and read from
  different sources. `renderSubmitSection` (`main.ts:721`) labels the document
  from `resolveSubmission(file)` — the STORED record, which a submit writes
  immediately. `renderResetAction` (`main.ts:768`) gates on
  `statuses.statusFor(docId)` — the RESOLVED status, which only a refresh
  populates. So between a submit and the next refresh the panel states
  "Waiting for review" and withholds Reset, with nothing said about why.
- **The gate itself is correct and should stay.** Its comment gives the
  reason: a stored state can be left over from a previous session, and
  offering a destructive action off one would act on an answer the remote was
  never asked for. Reset destroys local work; requiring a verified state is
  the right trade.
- **The comment's own justification no longer holds, and that is the defect.**
  It says "A document nothing has resolved yet gets no Reset at all, for the
  same reason its row shows no label." The row does show a label — the
  section directly above prints one from the stored record. So the panel makes
  a confident claim about the state and simultaneously refuses to act on the
  grounds that the state is unverified. Both cannot be right.
- **What it costs the author:** they are told their document is waiting for
  review, offered no way to reset it, and given no hint that Refresh is what
  unlocks it. The remedy exists and is one click away, and nothing points at
  it.

TRIAGE: a panel surface, so its own milestone by decision 5. The fix is a
choice rather than a patch, and whoever takes it should make that choice
explicitly — either the label is held back until the state is resolved, the
same standard the action is held to, or the action accepts the stored record
and the safety argument above is abandoned. A third option, and probably the
cheapest: keep both as they are and say why Reset is absent, since the
author's problem is the silence rather than the gate.

#### D0e. A submit whose remote side succeeded left NO local trace, and the note cannot be reconnected

**AMENDED 2026-09-29 — the ORPHANING is prevented; the ROOT CAUSE is not
diagnosed.** Keep these two apart when reading on. `correct-stale-records`
moved the first submit's `store.save` ahead of `writeSubmissionFrontMatter`
in `openNewCycle`. The edit baseline is filled in afterwards with
`saveEditBaseline`. So if the front-matter write fails once the remote writes
have succeeded, the document is still tracked: the panel lists it,
reconciliation resolves it, and its next submit collects the missing `title`
and `category`, the same way it does for an imported note. That does nothing
about candidate 1 below: if `createMergeRequest` reports failure for a merge
request that was in fact created, the submit still stops before recording
anything. The console reading asked for below is still owed.

**Documents ALREADY orphaned are NOT recovered by this.** Their notes carry
no `doc_id`, so nothing links them to the records they never got. The author
adds the `doc_id` to the front matter by hand, as was done for `test-006`, and
the next refresh reconnects them from that alone. No automatic repair exists.

OBSERVED 2026-09-28 on `gitlab.com/styl-group1/kb-docs`, submitting `test-006`
for the first time. **The most consequential finding of this run so far.**

**What is established, from evidence rather than inference:**

- The remote HAS the work. Branch `doc/test-006` exists and carries an OPEN
  merge request — proven by the second submit attempt, which answered
  `ALREADY_AWAITING_REVIEW_MESSAGE`, and that message fires only when
  `clearPreviousAttempt` finds BOTH a branch and an open merge request
  (`submit-document.ts`).
- The vault has nothing. `data.json` holds `probe-review`, `test-002`,
  `test-003` and `test-004`, and **no `test-006` record at all**.
- The note's front matter was never written: it carries `owner`, `created`,
  `last_reviewed` and `lifecycle` only — no `title`, no `category`, and
  critically **no `doc_id`**.

**Why the missing `doc_id` is what makes this bad.** Every route back to a
document goes through it. `listVaultDocuments` only collects notes that carry
one, so the note is invisible to the panel, to reconciliation and to the
restore list. The remote holds an open review that this vault cannot see, and
nothing in the plugin will ever reconnect them. This is not a state the author
can get out of from the UI.

**And the refusal message sends them the wrong way.** It opens "If that's this
document, there's nothing more to do." In this exact case there IS something
more to do — the note is orphaned and stopping leaves it so. The sentence was
written for a genuinely ambiguous collision (a stranger's document holding the
derived branch name) and reads as reassurance in a case where it is wrong.

**ROOT CAUSE NOT YET ESTABLISHED.** Everything after `createMergeRequest`
returned failed to run: no front-matter write, no `store.save`. Candidates,
in order of likelihood:
1. `createMergeRequest` returned `{ok: false}` despite the merge request being
   created — `post` answers `unexpected` if the response body will not parse,
   and the caller then aborts having already written to the remote.
2. `writeSubmissionFrontMatter` threw, which would also skip the record save
   that follows it.
3. Something between them.
The developer console distinguishes these: every classified failure is logged
there with its URL and status. NOT YET READ — record it here when it is.

**Not caused by `fix-edited-baseline`**, which was the first suspicion.
`captureEditBaseline` catches everything and returns `undefined`; it cannot
throw and cannot abort the save it sits inside.

**A SECOND CONSEQUENCE, observed 2026-09-28 after the note was reconnected by
hand.** `test-006` was given a `doc_id` manually, reconciliation reattached it
to its open merge request, and it read "Waiting for review" correctly. It then
proved UNABLE TO REPORT LOCAL EDITS: text was typed into it, the panel was
refreshed, and it stayed under "Waiting on reviewers" with no "Unsent edits"
marker.

That is correct behaviour following from the failure, not a second defect.
The baseline is written by a SUCCESSFUL submit; this document never had one.
Reconciliation rebuilds a record carrying `mtime: stored?.mtime`
(`reconcile.ts`), and with no stored record there was nothing to carry, so the
baseline is `undefined` — which `hasLocalEdits` reads as not edited, by the
deliberate rule that stops a fresh install marking every document at once.

The chain is what matters for triage: ONE failed submit leaves a document that
(a) the remote holds a review for, (b) the vault cannot see at all until a
`doc_id` is added by hand, and (c) silently cannot report local edits even
after that, until its next successful submit. Each link is individually
defensible and the accumulation is not.

**SEVERITY BOUNDED, 2026-09-28: the normal path is NOT broken.** The worry
this raised was that no submit completes its local half, which would have made
it a release blocker rather than a milestone. It does not: `test-009`
submitted in the same session, carries full front matter (`title`, `category`,
`doc_id`) and a working baseline — it reported "Unsent edits" beside its state
when edited, which requires a baseline a successful submit wrote. So submits
DO complete normally, and `test-006` was an exception rather than the rule.
What triggered it is still unknown, and an intermittent failure on a write
path is not a smaller problem than a consistent one — only a differently
shaped one. It remains a milestone; it is not a blocker.

TRIAGE: this touches a write path, so its own milestone by decision 5 — and it
is the one that should be built first. `fix-interrupted-submit` exists to make
exactly this recoverable, and this case escapes it: that change handles an
abandoned branch with NO open merge request, which it deletes. A branch WITH
one, and no local `doc_id`, is the gap.

#### D0f. ~~A document whose note was deleted is stuck in "Documents you can restore" forever~~ — FIXED AND OBSERVED 2026-09-29

**OBSERVED REPAIRING EXISTING DAMAGE, not merely preventing new** — the
distinction `correct-stale-records` tasks.md 5.3 exists to draw, since a fix
that only stops fresh cases leaves every already-affected vault broken.

`test-020` was submitted, its merge request merged, and its note deleted, with
NO refresh in between — leaving `data.json` holding `"state": "pending"` for a
document whose review was over and whose note was gone, which is exactly the
record a pre-fix vault carried. The plugin was then reloaded, so the stale
record was LOADED FROM DISK at startup rather than having gone stale in a live
session.

The refresh that runs on the panel opening corrected it unprompted:
`data.json` afterwards reads `"state": "published"`, and the document left
"Documents you can restore" for "Documents you can import". `probe-test-02`
and `probe-test-03` were corrected in the same pass — to `published` and
`closed` respectively — so the repair covers the set rather than one row.

The record on disk is the assertion worth keeping. A row can leave a list for
several reasons; a corrected state in `data.json` can only come from
reconciliation having actually asked the remote about a document with no note
in the vault, which is the thing that was never happening.

**FIXED by `correct-stale-records`.** `refreshDocumentStatuses` now reconciles
the union of the vault's `doc_id`s and every stored record's, against the
same single listing. A record with no note is therefore corrected when its
review ends, and it leaves the restore list by itself. `writeBack` still
carries `path` and `mtime` forward, so a correction does not stop a later
Restore from working. The panel now runs the Discover refresh AFTER
reconciliation rather than beside it. Run side by side, Discover read the
restore set before it was corrected, and the document would only have
appeared for import on a second Refresh. Records that are already stale in an
existing vault are repaired by the first refresh after this change. The
change's tasks.md §5 is the in-vault observation still owed.

OBSERVED 2026-09-29 on `gitlab.com/styl-group1/kb-docs`. `test-017` was
submitted, its note and image deleted from the vault, and its merge request
!32 then MERGED (commit `43e2242d`, source branch deleted). After a refresh it
was **still listed under "Documents you can restore"**, and "Documents you can
import" read "Nothing to import" — so the document appears on the surface that
can no longer act on it, and is absent from the one that can.

**The chain, all three links confirmed in code:**

1. `refreshDocumentStatuses` reconciles `listVaultDocuments(app)` — notes
   PRESENT in the vault. A document whose note was deleted is never asked
   about, so its stored `state` stays `pending` for the life of the vault,
   whatever the remote does.
2. `restorableDocuments` is deliberately PURELY LOCAL — it reads the store to
   avoid one request per record — and filters on `state === 'pending' ||
   'changes-requested'`. Fed a state that can never be updated, it keeps
   offering the row.
3. `discoveryCandidates` then EXCLUDES whatever Restore offers, by design, so
   one document never appears on two surfaces
   (`discover.ts`, 2026-09-22). The stale restore entry therefore SUPPRESSES
   the import entry.

**The design's own claim is what fails.** `reset.ts` states the list is
self-emptying: "Every document here leaves on its own: the review ends and it
becomes published (Discover covers it) or not accepted (it drops out
entirely)." Both exits depend on the record's state being updated when the
review ends — and step 1 is exactly why it never is, for precisely the
documents on this list. The list can only empty itself for a document whose
note is in the vault, and a note in the vault is what disqualifies it.

**Consequence, which is annoyance rather than damage.** The row persists;
pressing Restore reads the merge request's branch, which the merge deleted,
and answers "This document's review has already finished, so nothing was
reset." So the author is offered an action that always refuses, on a document
they could otherwise simply import. Nothing is lost and nothing is written.

**It also blocks §E6.** The import path cannot be exercised on any document
that took this route, which is the natural way to set the check up.
Workaround for the run: import a document whose note was never deleted while
under review, or clear the stale record from `data.json` by hand.
(No longer needed as of 2026-09-29; see the status above.)

TRIAGE: touches a data shape and two panel surfaces, so its own milestone by
decision 5. The fix is a design choice — reconcile records that have no note,
or have Restore consult the remote, or have Discover stop deferring to a
Restore entry it can see is settled — and each has a cost the 2026-09-22
narrowing was explicitly avoiding. Worth pairing with D0e, which is the other
half of the same theme: a record whose state nothing will ever correct.

#### D0g. The connection check discards the permission name it is handed

OBSERVED 2026-09-29 on `gitlab.com/styl-group1/kb-docs`, with a token holding
`Project: Read` and nothing else. The panel replaced its whole document list
with:

> That project could not be found, or your access does not include it. Check
> your details in settings.

**The project was fine.** What was refused was `GET /user`, with
`403 … [User: Read]` — the same named body §B2 confirmed. The author is sent
to check a project path that is correct, for a problem that is a missing
checkbox on the token's User tab, and the instance told the plugin exactly
which one.

**Why the name is lost, by construction.** The connection check goes through
`getRaw` with `classifyStatus`, which folds **403 and 404 alike into
`not-reachable`** — deliberately, so an invisible project and a missing one
read the same rather than leaking which. The detail extraction then runs only
`if (failure === 'insufficient-permission')`, and `classifyStatus` can never
produce that kind. So `extractPermissionDetail` is never called on this path,
and a body that names the permission is thrown away before anyone looks.

That fold was a reasonable decision when it was made. It predates knowing that
fine-grained tokens answer with a NAMED permission — §B2 was the assumption
this project already got wrong once, and it was only confirmed on the target
2026-09-22. The conflation is now costing something it did not cost then.

**Consequence.** The single most likely first-run failure — an author who
ticked the project permissions and missed `User: Read`, which is on a separate
tab and which §A2.10 flags as the easy one to miss — produces a message
pointing at the wrong thing. "Test connection" is where a new author meets the
plugin, and this is what it says when their token is one checkbox short.

**FIXED 2026-09-29, inside this change.** Triaged in
`openspec/changes/archive/2026-09-29-verify-against-target-instance/triage.md`: it qualifies for
decision 5's "fix here" list twice over — as a message naming the wrong remedy
AND as a wrong permission classification — so neither reading puts it in a
milestone.

The fix keeps the fold where it earns its place and removes it where it does
not. `getCurrentUser` now classifies through `classifyScopedStatus`, so its
403 becomes `insufficient-permission` and the named permission is extracted;
`getProjectAccess` is untouched and still folds 403 into `not-reachable`,
because a project's existence IS something the plugin must not leak. The name
is carried on `ConnectionState`'s `failed` variant — session-only, never
persisted — and both the settings tab and the panel now say *"Your access
token doesn't have permission to check your connection (missing: User: Read).
Ask your admin to add it."*, dropping the parenthetical when no name came back
rather than inventing one.
Covered by `plugin/tests/identity-permission.test.ts`, which also pins the
401 path so the expiry message (§D6a) cannot be disturbed by the
reclassification.

**CONFIRMED IN THE RUNNING PLUGIN 2026-09-29**, after a rebuild and reinstall.
With a token holding `Project: Read` and nothing else, the panel now reads:

> Your access token doesn't have permission to check your connection (missing:
> User: Read). Ask your admin to add it, then check your details in settings.

The name GitLab reported reaches the author. Note the pairing this completes:
§8's settings copy warns that `User: Read` "is on the separate User tab, and is
easy to miss", and the failure an author hits when they miss it now names that
same permission. The warning and the error agree, which is what makes either
of them worth having.

#### D0h. ~~Switching projects leaves every document wearing the old project's state, and offering actions against it~~ — FIXED 2026-09-29

**FIXED by `scope-records-to-their-project`.** A record now carries the project
it was written against: the host plus the canonical numeric id from
`GET /projects/:id`, so the same project configured by id or by path is one
project. It is stamped only on evidence: a submit or import that just wrote
there, or a reconciliation that matched its `doc_id` there. The stored-state
fallback is taken only for a record belonging to the configured project
(`effectiveState`), and the row, the section split, the open note's label and
button, Restore and Discover's exclusion all read that one rule. A record
naming another project, with nothing here, reads "In another project" and
offers only a first submission into the configured project. An unstamped
record gets no label at all.

The feared write path turned out narrower than the entry below supposed.
`performResubmit` resolves the document against the CONFIGURED project and
never reads the stored `mrIid`, so pressing the old "Send update" would have
opened a fresh review in the new project, not written to the old one. It was
still wrong to offer, because the label promised an update to a review that
does not exist there.

OBSERVED 2026-09-29 in the author's vault (change tasks.md 4.2, 5.3):
- Stamps stripped from all 19 records: one Refresh restored them, `data.json`
  was byte-identical to the pre-strip copy, and the panel was unchanged.
- A record hand-stamped with another project survived a Refresh forced to
  write, and was not taken over by the match here.

The window before that first Refresh is not bounded by the refresh: nothing
refreshes when a connection is verified, so it lasts until the author presses
Refresh. The project-switch run itself (tasks.md 5.1, 5.2) is ticked in the
change without an observation written down, and "In another project" has not
yet been seen in the running panel.

NOT FIXED here, and still reachable: records of documents imported before this
change can never be stamped (no merge request to match), so they lose
"Published" and sit unlabelled under "Needs you" (`test-1`, `test-123`).

OBSERVED 2026-09-29. The plugin was pointed from `gitlab.com/styl-group1/kb-docs`
at the office instance. The panel connected to the new project — it reports
"Maintainer access" and "Documents you can import 91", both of which are the
office project — and yet `test-002`, `test-003`, `test-004`, `test-008`,
`test-006` and `test-009` all still showed the states they held on the OLD one:
"Changes requested", "Waiting for review". `test-002`'s action button read
"Send update".

**The 2026-09-20 guard fires and is then undone.** Editing the project id sets
the connection `unverified`, which clears the held states — that part works, and
was added for exactly this. But the next successful refresh resolves each vault
`doc_id` against the NEW project, finds no merge request for any of them, and
returns `submission: null`. The row then falls back:

```ts
const state = status.submission?.state ?? stored?.state;
```

and `stored?.state` is the old project's answer. The clear is real; the fallback
resurrects what it cleared.

**The fallback is not wrong — it is ambiguous.** It exists so an IMPORTED
document reads as published: such a document sits on the default branch with no
merge request, so the store is the only thing that knows its state. "No merge
request found for this `doc_id`" is the same observation in both cases, and the
record alone cannot say whether it means "imported here" or "belongs to a
project we are no longer pointed at".

**`writeBack` then preserves the staleness.** It `continue`s past every entry
whose `submission` is null, so the old records are never corrected or removed —
they simply stay, describing merge requests in a project the plugin is no longer
connected to.

**THE ACTION IS THE PART THAT WORRIES ME, and it is unverified.** The resubmit
button reads its label from the stored record directly
(`renderSubmitSection` → `resolveSubmission(file)`), with no reference to the
resolved status, which is why it says "Send update". That record carries a
`branch` and an `mrIid` belonging to the other project. What pressing it does
against the new project has NOT been tested and should not be tested casually —
it is a write path. The 2026-09-20 note records the same shape of problem as
"the old project's documents with live Recover buttons beside them", which is
what that fix was for; this is the same hazard reached by a different route.

TRIAGE: a write path and a panel surface, so its own milestone by decision 5.
It belongs with `correct-stale-records`, whose theme it shares exactly — a
record nothing corrects, presented as current. Note it is NOT fixed by that
change as proposed: widening reconciliation's scope corrects records the new
project knows about, and these are records it has never heard of.

#### D0c. The Reset confirmation takes ~3 seconds to appear

- **What happens:** press Reset; nothing visibly happens for about three
  seconds; then the confirmation dialog appears.
- **Why:** `resetDocument` (`main.ts:1506`) awaits `fetchResetContent` BEFORE
  calling `restoreDocument`, and the confirmation lives inside the latter. So
  two sequential round trips — the merge request's changed path, then the raw
  file — run before anything is drawn. On this self-managed instance that is
  the three seconds.
- **Not a correctness fault.** Fetching first is what lets the reset refuse
  cleanly when the review has ended, and the confirmation is inside
  `restoreDocument` on purpose so that no route to the overwrite can skip it.
  Neither should be rearranged to make the dialog faster.
- **What it is:** a control with no busy state, on the plugin's only
  destructive action, where a second press during the dead window is a
  plausible thing for an author to do.

TRIAGE: a panel surface, so its own milestone by decision 5 — but a cheap one
with a pattern already in the codebase. Refresh already swaps its label to
`CHECKING_LABEL` while it works; Reset can do the same and nothing about the
fetch order or the confirmation needs to move.

### D1. The fix itself

Open the panel. Each document carries the right label, and in particular the
published one **no longer reads "Waiting for review"** — that single wrong
sentence, shown forever for every document ever submitted, is the bug this
whole milestone existed to fix.

TEXT CORRECTED 2026-09-27. This item said "all three documents are listed",
which was true of the panel it was written for and is not true of the panel
now: settled work is deliberately not listed at all. What the item is FOR
survives that change — the published document must not be described wrongly —
so the check is now "carries the right label, or is correctly absent", not
"is listed".

- [x] **Passes, on the substance.** OBSERVED 2026-09-27 on
      `gitlab.com/styl-group1/kb-docs`, with one document taken to each state.
      `test-003`, closed without merging, read **"Not accepted"** and sat in
      "Needs you" — correct on both counts, since a turned-down document is
      owed a decision by its author and by nobody else.
      `probe-review`, open, read **"Waiting for review"** under "Waiting on
      reviewers".
      `test-002`, merged, was **absent from every section** — no label at all,
      and in particular not "Waiting for review". The bug this milestone
      existed to fix does not occur.
      CONFIRMED NOT A SILENT FAILURE: opening `test-002` showed its state line
      reading **"Published"**, so it resolved correctly and was hidden
      deliberately. The distinction had to be checked by opening the note,
      which is the cost recorded below.

      **AND IT SURFACES THE SPEC DRIFT, concretely.** `specs/plugin-shell`
      still states the panel SHALL list every note carrying a `doc_id` and
      that narrowing SHALL NOT remove any document from view. A published,
      untouched document is now removed from view entirely. The code is
      deliberate and the spec is stale — the 2026-09-22 narrowing shipped
      without a change or a delta — but until that is reconciled, this item
      passes against the code and fails against the spec, and no reader can
      tell which is authoritative.

      **A cost of hiding settled work, worth stating while it is visible:**
      absence is now load-bearing. A document that is published reads as
      absent, and so does one that failed to resolve for any other reason.
      The panel offers no way to tell those apart from the list, so
      confirming a specific document's state means opening it and reading the
      line under Reset.

### D2. Changes requested, and back again

Leave an unresolved review thread on the open document's merge request.
Refresh → it reads **"Changes requested"**. Resolve the thread. Refresh → it
returns to **"Waiting for review"**.

Both halves matter. A mechanism that can enter the state but never leave it is
worse than one that never enters it. This is also the end-to-end check for B5.

- [x] **Enters the state.** OBSERVED 2026-09-27 on
      `gitlab.com/styl-group1/kb-docs` (SaaS/EE), merge request !26. A
      published diff-line thread moved the active document's state line from
      "Waiting for review" to **"Changes requested"** on Refresh — a real round
      trip, since the store held `pending` beforehand.
- [x] **Returns from it.** Resolving the thread and refreshing returned it to
      **"Waiting for review"**. This half had never been run on any instance
      (see §D8's changes-requested row, which records it as owed), so until now
      a mechanism that was genuinely STUCK would have looked identical to one
      that was correct. It is not stuck.
      PLUGIN LOGIC, so this transfers; the underlying response shape is EE and
      §B5 records the CE re-read still owed.
      Both halves above were read from the active-note line under Reset,
      because at the time the row in "Your documents" suppressed the state
      label (§D0b). Fixed 2026-09-27; the row now shows the state beside any
      "Unsent edits" marker.

### D3. Reconciles with no local state at all

Delete `data.json`, reload the plugin, open the panel and refresh. Every
document still resolves to its correct state, from front matter alone.

This is the case that proves the remote is the source of truth rather than a
place the plugin happens to write to — and it is the same case as a note
pulled onto a second machine, a vault restored from backup, or a plugin
reinstall.

- [x] **Passes.** OBSERVED 2026-09-27 on `gitlab.com/styl-group1/kb-docs`.
      `data.json` deleted outright, plugin reloaded, Refresh. All three
      tracked documents — `probe-review`, `test-002`, `test-003` — resolved to
      **"Waiting for review"** from front-matter `doc_id` alone, with no
      stored record of any kind to start from.
      TWO THINGS CONFIRMED INCIDENTALLY, both worth more than the check
      itself:
      **The absent-baseline rule works.** `probe-review` carried unsaved local
      text throughout and stopped showing "Unsent edits" the moment its record
      was gone. That is `hasLocalEdits` reading a missing baseline as NOT
      edited — the load-bearing default that stops a fresh install marking
      every document the author has ever published as edited at once. It had
      never been exercised on a vault that actually had none.
      **The second empty state is reachable.** "Needs you" showed "Nothing
      needs you right now" rather than the never-submitted message, because
      documents existed but none owed the author anything. That is half of
      §D9's "the two empty states are told apart" check, obtained free.
      PLUGIN LOGIC, so it transfers to CE.

### D4. Self-healing

Hand-edit `data.json` to set a published document's state back to `pending`.
**Reload the plugin** — see below, this step is not optional. Refresh. The
panel shows **"Published"** and the stored record is corrected on disk.

STEP ADDED 2026-09-27, after the check was run without it and proved nothing.
`SubmissionStore.load()` reads `data.json` ONCE, at plugin startup, and holds
the records in memory from then on. A hand edit made while the plugin is
running is therefore invisible to it, and the next `saveData` overwrites the
edited file with the in-memory copy — so the check appears to pass while
having tested nothing, and the evidence of the edit is destroyed. Reload the
plugin (Settings → Community plugins → toggle off and on) so the edited file
is what gets loaded, THEN refresh.

Note this is not a defect. Reading the file on every access would be a disk
read per lookup on a surface that re-renders constantly, and nothing but a
human with a text editor writes that file behind the plugin's back. It is a
property of how the check must be RUN, which is why it belongs here.

This also covers the narrow case the interrupted-submit change left open: a
submission whose remote calls succeeded but whose local record failed to save.

- [x] **Panel shows the right state.** OBSERVED 2026-09-27 on
      `gitlab.com/styl-group1/kb-docs`. `probe-review`'s stored record was
      hand-edited to `"state": "published"` while its merge request was open;
      after a plugin reload and a Refresh the panel read **"Waiting for
      review"**. The remote won over the stored value, which is the whole
      claim — plugin data is the cache, not the source of truth.
- [x] **`data.json` was corrected.** The record on disk was rewritten from
      `"published"` back to `"pending"`. This is the half that matters: a
      panel showing the right state proves only that the remote was read,
      whereas the file being rewritten proves the plugin treats its own store
      as something the remote overwrites.
      Also covers the case interrupted-submit left open — a submission whose
      remote calls succeeded but whose local record failed to save.
      PLUGIN LOGIC, so it transfers to CE.

### D5. No request on edit

With the panel open and the network tab or console watching, type in a note
and edit its front matter. The panel redraws and **no request is made**.

The panel re-renders on `file-open`, on `active-leaf-change` and on every
`metadataCache` change. Wiring the remote read into the render path is the
natural-looking mistake, and it would put a request behind every keystroke
that touches front matter. Statically, `main.ts` imports only *types* from
`gitlab-client.ts`, so no render path can reach the network — but that is an
argument, and this is the observation.

- [x] **Passes.** OBSERVED 2026-09-27 on `gitlab.com/styl-group1/kb-docs`,
      with the developer console's Network tab recording and cleared first.
      Typed into the note's body and edited a front-matter field
      (`category`). The panel redrew both times and **no request was made** —
      the Network tab stayed empty throughout.
      This is the observation the static argument could not supply: `main.ts`
      imports only TYPES from `gitlab-client.ts`, so no render path CAN reach
      the network, but that is a claim about the import graph rather than
      about what the running plugin does on a keystroke.
      PLUGIN LOGIC, so it transfers to CE unchanged — nothing here depends on
      which instance is configured, or on any request being answered.

### D6a. Token expiry surfaces as expired access, pointing at settings

The check `openspec/config.yaml`'s milestone 2 owed and that §0 recorded as
possibly unrunnable without waiting for a real expiry.

- [x] **PASSES — OBSERVED 2026-09-29** on `gitlab.com/styl-group1/kb-docs`.
      With an invalid token in the settings tab, the panel replaced its
      contents with *"Your access has expired or is incorrect. Ask your admin
      to set it up again."* and an **Open settings** button. Message and route
      out, both as milestone 2 specifies.

**WHY AN INVALID TOKEN IS A SOUND SUBSTITUTE, and not a shortcut.** §0's open
question asked whether this could be exercised without waiting for a real
expiry, and settled for a revoked token. An invalid one is a step further
removed, so the justification has to come from the code rather than from
convenience: `rejected-credential` is produced by **status 401 alone**, in
both `classifyStatus` and `classifyScopedStatus`. Nothing anywhere inspects
WHY the credential was rejected. Expired, revoked and malformed are
indistinguishable to this plugin by construction, so all three exercise the
identical path — and the cheapest of them is the one to use.
That closes §0's open question: no waiting, and nothing to revoke or restore.

### D6. A failed refresh

Break the connection — a wrong host, or revoke `Merge Request: Read` — and
refresh.

- [x] **The author is told the refresh did not succeed.** OBSERVED 2026-09-29
      on `gitlab.com/styl-group1/kb-docs` with a token holding `User: Read`
      and `Project: Read` only. Both remote-backed sections carried
      "(check failed)" on their headings, and the failure was stated in
      words rather than left to an empty list.
- [x] **A permission refusal names the permission.** The panel said:
      *"Your access token doesn't have permission to check your documents'
      status (missing: Merge Request: Read). Ask your admin to add it."*
      and, separately, *"…to list the project's documents (missing:
      Repository: Read)…"*. Two different reads, each naming its own
      permission, each actionable without reading a console.
      This had never been seen in the panel on ANY instance. It is §B2's
      whole payoff reaching the surface it was for, and it contrasts sharply
      with §D0g, where the connection check is handed the same named body and
      discards it.
- [~] **The list keeps its states rather than blanking.** PARTIAL, and the
      run could not answer it properly. The documents stayed listed —
      `test-003`, `test-004` and `test-008` were all still there — so the
      list did not blank. But they showed NO state labels, because nothing
      had resolved them in that session: the token was swapped and the plugin
      reloaded, so the status holder was empty and the first refresh with the
      new token was the one that failed. There were no "last known states" to
      keep.
      SECOND ATTEMPT 2026-09-29 was ALSO invalid, for the same reason, and it
      is worth naming so a third is not wasted: the "before" panel showed no
      state labels and "Not checked yet" under the import section, so no
      successful refresh had COMPLETED before the token was swapped. Pressing
      Refresh is not enough; the labels have to appear first.
      Why the labels are the tell: `renderDocumentRow` gates the state label
      on `statusFor(docId) !== null`, and that map is filled only by a
      successful refresh IN THE RUNNING SESSION. After a plugin reload there
      are no last-known states at all — the rows still render and still
      partition, because both read the STORED record, but no label appears.
      So an invalid baseline looks exactly like a successful "kept its
      states" result, which is the trap.
      MECHANISM CONFIRMED IN CODE meanwhile: `recordFailure` sets only
      `outcome` and never touches `statuses` — "A failed refresh deliberately
      leaves the states alone." So the property holds by construction; what is
      missing is the observation.
      **THIRD ATTEMPT 2026-09-29 EXPOSED WHY ALL OF THEM FAILED, and it is not
      what the first two notes assumed.** The baseline was good that time —
      rows carried labels, the import section showed a count — and the labels
      were still gone after the swap.
      The cause is not the refresh. `main.ts` clears the resolved states
      whenever the connection state becomes `unverified`, and `discardResult()`
      sets `unverified` on EVERY KEYSTROKE in any settings field, the token box
      included. So pasting a different token wipes the states before a refresh
      is even attempted. That is the deliberate rule added 2026-09-20 — editing
      the project id used to leave the old project's documents listed with live
      actions beside them — and an edited token is indistinguishable from an
      edited project.
      **SWAPPING TOKENS IN THE SETTINGS TAB THEREFORE CANNOT TEST THIS ITEM.**
      The two preceding notes are correct about their own runs and wrong about
      the remedy.
      RUN IT THIS WAY INSTEAD — break the credential on GITLAB'S side and never
      touch the settings tab: (1) real token, Refresh, wait for labels; (2) in
      GitLab, edit that same token to remove `Merge Request: Read`, or revoke
      it; (3) back in Obsidian, touching nothing in settings, press Refresh.
      The states should survive, because `recordFailure` sets only `outcome`.
      That sequence is also the REALISTIC one: an author whose token is revoked
      or narrowed by an admin mid-session changes nothing locally, which is
      exactly the case this item exists for.
      **PINNED AS A UNIT TEST INSTEAD, 2026-09-29** —
      `plugin/tests/states-survive-failure.test.ts`. After three attempts to
      observe it through the settings tab, the honest conclusion is that the
      settings tab cannot measure it: the only thing standing between the two
      refreshes there is a `clear()` that fires on the paste. The test puts
      nothing between them but the failure.
      It covers: states kept across a failure; the outcome still reporting the
      failure AND the permission that caused it, because keeping a stale
      answer is only defensible while the author is told it may have moved on;
      every document kept rather than only the one looked at; survival across
      CONSECUTIVE failures, since a narrowed token is an afternoon of them;
      wholesale replacement on success, because a document absent from a
      successful listing is absent; and `clear()` still dropping everything,
      which is the distinction the whole item turns on — a failed refresh asks
      the same project and gets no answer, while `clear()` is the panel being
      pointed somewhere else.
      WHAT THE TEST DOES NOT COVER, and what a manual run would still add: that
      the panel RENDERS what the holder kept. That follows from
      `renderDocumentRow` gating its label on `statusFor(docId) !== null`, and
      is worth one look if the GitLab-side procedure above is ever convenient —
      but it is no longer what this item is waiting on. That is the case the check means — a refresh that fails
      after states were known — and the one that matters, since it is what an
      author hits when a token is revoked mid-session.
- [ ] Original wording, for the re-run: "A permission refusal names the
      permission: "Your access token doesn't
      have permission to check your documents' status (missing: …)".

The third depends on B2. If the parenthetical is missing, check B2's body
shape before assuming the panel is at fault.

### D7. Recovery, end to end

Added by add-document-recovery. tasks.md 6.2-6.7 are the authoritative
observable checks for this change; this entry exists so this file's own
end-to-end section does not go silent about it. Run them here against the
real target instance rather than only wherever they were first exercised, and
record which of B7/A6/A7 above they end up confirming.

- [x] **Passes, against this instance** — 2026-09-27 on
      `gitlab.com/styl-group1/kb-docs`, `test-004` (merge request !29).
      Its note was deleted while the review was open, the panel offered
      Restore, and one press recreated it: *"This document is back in your
      vault."*
      **The path came from the merge request, not from anywhere local.** The
      note landed at `probe/test-004.md` — the folder it was submitted from —
      rather than at the vault root. That is `docs/document-identity.md` §4's
      rule working on the path that most needs it, since the vault had no note
      to take a path from.
      Front matter intact, all seven fields; body empty, matching the remote;
      the row left "Documents you can restore", which returned to 0 and its
      "Nothing to restore" empty state.
      **No "Unsent edits" on the restored note**, which is the create path of
      `fix-edited-baseline` working — a restored note has a baseline from the
      moment it exists, so it does not read as locally edited.
      WHICH READS IT EXERCISED, per this item's own request: the restore
      succeeded, so `A7` (the merge-request changes read, used to find the
      path) and `A6` (the raw content read) both worked on this instance for
      a document whose note was absent. Neither was refused, so neither names
      a permission here — §A2.10 already has both.
      **IMAGES NOT COVERED.** `test-004` embeds none, so this exercised the
      text path only. Milestone 9a's attachment fetch on the create path is
      still owed a run with a document that carries an image.
      D0d VISIBLE AGAIN, incidentally: the restored document showed "Waiting
      for review" and offered no Reset, because a restore does not resolve a
      state. Same inconsistency recorded there, on a second path.

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
      **RE-CONFIRMED 2026-09-28 from the API** on `gitlab.com` merge request
      !18 (`test-009`): Send update took `commits` from 1 to 2, adding
      `c02e6b05 Update test/test-009.md`, with the SAME `iid`, one changed
      file, and no second merge request. `unresolved=0`, so it stayed
      "waiting for review". In the panel the "Unsent edits" marker cleared,
      which is the baseline being rewritten by a successful submit —
      `fix-edited-baseline` working on the revision path as well as the
      first-submit one.
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
      **PUSH HALF RE-CONFIRMED 2026-09-28** on `gitlab.com` merge request !29
      (`test-004`), this time read from the API rather than off the screen:
      before Send update, `commits=1` (`f8f00b39 Add probe/test-004.md`);
      after, `commits=2` with `4bae2010 Update probe/test-004.md` added. Same
      `iid`, one changed file, and **no second merge request opened**. The
      commit verb is right on both — `Add` for the original, `Update` for the
      revision.
      `unresolved=1` throughout, so the document still read "Changes
      requested" afterwards, which is correct rather than stuck.
      READ THE `created` LINE CAREFULLY on a run like this: the changed-files
      entry still says `created probe/test-004.md`, and that is right. It is
      the merge request's CUMULATIVE diff against the default branch, where
      this file does not exist — so the net effect of the whole review remains
      "creates this file" however many revisions it takes. §B3's bug is the
      different case of resubmitting a PUBLISHED document, whose file IS on
      the default branch and must therefore be modified.
      NO LONGER OWED — done 2026-09-27 on `gitlab.com` merge request !26 and
      recorded in §D2 above: resolving the thread and refreshing returned the
      document to "Waiting for review". The concern this line raised, that a
      merely STUCK state would look identical to a correct one, is answered.
      It is not stuck.
      Also observed, and it belongs to §9's fix rather than here: !15's diff
      showed `- title: "test-008"` → `+ title: test-008-03`, so the
      committed file carries the same title as the note. The one-revision
      lag is gone, visibly.
- [x] **Published** — a fresh branch is cut from the current default branch,
      the file is UPDATED rather than created (this is the bug the change
      fixed — `docs/resubmission-lifecycle.md` §2), a new review opens, and
      the author is told "Waiting for review".
      **RE-CONFIRMED 2026-09-28 on `gitlab.com/styl-group1/kb-docs` from the
      API rather than by reading a diff**, which is the evidence this row
      always wanted. `test-002` was published on merge request !27; Submit a
      new version produced merge request **!30** — a new review, not a reopened
      one — carrying a single commit `1c1429f6 Update probe/test-002.md`, and:

          changed files=1
            updated probe/test-002.md

      `updated`, on a file that IS on the default branch. The hardcoded
      commit-action bug does not occur. `discussions=0`, so the document reads
      "waiting for review", and the branch name `doc/test-002` was reused
      cleanly after the earlier one was merged and deleted.
      This is the check the whole resubmission milestone exists for: a
      published document is revivable only if its next cycle MODIFIES the file
      the last cycle published.
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
      **BOTH NOW OBSERVED DIRECTLY, 2026-09-28** on
      `gitlab.com/styl-group1/kb-docs`, which is exactly what that sentence
      asked for. `test-003` was closed unmerged on !28; Submit again produced
      merge request **!31**, read through the API rather than inferred:

          commits=1
            2244a90b Add probe/test-003.md
          changed files=1
            created probe/test-003.md

      (1) The commit verb is `Add`/`created`, READ rather than deduced from
      GitLab's refusal behaviour. (2) The abandoned branch really was deleted:
      !31's source branch is `doc/test-003`, the same name the closed cycle
      held, and GitLab refuses to create a branch that already exists.
      !28 stayed closed throughout, so the new cycle is a new review and never
      a reopening, per `docs/document-identity.md` §5.
      The 2026-09-12 inferences were correct. Recording THAT is worth as much
      as the observation: it means the reasoning behind them can be trusted
      the next time a check has to be deduced rather than run.

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

### D9. Reset and Restore, and the panel's sections

Added by add-reset-and-panel-scope (its tasks.md 6.1-6.5), recorded HERE for
the same reason D8 is: they can only be run against a real instance, and this
file is where that evidence lives. NOT RUN AS OF 2026-09-13 — the change
shipped with its code paths reasoned through and its build clean, and
everything below still owed.

**TEXT CORRECTED 2026-09-22, against the panel as it now is — not run.** The
partition bullets below described a panel with a second list, "Other
documents", holding published and not-accepted documents. That list no longer
exists: "Your documents" now means work owed (`needsAuthor`), settled
documents are listed nowhere, and the restore list covers documents under
review only. See `docs/panel-tracking-scope.md`. Nothing is being
un-confirmed here — these checks were never run — but running the old wording
would have looked for a section that is gone and read its absence as a bug.

Reset is the plugin's only destructive local write, so treat an unexpected
result here as blocking rather than cosmetic.

- [~] **Reset restores exactly.** PARTIALLY OBSERVED 2026-09-27 on
      `gitlab.com/styl-group1/kb-docs`, merge request !29 (`test-004`).
      Edited the note, pressed Reset, confirmed. The author was told *"This
      note now matches the version under review."*, the document moved back
      to "Waiting on reviewers", and **the "Unsent edits" marker cleared** —
      which is `fix-edited-baseline` working on the path that caused it: the
      baseline was refreshed by the reset, so the note stopped reading as
      edited without anything being submitted.
      FRONT MATTER MATCHES AT FIELD LEVEL: the committed file carries exactly
      `owner`, `created`, `last_reviewed`, `lifecycle`, `title`, `category`,
      `doc_id` and the note carried the same seven with the same values. No
      field was added, dropped or altered, so nothing was re-asserted.
      **NOT YET CONFIRMED BYTE FOR BYTE**, which is what this check actually
      asks for and the screenshots cannot answer. The committed front matter
      quotes one value (`title: "test-004"`) and leaves another bare
      (`doc_id: test-004`); a write that re-serialized the block would likely
      normalize that, and a field-level comparison would not notice. Settle it
      by comparing the note file on disk against the raw remote content, not
      by reading the properties panel, which renders rather than shows the
      bytes.
      ORIGINAL INSTRUCTIONS: Edit a note whose document is **awaiting
      review**, press Reset, confirm. The note afterwards matches what the
      document carries on its own tracked branch **byte for byte, front
      matter included**. Repeat with a document in **changes requested**.
      If the front matter differs at all, the write is re-asserting fields it
      must not touch — see `openspec/config.yaml`'s front matter contract.
- [x] **Dismissing writes nothing.** VERIFIED IN CODE 2026-09-27, which is a
      stronger result here than clicking would be, and is why this was not run
      by hand.
      `ResetConfirmModal` (`reset-document.ts`) initialises `confirmed = false`
      and sets it true in exactly ONE place — the Reset button's own click
      handler. The promise settles in `onClose`, which Obsidian calls for every
      exit: Cancel, Escape, the close button, clicking away, and the Reset
      press itself. So dismissal does not "also" answer false; false is what
      the modal answers unless one specific line has run.
      Pressing each of the four dismissal routes samples four paths and shows
      they did not write. Reading the modal shows there is only one path that
      CAN write, which is the property the NO CI PIPELINE amendment actually
      requires — no silent path to the overwrite, not merely none found.
      WHAT THIS DOES NOT COVER: that Obsidian invokes `onClose` on every
      dismissal. That is the framework's contract rather than this plugin's
      code, and a version that broke it would break the guarantee. The write
      itself was exercised for real (the check above), so `onClose` demonstrably
      fires on the confirm path at least.
      ORIGINAL INSTRUCTIONS: Press Reset and dismiss the prompt every
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
      **PASSES — OBSERVED 2026-09-27** on `gitlab.com/styl-group1/kb-docs`,
      the first time this has ever been run. `probe-review`'s merge request
      was merged (source branch deleted by default), the panel was NOT
      refreshed so it still offered Reset, and Reset was pressed. The author
      was told *"This document's review has already finished, so nothing was
      reset. Refresh to see where it stands now."* — `RESET_UNAVAILABLE_MESSAGE`
      — and **the note was left untouched**, still carrying its unsaved local
      text.
      The failure this check exists to catch did NOT occur: nothing fell back
      to the default branch, so no content from a different cycle was written
      over local work. `fetchResetContent`'s deliberate refusal to fall back
      is confirmed against a real deleted branch rather than reasoned about.
      Vocabulary held too — the message says "review has already finished",
      naming no branch, commit or merge request.
**HEADINGS UPDATED 2026-09-27 (name-panel-sections-by-next-actor) — not run.**
"Your documents" is now "Needs you", with unchanged contents, and documents
awaiting review and untouched are listed under "Waiting on reviewers",
collapsed by default. The two checks below are worded against that.

- [ ] **"Needs you" holds work owed, and only that.**
      **CORRECTION 2026-09-28: "never submitted" is NOT a brand-new note, and
      this check cannot be run as written.** `createDocument` does not write
      `doc_id` — identity is frozen at FIRST SUBMIT per
      `docs/document-identity.md` — and `listVaultDocuments` collects only
      notes that carry one. A note made with New Document and never submitted
      therefore appears in NO section, which is deliberate: it is not a
      document yet, and the empty state says exactly that ("Nothing submitted
      yet. Documents you submit will be listed here"). Observed directly —
      `test-005` was created and never submitted, and is listed nowhere.
      `UNSUBMITTED_LABEL` covers a narrower case than this item assumes: a
      note that HAS a `doc_id` but that nothing has resolved and no record
      describes. Reaching it takes a hand-added `doc_id`, or a tracked
      document whose review was deleted outright on the remote.
      **PARTIALLY OBSERVED 2026-09-28**, three of the four reachable states
      partitioning correctly on `gitlab.com/styl-group1/kb-docs`:
      "Needs you" held `test-004` and `test-008` (changes requested) and
      `test-009` (waiting for review AND edited since sent, shown as
      "Waiting for review  Unsent edits" — both labels, which is
      `fix-edited-baseline` decision 4 working). "Waiting on reviewers" held
      `test-006` alone, sent and unchanged. Every published, untouched
      document — `test-002`, `probe-published`, `test-1`, `test-123` and the
      imported `test-0xx` set — was listed in neither, as designed.
      **COMPLETED the same day.** With `probe/test-003.md` recreated and
      `test-002` edited, "Needs you" held all four reachable states at once,
      each for its own reason:
        - `test-002` — **"Published  Unsent edits"** (settled, but edited
          since, so the author owes the sending)
        - `test-003` — **"Not accepted"** (owed a decision, resubmit or
          abandon)
        - `test-004`, `test-008` — **"Changes requested"**
        - `test-009` — **"Waiting for review  Unsent edits"**
      "Waiting on reviewers" held `test-006` alone: sent and unchanged.
      Everything published and untouched appeared in neither.
      **BOTH EDITED VARIANTS SHOW THE STATE BESIDE THE MARKER**, on a
      published document and on one under review. That is the rule this
      check could not have exercised before `fix-edited-baseline`: until it
      shipped, the marker replaced the state and every row said the same
      thing. The partition is now verifiably by WHO ACTS NEXT rather than by
      state alone — two documents with the same state land in different
      sections depending on whether they carry local edits, which is the whole
      claim of the 2026-09-27 renaming.
      Run this against FOUR states plus that narrow one, and record which was
      used. With a document in
      each of the five states — never submitted, awaiting review, changes
      requested, published, not accepted — the section holds never submitted,
      changes requested and not accepted. Awaiting review and published appear
      ONLY once the note has been edited since its last submit: edit each and
      confirm it appears carrying its state AND "Unsent edits" beside it
      (the marker was renamed and made additive 2026-09-27). Unedited, the
      awaiting-review one is under "Waiting on reviewers" (expand it) and the
      published one is listed nowhere — the panel deliberately carries no
      roll-call of settled documents. Then break the refresh so one document
      resolves to nothing: it stays in "Needs you", with no state label, and
      NOT under "Waiting on reviewers"; that section's collapsed heading reads
      "(check failed)".
- [ ] **The empty states are told apart.** With nothing tracked at all "Needs
      you" reads "Nothing submitted yet. Documents you submit will be listed
      here."; with documents tracked but none owing anything it reads
      "Nothing needs you right now." The first would be a lie in the second
      case, which is why there are two. "Waiting on reviewers", expanded with
      nothing under review, reads "Nothing is waiting for review right now."
      and its collapsed heading shows 0.
- [~] **"Documents you can restore" covers documents under review only.**
      POSITIVE HALF OBSERVED 2026-09-27 on `gitlab.com/styl-group1/kb-docs`:
      `test-004`'s note was deleted while its merge request was open, and it
      appeared in the list — count 1, with a Restore button.
      BOTH EXCLUSIONS NOW CONFIRMED, same day, with all three notes deleted so
      the comparison is on state rather than on presence:
        - `test-004` (under review) — in "Documents you can restore", count 1,
          with a Restore button.
        - `test-002` (published) — in "Documents you can import" as
          `probe/test-002.md`, the count moving 9 to 10. Not in the restore
          list.
        - `test-003` (not accepted) — in NEITHER list, and nothing raised it
          anywhere.
      That is the whole partition working: one surface per question, and a
      document appears on exactly the one that can act on it.
      The `test-003` result is the one worth having. It was in the restore
      list until 2026-09-22 and was removed deliberately — nothing in this
      plugin deletes a stored record, so an author who deletes a rejected
      draft BECAUSE they have abandoned it would otherwise be offered it again
      for the life of the vault. The trade is that a rejected note deleted by
      accident is not recoverable from the panel; its content is still
      readable on the closed review, which is the escape hatch that makes the
      trade acceptable.
      ORIGINAL INSTRUCTIONS:
      Delete the note of a document **awaiting review** and of one in
      **changes requested**: both appear. Delete the note of a **not
      accepted** one: it does NOT appear, and nothing nags about it
      afterwards — an author who abandons their own rejected draft is not
      followed around by it (`reset.ts`, 2026-09-22). Delete the note of a
      **published** one: it appears under "Documents you can import" instead,
      not here. With nothing to restore the section is still present and
      reads "Nothing to restore."
- [x] **The resubmit actions do not depend on the lists.** CONFIRMED
      2026-09-27 on `gitlab.com/styl-group1/kb-docs`.
      `test-002` (published, listed nowhere) offered **"Submit a new
      version"**; `test-003` (not accepted, in "Needs you") offered **"Submit
      again"**. Each carried its own state line — "Published" and "Not
      accepted" — and **neither offered Reset**, which is correct: Reset is
      for pending and changes-requested only.
      The point of the check holds: a document the list does not show is
      still fully actionable, because the action lives on the open note
      rather than on a row. Whether each resubmit WORKS is §D8's business,
      not this one's.

Depends on A6/A7 and B7: Reset reads the merge request's changed path and
then the file's raw content. A failure here may be either of those rather
than the reset logic — check which call refused before assuming the latter.

---

## E. Facts observed about the target project, 2026-09-14

Run against `ivan/service.doc.kb` on `https://git.styl.solutions` with a
Developer-level token. These are not assumptions awaiting proof like §§A-D —
they are answers to two questions milestones 8 and 9 were blocked on, and
they are recorded here because this file is where observed facts live.

Caveat that applies to both: the instance's edition and version were not
read, so "self-managed CE 19.3.0" remains assumed. See §0.

### E1. Who may merge into the default branch — OBSERVED

Answers the question `openspec/config.yaml`'s milestone 8 entry carried as
"the mechanism is settled, that specific value is not".

```
default_branch:                 main
protected branch `main`
  merge_access_levels:          ["Maintainers"]
  push_access_levels:           ["Maintainers"]
the account that ran this:      access_level 30 (Developer)
```

- **The mechanism is confirmed.** `GET /projects/:id/protected_branches/main`
  returns `merge_access_levels[].access_level_description` in exactly the
  shape `docs/gitlab-roles.md` §5 predicted and milestone 8 would parse. No
  surprise here, and no code change implied.
- **Merge is Maintainer-only on this project**, which is GitLab's default and
  what §5 assumed. A Developer — the level this project's authors hold, and
  the level `config.yaml`'s access-floor decision sets for creating and
  submitting — will never be offered the Merge action.
- **Consequence for milestone 8, worth weighing before building it:** it
  delivers nothing to an author account. Its whole surface appears only for
  whoever holds Maintainer. That does not invalidate the milestone, but it
  does mean it cannot be tested or used by the same account that does every
  other operation in this plugin.
- **Self-merge is moot at this level.** The governance decision in
  `docs/gitlab-roles.md` §5 (accepted; the plugin adds no author-identity
  check) stands unchanged, but on this project GitLab already prevents a
  Developer from merging their own document. The accepted risk is real only
  for Maintainers.
- **Push to `main` being Maintainer-only does NOT affect the plugin.** Every
  write it makes goes to an unprotected `doc/<doc_id>` branch; it never
  pushes to the default branch.

### E2. Whether the corpus carries the front-matter contract — OBSERVED

Answers `docs/panel-tracking-scope.md`'s "single fact most likely to change
[milestone 9's] size". 34 markdown files surveyed; **none carries all seven
required fields.**

```
missing almost universally:  doc_id, category, lifecycle
sometimes also missing:      created
present nearly everywhere:   title, owner, last_reviewed
no front matter at all:      README.md, Global/Tools-&-Access.md
```

**Read the pattern before reading the headline.** "0 of 34 conform" sounds
like a corpus using a foreign convention. It is not. What is missing is
precisely the set of fields THIS PLUGIN writes at creation and at first
submit, which documents it never created and never submitted would not have:

- `doc_id` is *supposed* to be absent until first submit
  (`docs/document-identity.md` §3). And the corpus filenames already ARE the
  control IDs that decision assumed — `BOA-SOP-001_Update-Device-Details.md`,
  `SBT-KE-001_EG95-mTLS-Socket-Reopen-Error200.md`. Deriving `doc_id` from
  the filename at first submit yields the right value with no backfill.
- `category` is collected in the submit modal, so it is filled at the moment
  the plugin first takes the document on.
- `lifecycle` and `created` are creation-time fields; a document the plugin
  did not create has no chance to hold them. These are the only genuine
  backfill candidates, and both have obvious defaults.

So milestone 9 is closer to "read tree, write file, and let the ordinary
first-submit path fill the rest" than to the backfill engine
`panel-tracking-scope.md` feared. The corpus is a SUBSET of the contract, not
a conflict with it.

### E3. Import collides head-on with the first-submit pre-flight — VERIFIED IN CODE

Found while reading E2's result, confirmed by reading
`plugin/src/doc-authoring/submit-document.ts`. This is milestone 9's real
design problem, and it is not about front matter.

An imported document has no `doc_id`, so editing and submitting it takes the
FIRST-submit path, which runs `checkTargetPathFree`. That pre-flight refuses
when a file already exists at the note's path on the default branch — which
is true of every imported document by construction:

```
Import a document → edit it → Submit
  → no doc_id, so: first-submit path
  → checkTargetPathFree: a file exists at this path on `main`
  → REFUSED: "A document already exists at this location."
  → the author is offered Recover instead
```

The pre-flight is not wrong. `add-document-recovery` built it to catch a new
note colliding with a STRANGER's published document, and that signature —
"no local `doc_id`, path occupied on `main`" — is exactly what a freshly
imported document looks like. Import makes the legitimate case
indistinguishable from the case the check exists to refuse.

Milestone 9 must resolve this before it can ship anything usable; an Import
that produces unsubmittable documents is worse than no Import. The obvious
directions — have Import establish tracking so the note takes the RESUBMIT
path instead, or teach the pre-flight to recognise an imported document — are
not evaluated here, deliberately: that is design work for that change's own
proposal.

### E4. The repository-tree response shape — OBSERVED 2026-09-14

`listRepositoryFiles` (add-discover-and-import) parses
`GET /projects/:id/repository/tree?ref=…&recursive=true&per_page=100&page=N`
as a JSON array whose entries each carry a string `type` (`blob` for a file,
`tree` for a folder) and a string `path`. Nothing in §§A-D covers this
endpoint; it has never been called against any instance from this project.

```
curl -s -H "PRIVATE-TOKEN: <TOKEN>" \
  "https://<host>/api/v4/projects/<encoded-id>/repository/tree?ref=main&recursive=true&per_page=100&page=1" \
  | head -c 800
```

**CONFIRMED.** Entries carry `id`, `name`, `type`, `path` and `mode`, and
`path` is the FULL path from the repository root — the case that mattered,
since a folder-relative `path` would have mismatched every vault path and
offered the entire corpus as importable. `type` was observed as `tree` for
folders; `blob` was not in the portion of the response read, and is confirmed
in practice by Discover listing anything at all (the code collects `blob`
entries and nothing else).

```json
{"id":"fa805da1…","name":"plugins","type":"tree",
 "path":".obsidian/plugins","mode":"040000"}
```

**AND IT TURNED UP A DEFECT, which is why this check was worth running.** The
target project's default branch carries `.obsidian/` and `.claudian/`: the
vault is committed whole, plugin folders and all. Obsidian's index contains
no dot-folder, so `getMarkdownFiles` can never report a file under one — which
means a markdown file under `.obsidian/` could never match a vault path, would
have been offered as importable on every refresh forever, and could not have
been imported anyway, since `vault.create` writes into the vault and a hidden
folder is not in it.

Fixed the same day: `discoveryCandidates` excludes any path with a
dot-prefixed segment, which is Obsidian's own rule for what is not part of a
vault. Nothing showed the symptom yet only because no plugin folder happens to
hold a markdown file with front matter — the kind of latent wrongness that
surfaces months later, from something unrelated dropping a note in one.

WHAT WOULD HAVE BROKEN: an entry that does not parse makes the whole listing
fail as `unexpected`, so Discover shows nothing and says the check did not
succeed — the safe direction, but non-functional.

### E5. The tree endpoint's permission name when refused — STILL NOT OBSERVED

Same gap as §A6 and §A8, for the same reason: a fine-grained token gates
this read per-resource, and the plugin names the permission GitLab reports
so the author knows which box to ask their admin to tick. No refusal of this
endpoint has ever been seen, so the name is unknown.

Repeat §B2's procedure with a token lacking repository read, and record what
`error_description` names. Expected shape is `[Repository: Read]` or similar
by analogy with the observed `[Merge Request: Read]`, but that is a guess and
is recorded here as one.

WHAT BREAKS IF WRONG: nothing functionally — `classifyScopedStatus` already
produces `insufficient-permission` from the 403 alone, and the name is only
the parenthetical in the message. An absent name drops the parenthetical
rather than inventing one.

**OBSERVED 2026-09-22 — and the guess above was right.** From a token
narrowed to `Project: Read` alone on CE 19.4.0,
`GET /projects/:id/repository/tree?ref=main&recursive=true` refused with:

```json
{"error":"insufficient_granular_scope",
 "error_description":"Access denied: This operation requires a fine-grained
  personal access token with the following project permissions:
  [Repository: Read]."}
```

So the name is **`Repository: Read`**, exactly the `[Repository: Read]`
predicted by analogy with `[Merge Request: Read]`. Discover & Import can be
documented with a real checkbox name instead of an expectation, and the
parenthetical in the author's message will carry it.

The response shape §E4 recorded was re-confirmed in passing: the first entry
came back `{'id': '2ce3667…', 'name': '.claudian', 'type': 'tree', 'path':
'.claudian', 'mode': '040000'}` — a `tree` entry leading the listing, which is
why `listRepositoryFiles` drops non-`blob` entries at the edge, and a
dot-prefixed path, which is the defect §E4 caught and `discoveryCandidates`
now excludes.

### E6. An import that lands with its images — PARTIALLY OBSERVED 2026-09-14

The end-to-end check add-discover-and-import owes. Run against a second,
empty vault pointed at the same project — which is the setup this check
NEEDS, since the ordinary vault already holds every document and Discover
correctly offers nothing.

**CONFIRMED so far, in the running plugin:**

- The Discover section renders, listing documents by remote path with per-row
  Import and an Import all.
- An import lands the note at its exact remote path with its front matter
  intact and `doc_id` added (observed: `Global/Contribution-Guide.md`,
  `doc_id: Contribution-Guide`), and the note then appears under "Your
  documents".
- No `.obsidian/` or `.claudian/` path is offered, confirming §E4's fix in
  the real environment.
- `Products/Back-Office-Administration/README.md` IS offered, which is the
  exclusion rule working as designed rather than a bug: it carries front
  matter, and exclusion is by the absence of a block and never by filename.

**CONTRADICTED — the submit check failed, and it is the one that mattered.**
Submitting an imported document was refused with "This note's title or
category is missing or not one of the nine categories." §E3's refusal was
indeed dodged; a DIFFERENT one took its place at `readSubmissionFields`,
because an imported document carries `doc_id` and therefore takes the
resubmit path, which assumes `title`/`category` were written by a first
submit that never happened. Freezing `doc_id` at import had MOVED the
refusal rather than removed it, and "an imported document is submittable"
was false.

FIXED the same day: a note carrying `doc_id` but NO `category` has never been
through a first submit in this vault, so its next submit collects and writes
the two fields — the front matter contract performed rather than repeated.
See `openspec/config.yaml`'s "WHO WRITES WHAT, AND WHEN", clarified to say
so. A note that HAS `category` and a missing `title` still refuses, which is
the hand-edit case that refusal was built for.

**OBSERVED on the first real "import all" 2026-09-15 — the batch works, and
the corpus collides.** Most documents imported; eight were refused, for three
reasons, and all three refusals were CORRECT:

```
3 × README.md          (Back-Office-Administration, Barcode-Scanner,
                        Terminal-BFVM) → all derive doc_id `README`
5 × _placeholder.md    (FAQs, Known-errors, Reference, Runbooks, SOPs under
                        Terminal-BFVM) → all derive doc_id `_placeholder`
2 × names with spaces  `SB-SOP-001_Terminal-Offline (SAMPLE).md`,
    and parentheses     `ProjectCode-SOP-NNN_SOP Name.md`
```

**This is `docs/document-identity.md` §3 working, not failing.** `doc_id` is
the FILENAME, so files sharing a basename across folders derive one id, and
one id means one branch `doc/<id>` — from which GitLab cannot hold two open
merge requests. Refusing is the only correct answer. §3 anticipated it
("hand-picked ids can collide where generated ones could not"); what is new
is that the real corpus collides EIGHT TIMES, because `README.md` and
`_placeholder.md` are precisely the files that do not follow the corpus's own
control-ID naming convention.

The first click imported everything importable; the second imported zero,
which is correct — nothing importable was left. A batch is not idempotent
because it does not need to be.

TWO DEFECTS THIS EXPOSED, both fixed 2026-09-15:

- **The refusal message was false.** It said "Another note in this vault is
  already this document", which is true only for a document moved locally.
  For two different READMEs it sends the author hunting for a duplicate that
  does not exist. It now names the ID, the note holding it, and the only fix
  that works — a rename on the platform.
- **The batch notice was a wall of text.** Eight reasons in one notice
  covered the panel it described. Reasons now render on the refused rows
  themselves, where the author is already looking; the notice is a count.

STILL OPEN, and a judgement call rather than a bug: `README.md` and
`_placeholder.md` carry front matter, so the exclusion rule offers them, and
the design accepted that consequence in the abstract ("importing it produces
a note the author can delete"). Eight of them at once is more friction than
that reasoning assumed. The argument against a filename denylist still
stands. Worth revisiting only with a rule that is about the DOCUMENT rather
than its name.

**NO LONGER BLOCKED BY §D0f, as of 2026-09-29.** You can now reach the
import list by deleting a document's note while it is under review, merging
the review, and refreshing, which is the natural way to set up the checks
below. Before `correct-stale-records`, that document stayed on the restore
list and was hidden from import.

**STILL TO RUN — AND add-discover-and-import SHIPPED WITHOUT IT, 2026-09-20.**
The change that introduced Import closed with these unrun, deliberately: they
need the running plugin against the real instance, and the work moved on. The
debt is recorded here rather than in that change's task list because this file
is where what-is-not-confirmed lives, and a closed change's tasks are no
longer read.

Everything below is covered by tests over fakes, which pin what the plugin
BUILDS and never that the platform accepts it. Treat the attachment half as
unproven until this has been run.

- Edit an imported document and submit it. Confirm the submit modal OPENS
  and collects title and category; confirm neither §E3's refusal nor the
  front-matter one occurs; confirm a review opens for it.
- Confirm the note afterwards carries exactly ONE `doc_id` line, plus the
  `title` and `category` just collected, with every field it arrived with
  still present and unreordered.
- Confirm the committed content carries those fields too, not just the local
  note — read the file back from the new branch.
- Import a document that embeds an image. Confirm the image lands at its own
  remote path and the embed renders in Obsidian rather than showing as an
  unresolved link.
- Recover a deleted note that embeds an image, and confirm the same. This
  path has been broken since recovery shipped, so it is the one with no
  prior working behaviour to compare against.
- Import a document embedding an image whose filename the corpus holds in
  more than one folder, if one exists. Confirm the author is told the embed
  could not be placed rather than being given an image from the wrong folder.

WHAT BREAKS IF THE ATTACHMENT HALF IS WRONG: the note still lands. Every
attachment failure is per-attachment and reported, and nothing about an image
can fail an import — so the failure mode to look for is a document that
arrives readable with pictures missing, not a document that does not arrive.

**THE IMAGE HALF IS NOW OBSERVED — 2026-09-29 on
`gitlab.com/styl-group1/kb-docs`.** The check this item owed since 2026-09-14.

`test-017` was submitted carrying an embedded `test/img-shared.png`, merged,
and then BOTH the note and the image were deleted from the vault — confirmed
deleted, because `probe.py --compare` answered `cannot read local file` at
12:29. After the document was imported, the same comparison at 12:48 answered:

    local : 140972 bytes  sha256=efebca538e3f5860
    remote: 140972 bytes  sha256=efebca538e3f5860
    *** BYTE-IDENTICAL ***

So the import fetched the image, and fetched it faithfully at 140,972 bytes —
`bringAttachments` is the only path in the plugin that writes an image into the
vault, so nothing else could have put it there. The failure mode this item was
written for, an image that decodes wrongly and lands corrupted rather than
erroring, does not occur.
Checked by HASH rather than by looking at whether the embed rendered, which is
the only way to tell a correct image from a plausible one.

**A workaround was needed to set this up, and it is §D0f rather than a finding
of its own.** The natural sequence — submit, delete the note, merge — leaves a
stale `pending` record that keeps the document on the restore list and
suppresses it from the import list, so the import path cannot be reached at
all. The record had to be deleted from `data.json` by hand first. Once
`correct-stale-records` ships, the natural sequence works and this note can go.

### E7. The non-raw file read carries base64 `content` — HALF OBSERVED 2026-09-22

`getFileBytes` (add-discover-and-import) reads an attachment's bytes from the
SAME endpoint §B8 already covers for `last_commit_id`, taking the `content`
field that `getFileCommitId` deliberately ignores. §B8 never looked at
`content` or `encoding`, so this half of that response is unverified.

```
curl -s -H "PRIVATE-TOKEN: <TOKEN>" \
  "https://<host>/api/v4/projects/<encoded-id>/repository/files/<url-encoded-path-to-a-png>?ref=main" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['encoding'], len(d['content']))"
```

- Confirm `encoding` is `base64` and `content` is the file's bytes so encoded.
- Confirm it round-trips: decode it and compare against the file downloaded
  from the `/raw` endpoint with `curl --output`. This is the check that
  matters — an image that decodes to the wrong bytes renders as a broken
  image rather than as an error.

WHAT BREAKS IF WRONG: an `encoding` that is not `base64` is refused outright
and reported as an image that did not arrive, which is the safe direction and
is already handled. Bytes that decode wrongly are NOT caught and would land a
corrupted image in the vault silently — the one failure here worth spending a
real check on.

- [x] **`encoding` is `base64` and `content` is present.** OBSERVED 2026-09-22 on `git.styl.solutions` / `ivan/service.doc.kb`,
      on `Global/Contribution-Guide.md` at `ref=main`: the response carried
      `encoding: "base64"` alongside the `last_commit_id` §B8 wants.
- [x] **A realistic-sized binary is byte-faithful.** 2026-09-28 on
      `gitlab.com/styl-group1/kb-docs` via `probe.py --compare`:
      `test/img-shared.png` is **140,972 bytes with matching sha256** in the
      vault and on the remote. Whichever direction that file travelled, the
      plugin's handling of it changed nothing, at a size the 1x1 PNG below
      could not speak for.
      Scope, so this is not read as more than it is: it compares two copies
      that ALREADY existed. It does not exercise an import fetching an image
      for a document the vault has no copy of, which is what §E6 asks and
      which still needs the delete-and-import cycle.
- [x] **The bytes round-trip.** CONFIRMED 2026-09-22 via `probe.py --writes`:
      a PNG committed with `encoding: "base64"` and read back from `/raw` came
      out **byte-identical**. The corrupted-image failure mode this item was
      written for does not occur on CE 19.4.0.
      Checked on a 1x1 PNG, so it proves the ENCODING is faithful, not that a
      large image is — §B11's 2026-09-13 gitlab.com run covers size at 280,747
      bytes. A large binary on CE specifically is the remaining sliver.

### E8. Publishing into an EMPTY repository breaks the project permanently — OBSERVED 2026-09-21

Not a spike. A real failure, on `styl-group1/kb-docs-02` (gitlab.com, numeric
project id 86679032), found while diagnosing why a note could not be
submitted.

```
default_branch:  doc/nets-69xxx-error-code      <- the plugin's OWN branch
empty_repo:      false
files on it:     L1/nets-69xxx-error-code.md    <- and nothing else
```

**The mechanism.** In an empty GitLab repository the FIRST branch created
becomes the default branch. So:

1. The project was created with no commits.
2. A first submit committed to `doc/nets-69xxx-error-code`, the only branch —
   which GitLab therefore made the default.
3. `createMergeRequest` could not open: its source and target were now the
   same branch.
4. So `writeSubmissionFrontMatter` never ran. The COMMITTED copy carries
   `category` and `doc_id`; the local note carries neither, and no record was
   stored — the panel read "Nothing submitted yet" throughout.
5. Every submit after that read the default branch, found the document's own
   file at the target path, and was refused by `checkTargetPathFree`.
   Permanently, for that document and every other.

**FIXED the same day.** `getDefaultBranch` now refuses a project whose
repository is empty, returning the new `empty-repository` failure kind rather
than a ref, so nothing is written at all. It checks `empty_repo` AS WELL AS
`default_branch`, because the two disagree in exactly the dangerous case: a
fresh project reports the branch name it WOULD default to before any commit
has created it, and trusting that name is what writes the first branch.

The author is told to add a starting file to the project and try again, which
is a thing they can do and which retrying is not.

WHAT TO WATCH FOR: this is the one failure that does not announce itself. The
symptom is a project whose `default_branch` is a `doc/…` name. If you see
that, the project needs a real default branch restored before the plugin can
be used against it — pushing an initial commit to `main` and setting it as
the default — and the stranded `doc/…` branch's content is the document,
recoverable by hand.

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
