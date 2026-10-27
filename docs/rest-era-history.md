# REST-era history: the v1 roadmap and the decisions the plugin ran on

Moved VERBATIM from `openspec/config.yaml` on 2026-10-22 when the change
`replace-rest-with-local-git-ssh` replaced the GitLab REST + access-token plugin
with `git` over SSH. Nothing below was reworded except for the removal of the
two-space indent it carried inside the config's `context:` block; only this
header is new.

This is HISTORY. It describes a design that no longer exists, so do not design
against it. It is kept because the reasoning behind a decision outlives the
decision: several of the rules below (never pre-flight a permission, never
overwrite silently, refuse to follow a moved path) shaped the replacement, and
the replacement cites them. The current decisions are in `openspec/config.yaml`
and in the change's `design.md`.

## Part 1. MILESTONES (v1 roadmap)

MILESTONES (v1 roadmap — a sequence, not a schedule; reorder as reality
intervenes, this list is expected to change)
Each milestone is one proposal: a vertical slice a person can click and
observe, per the proposal rule below. Numbering shows the dependency
order, not a fixed calendar.
1. Plugin shell — sidebar view registers and opens via a ribbon icon and
   a command palette entry; empty container. Proves the shell before
   anything else is built to depend on it.
2. Connect to GitLab — settings tab: paste a personal access token and
   project URL, "Test connection" calls the API and shows who it
   connected as. Nothing downstream can be real without this. Confirmed
   on the target instance: the default token screen is the newer
   fine-grained flow, which has no `api`-style scope at all — the `api`
   checkbox this whole credentials decision depends on is one click
   further in, under "Generate legacy token". DECIDED (2026-08-24,
   superseding the above): the settings tab guides authors through the
   fine-grained flow instead, per the credentials decision — see
   Credentials' "Still to verify" below. Exact permission checkboxes
   are not enumerated in the settings-tab copy (that's handled during
   onboarding, per the same decision); the copy just points at the
   fine-grained flow generically. The legacy-flow click-path recorded
   above is kept as the documented fallback if the deferred
   self-managed rerun ever turns up a real gap, not deleted outright.
   Includes expiry handling: short-expiry tokens
   make expiry a certainty rather than an edge case, and it presents as
   every call failing at once for one person. A 401 anywhere in the
   plugin must surface as "Your access has expired — ask your admin to
   set it up again", not as a generic failure, and must point at the
   settings tab. AMENDED 2026-09-30: authors create their own tokens, so
   the message is now "Your access token has expired or is incorrect.
   Check you pasted all of it, or create a new one in GitLab.", one
   shared string on every surface (self-service-token-messages).
3. Create a new document — RENAMED 2026-08-26 from "Create a new SOP".
   "New Document" creates a note at the author's current folder with
   the front matter fields the plugin can know at creation, and opens
   it. UNBLOCKED (2026-08-26) by the `owner` decision below.
   DEPENDS ON MILESTONE 2, as of that decision. This corrects an
   earlier note here that said milestones 2 and 3 did not depend on
   each other and either could go first — that was true only while
   `owner` might have been dropped. Autofilling it requires the
   authenticated identity, which only the connection provides, so
   milestone 2 must land first. It already has.
   WHAT IT WRITES, and why the list is exactly four — AMENDED
   2026-08-26 by the shift-right split below. The plugin fills the
   fields it can know without asking: `owner` from the authenticated
   identity, `created` as today, `last_reviewed` equal to `created`,
   and `lifecycle: active`. `title`, `category` and `doc_id` are NOT
   written here — they are the author's to decide and are collected at
   submit by milestone 4. The author gets a file they can start typing
   into with no modal in the way, which is the point of the split.
   The label "New SOP" was dropped because the naming decision below
   already rejected `sop-*` for the plugin on the grounds that the SOP
   framing is this team's use case rather than the plugin's scope —
   and SOP is now one of nine categories, not the whole corpus.
   Makes no GitLab call of its own: the identity comes from the
   connection state milestone 2 already retains, not from a fresh
   request at creation time. A note cannot be created before a
   successful connection check in that session, and that requirement
   is this milestone's to specify. Creation is additionally gated at
   Developer (30) per the access-floor decision below.
   REJECTED: creating a blank note with empty front matter and
   deferring every field to submit. It looks like the tidier version
   of shift-right and it dissolves this milestone — a blank file is
   Obsidian's own New Note, it produces nothing a person can observe
   that the core app does not, and it removes the `owner` autofill
   that is the entire reason this milestone depends on milestone 2.
3a. Configurable default directory — ADDED. A plugin-level default
   folder for "New Document"; unset or invalid falls back to the vault
   root.
4. Submit for review — the first end-to-end slice: click Submit, the
   plugin creates the branch, commits, and opens the merge request; the
   note shows "Waiting for review". UNBLOCKED (2026-08-26): the `owner`
   question that shaped the front matter contract is decided below, and
   the contract is settled.
   AMENDED 2026-08-26 by the shift-right split, and note this REVERSES
   a sentence that stood here: "this milestone only submits what is
   already in the note." That is no longer true. Three fields are
   completed here, not at creation:
     - `title` — the author is prompted for it.
     - `category` — the author picks one of the nine deliverables.
     - `doc_id` — the plugin snapshots the note's CURRENT filename into
       front matter, once. From that moment it is frozen, and the
       filename may drift away from it freely.
   Submission is blocked until `title` and `category` are present and
   non-empty, per the front matter contract below — an inline prompt,
   not a failure after the fact.
   `owner`, `created`, `last_reviewed` and `lifecycle` are written at
   creation by milestone 3 and are not touched here.
   The pre-submit checks below (duplicate `doc_id`, then path mismatch)
   do not bind on a FIRST submit: nothing is on the remote yet, so
   there is no path to drift from. They bind from the second submit
   onward, which makes them milestone 6's and milestone 7's to enforce.
4a. Attachment sync — DONE (2026-09-13, add-attachment-sync), write
   side only. Numbered `4a` because this list's numbering is dependency
   order and renumbering 5-8 would silently break a dozen
   cross-references; `5a`/`5b`/`7a`/`9a` follow the same convention.
   WHAT SHIPPED: the commit payload is an actions array — the note plus
   every image it embeds, each at its vault path, each with its own verb
   and, where it updates, its own `last_commit_id`. All four write paths
   build it, so none can commit the note alone.
   FOUR RULES NOT TO RE-BREAK:
     - NEVER DELETES. Unlinking or moving an image strands the remote
       copy; orphans accumulate and a Maintainer clears them in GitLab,
       the same escape hatch reorganization uses. `CommitAction` has no
       `delete` member, which is what makes this structural.
     - Wikilinks resolve through Obsidian's own resolver, never a regex
       over the note's text: `![[image.png]]` carries a filename, not a
       location. Markdown-style `![alt](path.png)` resolves as a path
       relative to the note. An embed that resolves to nothing is
       SKIPPED, never a refusal — a typo must not block publishing.
     - The verb is read per file from the target ref, the same rule 6/7
       established for the note. A shared attachment already on `main`
       is an update carrying its own guard. Two authors writing
       different bytes to one path stays unresolvable by the plugin;
       the guard makes the second write fail loudly.
     - `getMergeRequestChangedPath` now means "exactly one MARKDOWN
       file", which is what keeps the path-mismatch check, Reset and
       recovery's fallback working for an illustrated document. Taking
       on note-in-note transclusion is what would break it.
   Attachment paths follow the same 1:1 vault mirroring as documents and
   are pushed from their location at submit time. Tests arrived with
   this change (Vitest, `npm test`); the three facts only a server can
   settle (§B9-B11) were CONFIRMED on CE 2026-09-22.
5. See your status — DONE (2026-09-11, add-document-status). Sidebar
   lists the author's own docs with their current state, resolved via
   reconciliation from front-matter `doc_id` alone. Read-only from the
   author's point of view. The remote decides; plugin data is the cache,
   overwritten on every successful refresh.
   CORRECTED 2026-09-11: this entry used to say milestone 4 only writes,
   so this one "makes the first `GET /merge_requests` call and needs a
   new client method for it." fix-interrupted-submit made that call
   first, on 2026-09-09, and proved reads are scope-gated too. Milestone
   5 GENERALIZED that endpoint and inherited its classification.
   SETTLED 2026-09-22: `blocking_discussions_resolved` IS present on
   CE's listing entry. "Changes requested" still ships on the
   per-merge-request discussions read, which is
   correct whether or not that field exists and whether or not the
   project's "all threads must be resolved before merging" setting is on
   — so that setting is NOT a prerequisite here.
5a. Recover a document — ADDED 2026-09-11 (add-document-recovery),
   numbered `5a` on the same convention as `4a`/`7a`: this list's
   numbering is dependency order, and this milestone extends milestone 5
   rather than sitting between two others, so nothing after it renumbers.
   Two gaps milestone 5 left, both surfacing only from actually using the
   plugin against a shared, multi-contributor project: a local note can be
   deleted while its submission is still real, with nothing to reconnect
   it to (`doc_id` lives only in the note's own front matter); and a
   first-time submit whose target path already holds a document published
   by someone else fails with the same generic message every other
   undifferentiated failure does, no hint that a document already exists.
   Adds a second panel list, "Documents you can recover", built from
   `SubmissionStore`'s own records minus the vault's — and a pre-flight on
   a first submit (no `doc_id` yet) that checks the target path against
   the project's default branch before writing anything. Depends on
   milestone 4 for the write path and milestone 5 for the reconciliation
   plumbing it borrows (`findOpenMergeRequest`). Deliberately excludes
   discovering a document this vault has never had any trace of at all —
   see `openspec/changes/add-document-recovery/future-work.md`.
5b. Reset, and repurpose "Your documents" — DONE (2026-09-13,
   add-reset-and-panel-scope). Reset replaces the open note with what its
   own tracked branch holds — never the default branch, always behind a
   confirmation, pending/changes-requested only. That confirmation is the
   condition the NO CI PIPELINE amendment exempts Reset on; never add an
   unasked variant. "Your documents" keeps never-submitted and unresolved
   too; published/not-accepted move to a second "Other documents" section
   for visibility — 6/7/7a's actions render for the open note, not there.
   `docs/panel-tracking-scope.md`.
6, 7, 7a. Send updates / Revise a published document / Resubmit after
   "Not accepted" — ALL THREE DONE (2026-09-12, add-resubmission-
   lifecycle), shipped as ONE change because all three forked in the
   same function on the same one-line bug. COMPRESSED here 2026-09-13:
   each entry's pre-implementation sequencing debate (why 7 sat after 6,
   what depended on what, what to do if one slipped) is preserved
   verbatim in that change's archived proposal/design and in
   `docs/resubmission-lifecycle.md`; only what a future reader must not
   re-break is kept below.
   WHAT SHIPPED: `performSubmit` forks on whether the note carries a
   frozen `doc_id`; a tracked note goes to `performResubmit`, which runs
   the two pre-submit checks and then acts on the resolved state —
   pending/changes-requested commit an update to the existing branch
   with no new merge request; published and not-accepted clear any
   lingering branch, cut fresh from the CURRENT default branch, and open
   a new one. Full behaviour: `docs/resubmission-lifecycle.md` §0.
   THREE RULES NOT TO RE-BREAK:
     - "Flips back to pending" is WRONG and was corrected here. A
       document is changes-requested because its merge request carries
       an unresolved thread; pushing a commit does not resolve one. The
       push lands regardless and the DISPLAYED state waits for the next
       refresh. Optimistically flipping the local record was rejected —
       it shows a state the remote does not hold.
     - The commit verb is READ from the file's actual presence on the
       target ref, never inferred from the state. A Maintainer may have
       moved a published file; someone may have published into a
       turned-down document's path.
     - The two pre-submit checks (duplicate `doc_id`, then path
       mismatch, in that order) bind for EVERY resolved state, not some.
   `last_commit_id` is read immediately before each write, never carried
   over from state resolution.
   NOTHING WAS OWED TO 5b (corrected 2026-09-13): these render for the
   CURRENTLY OPEN note, never as row buttons, so 5b's narrowing stranded
   nothing — it buys visibility (`docs/panel-tracking-scope.md`).
8. Review and merge — reviewer-facing pending list and a Merge action,
   gated by the real protected-branch permission check, never a role
   label. UNBLOCKED on the tier question: confirmed GitLab CE, so
   required approvals can never gate the merge here — the protected
   `main` branch's "Allowed to merge" permission is the only real
   control the Merge action can rely on. CLOSED 2026-09-14: the value
   was read on the target project — `main` merges and pushes are
   Maintainers-only, in the shape the code expects
   (`docs/ce-verification.md` §E1). WEIGH BEFORE BUILDING: authors hold
   Developer, so this milestone's whole surface never appears for the
   account that does every other operation here.
   UNBLOCKED on the self-merge governance question too, as of
   2026-09-09: self-merge is accepted and the plugin adds no
   author-identity check, so the Merge action's behaviour no longer
   depends on an unanswered question — see the architecture decision.
   What remains for this milestone is therefore mechanical, not
   governance: read the protected branch's merge permissions, offer
   Merge to whoever holds them, and surface a 403 clearly when GitLab
   refuses anyway. Does
   NOT affect "Changes requested": that
   state is derived from merge request comments, which behave
   identically on every tier and never gate a merge. Reviewers editing
   an author's submission is out of scope; the escape hatch is an
   "Open in GitLab" link.
   DEEP LINKING: whether to also offer a file-specific blob-view link
   is undecided (`docs/resubmission-lifecycle.md` §6).
9. Discover & Import — DONE (2026-09-14, add-discover-and-import).
   Import, never sync: author-triggered, one document or an explicit
   "import all". A third panel section lists remote markdown the vault
   has no note at that path for, minus files carrying NO front matter
   block — the whole exclusion rule, and §E2 is why it is neither a
   filename denylist nor the full contract. Truncation is reported.
   THREE RULES NOT TO RE-BREAK:
     - `doc_id` IS FROZEN AT IMPORT. Without it the first submit takes
       the first-submit path and `checkTargetPathFree` refuses, by
       construction, every time (§E3). WIDENS
       `docs/document-identity.md` §3, amended to match.
     - The remote path, never milestone 3a's default directory.
     - Both refusals — duplicate `doc_id` anywhere in the vault, and an
       occupied path — run before anything is written.
9a. Attachment sync, read side — DONE (2026-09-14, same change). An
   imported OR recovered document brings its images down, each at its
   own remote path; one the vault already holds there is left alone.
   Recovery had this gap from the day it shipped.
   ONE RULE NOT TO RE-BREAK: resolution is `resolveEmbeddedAttachments`
   asked of an index backed by the REPOSITORY LISTING, not the vault.
   The vault-backed adapter answers only for files already present, so
   it resolves nothing for exactly the documents that need it. A
   wikilink with several candidates is reported unplaceable, never
   guessed — 4a's ban on a second shortest-path rule still binds.

## Part 2. Architecture decisions replaced or retired by the change

- Plugin talks to GitLab entirely via its REST API — no local git binary,
  no `git init`, no SSH keys, no `.git` folder in the vault ever. Every
  "submit" action is 1-2 HTTP calls (create branch + commit via
  `POST /repository/commits` with `start_branch`, then a separate
  `POST /merge_requests`) — not local git commands. Subsequent revisions
  commit to the existing branch, so they omit `start_branch`.

- Deliberately avoiding local git also sidesteps vault-sync conflicts
  (Obsidian Sync / Dropbox / iCloud fighting with a local `.git` folder).

- Submission state is tracked in plugin data, not derived from git.
  Branches are auto-deleted on merge, so branch existence cannot answer
  "where is my document right now." The remote merge-request state is the
  source of truth; plugin data is a local cache of it, reconciled on
  refresh. States: unsubmitted, pending, changes-requested, published,
  closed. Deliberately NOT named "draft" — GitLab has its own Draft
  merge request feature meaning a real MR marked not-ready, which is a
  different thing. Here `unsubmitted` means no branch and no merge
  request exist yet; the author-facing label is "Not submitted yet".
  AMENDED 2026-09-22: "a local cache" stopped being the whole truth when
  Import shipped. An IMPORTED document's record says it is published, and
  nothing on the remote can say that — reconciliation resolves state from
  merge requests, and an import has none. Lose `data.json` and submissions
  still heal from each note's `doc_id`; imported documents do not, and all
  read "Not submitted yet" again. So plugin data now holds one fact of its
  own, and anything that deletes it loses real information rather than a
  rebuildable cache. `plugin/install.sh` wiped it on every reinstall for
  exactly this reason and now preserves it.

- Submission state lives ONLY in plugin data, never in the note's front
  matter. Writing it into front matter would commit workflow state into
  the repository, produce a diff on every review round, and leave a
  stale value baked into `main` after merge.

- Branch recreation — what happens when the plugin needs to create
  `doc/<doc_id>` and something is already in the way — now lives in
  `docs/document-identity.md` §5. MOVED there 2026-09-09, verbatim and
  unchanged, to keep this file under OpenSpec's 50 KB context limit,
  which the decision's own resolution had just pushed it past. Read it
  BEFORE designing any resubmission path.
  It was RESOLVED in full on 2026-09-09, and that is what made it
  movable: the rule above keeps OPEN questions in this file because
  open questions belong where they will be seen. A closed one belongs
  with the subject it settles, and `docs/document-identity.md` already
  owns branch naming and its lifetime.
  What it settles: closed-without-merge is TERMINAL, never reopened;
  both the rejected-cycle and published-cycle cases end in the same
  action, cutting `doc/<doc_id>` fresh from current `main` and opening a
  new merge request; and the plugin itself deletes an abandoned branch,
  silently, at the next resubmit. That delete is git-publishing's first
  destructive call, and the fix-interrupted-submit change introduces it
  ahead of milestone 7a, which reuses it rather than adding it. `doc_id` never maps to a single merge request over a document's
  lifetime.

- Document identity, branch naming, reconciliation, and file paths now live
  in `docs/document-identity.md` — MOVED there 2026-08-26 to keep this file
  under OpenSpec's context limit, verbatim and unchanged. Read it BEFORE
  designing anything that names a branch, resolves a note to a merge
  request, or decides where a file goes on the remote.
  What it settles: `doc_id` is the note's filename snapshotted at FIRST
  SUBMIT and frozen permanently thereafter; the branch derives from that
  frozen value and NEVER from the live filename; reconciliation queries all
  merge request states, newest first; the vault mirrors the repository 1:1
  from the root; and a document whose local path has drifted is REFUSED
  rather than moved, with the duplicate-`doc_id` check ordered first.
  The branch-recreation question above stays in THIS file on purpose —
  open questions belong where they will be seen, not in reference. Both
  of its cases are now answered; its one remaining sub-question (who
  clears the stale branch) stays there for the same reason.

- CREATING AND SUBMITTING REQUIRE DEVELOPER (30). DECIDED 2026-08-26.
  `docs/gitlab-roles.md` §3 puts Submit at level 30 — it is a push to a
  non-protected branch — so a Planner or Reporter can read the corpus
  and the review queue and can never publish anything they write.
  Gating CREATION and not only submission is deliberate: letting
  someone draft a document they can never submit fails them later, and
  worse.
  Consequence for a surface already shipped: the panel's
  `DOCUMENT_ACCESS_LEVEL = 15` threshold currently shows "Ready to
  publish your documentation." to a Planner. That message is wrong
  under this decision, and plugin-shell needs a distinct READ-ONLY
  state — the band vocabulary is already in `docs/gitlab-roles.md` §4.
  This gate is OPTIMISTIC, never proof, and gate 2 stands behind it: a
  Developer holding a read-only credential passes this check and still
  fails to submit. It removes the common case, not the case, and every
  action must still fail gracefully.

- TOKEN PERMISSIONS CANNOT BE PRE-FLIGHTED. DECIDED 2026-08-26,
  recorded because "block the action when the token lacks the
  permission" is the obvious-sounding design and is impossible.
  `docs/gitlab-roles.md` §1: no endpoint lists which permission
  checkboxes a fine-grained credential was created with. The plugin
  therefore ATTEMPTS the operation, catches the failure and translates
  it — the spike found GitLab names the missing permission in an
  `insufficient_granular_scope` error rather than returning a bare 403,
  which is unusually good material for a clear message. Do not later
  "improve" this into a pre-flight check; there is nothing to check
  against.

- NO CI PIPELINE. DECIDED 2026-08-26, after a proposal to have GitLab
  CI update `last_reviewed` on merge and, in one version, flip
  `lifecycle` from draft to active. Rejected on two independent
  grounds, recorded because the idea is appealing and will recur.
  MECHANICAL: nothing pulls remote content back into the vault. A CI
  commit to `main` makes every local copy differ from the remote after
  every merge, and the next revision submits the whole local file — the
  commit API sends content, not a diff — silently reverting CI's write
  and showing a spurious regression in the diff every cycle. The
  obvious guard, a pull that refuses when local differs from remote,
  DEADLOCKS: CI's own change is the difference, so the pull is refused
  forever and the update never arrives.
  SEMANTIC: `last_reviewed` under CI means "last merged", which is
  exactly what git already records — the duplication this file rejected
  changelogs for. Human-maintained it means "someone re-read this and
  confirmed it is still true", which git does not know, especially when
  the review changed nothing and produced no commit.
  `last_reviewed` is therefore human-maintained, edited by the author
  on the revision that reviews the document. It is autofilled once, at
  creation, equal to `created`.
  Consequence worth keeping: with no CI the plugin is the sole writer
  to `main`, so local and remote diverge only through the "Open in
  GitLab" escape hatch — a risk this file already accepts. A pull
  mechanism therefore drops from mandatory to optional. If one is ever
  built AUTOMATICALLY or IMPLICITLY — triggered by anything other than
  the author directly asking this one document be overwritten — its
  baseline for "has unsubmitted changes" must be the last content
  submitted FROM THIS VAULT, never the live remote file, and it must
  also refuse while a document is awaiting review.
  AMENDED 2026-09-12: governs an IMPLICIT pull; the risk is SILENT loss,
  the same principle `last_commit_id` states for writes below.
  Milestone 5b's Reset is not that — explicit, single-document,
  author-confirmed, on purpose, including while pending or
  changes-requested. EXEMPT from "must refuse while awaiting review" on
  the condition that keeps it safe: confirm before every overwrite. An
  automatic or scheduled pull stays bound in full.
  Struck along with the pipeline: "CI deletes the source branch" was
  redundant — GitLab auto-deletes on merge already.

- Every update to an existing file MUST send `last_commit_id` so GitLab
  rejects a write based on a stale read, rather than silently
  overwriting. This is required even with reviewer editing out of scope:
  the same author on two machines, or a note restored from backup, can
  produce a stale local copy. Losing someone's work silently is worse
  than failing their submit, so the write must fail and the author must
  be told the document changed since they last opened it.

- Whether the Merge action is shown is decided solely by the protected
  `main` branch's merge permissions for the current user — never by a
  fixed role-name mapping. Typically this tracks GitLab access_level
  (Developer = contributor, Maintainer/Owner = reviewer/merger), but
  that is just the common case, not the rule: if a project's
  protected-branch settings ever allow a different access level to
  merge, the plugin follows that, not the label. GitLab itself is
  still the real enforcement boundary — the plugin's UI gating is
  just UX, not a substitute for checking the permission itself.

- Self-merge governance now lives in `docs/gitlab-roles.md` §5. MOVED
  there 2026-09-12, verbatim and unchanged, on the same convention as
  the branch-recreation move to `docs/document-identity.md` §5: it was
  RESOLVED in full on 2026-09-09, and a closed decision belongs with the
  subject it settles. Read it BEFORE building milestone 8's Merge
  action.
  What it settles: self-merge is accepted and the plugin adds no
  author-identity check of its own; whether Merge is OFFERED is still
  decided solely by the protected branch's merge permissions, never a
  role label.

- Credentials, token type, storage, and the "Test connection" boundary now
  live in `docs/access-tokens.md` — MOVED there 2026-08-26 to keep this file
  under OpenSpec's context limit, verbatim and unchanged. Read it BEFORE
  touching anything that holds, stores, or authenticates with a token.
  What it settles: personal fine-grained tokens, one per author, never a
  shared or project token (with the two-branch argument for why a bot
  identity fails); the three values are held in memory for the session and
  never written to any file; the still-OPEN `secretStorage` spike and the
  three unknowns that each disqualify it on their own; the legacy-token
  deprecation risk and why it is currently moot; and that "Test connection"
  reads identity plus project role through git-publishing, which owns every
  request — surfacing a ROLE, never the token's actual grants.
  AMENDED 2026-09-30 (persist-connection-settings): of the three values,
  only the TOKEN is now session-only and never written to any file. The
  GitLab address and project ID persist in `data.json` once tested — not
  credentials, so the daily re-entry is one field. The `secretStorage`
  spike stays open past v1, deliberately. `docs/access-tokens.md` §3.

- Treat plugin data storage (submission-tracking state, once that
  capability lands) as plaintext by default. Flag explicitly before
  persisting anything else. Does not apply to credentials, which are
  session-only per the decision above and never reach `data.json`.
  FLAGGED 2026-09-30, as this rule asks: `data.json` now also holds the
  tested address and project ID (`connection`), written only through
  `SubmissionStore`, the file's single writer. The token never does.
