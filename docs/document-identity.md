# Document identity: ids, branch names, reconciliation, and paths

Extracted from `openspec/config.yaml` on 2026-08-26, VERBATIM. It lives here
because that file is read into every OpenSpec generation and had grown past
OpenSpec's 50 KB context limit, at which point the whole field is silently
dropped. Nothing was reworded in the move.

These are DECISIONS, not proposals. Read the relevant section before
designing against its subject rather than re-deriving it. If a fact here
contradicts `openspec/config.yaml`, that is a bug — say so rather than
picking one.

---

## 1. Branch naming, and its lifetime

- Branch naming: `doc/<doc_id>`. The branch name is derived from
  nothing that can drift.
  AMENDED 2026-08-26 — what `doc_id` IS changed; what the branch is
  derived from did not. This previously read "a short opaque identifier
  generated once when the note is created and written to its front
  matter". `doc_id` is now the note's filename, author-composed and
  snapshotted into front matter at FIRST SUBMIT, frozen from that
  moment. See the `doc_id` decision below for why. Note the
  distinction carefully, because it is what keeps the rest of this
  decision true: the branch derives from the FROZEN `doc_id`, never
  from the live filename. An author who renames the file after
  submitting does not rename the branch.
  The human-readable name lives in the merge request TITLE, which is
  what reviewers read in GitLab's UI and which can be updated freely
  when a note is retitled, without touching the branch.
  Rejected, and this rejection STANDS under the amendment: deriving the
  branch name from the note's LIVE title or path. Obsidian users rename
  notes and move them between folders routinely, and either scheme
  stops reproducing the moment they do. A snapshot is not a derivation
  — it is taken once and never re-read. What the amendment does change
  is that an author now hand-composes a ref component, so git's ref
  restrictions (spaces and `~^:?*[\` are illegal) and the ASCII-folding
  that Vietnamese diacritics require are no longer sidestepped by
  opacity; they become validation, at the moment of the snapshot.
- Branch names are reused across a document's lifetime, so `doc_id` to
  merge request is one-to-MANY, not one-to-one. `doc_id` is immutable
  but `doc/<doc_id>` is transient: created at submit, deleted on merge,
  then recreated with the identical name the next time that document is
  revised. There is a SECOND deletion trigger, added 2026-09-09: when a
  merge request is closed without merging, GitLab does not auto-delete
  the branch, so the plugin deletes it itself at the next resubmit before
  cutting fresh — see `openspec/config.yaml`'s branch-recreation decision
  for why the plugin rather than a person, and why it is silent. A living SOP is expected to go through repeated cycles —
  that is what `lifecycle` exists for — so after the first revision
  cycle a query by `source_branch` returns several merge requests: old
  merged ones, and possibly a current open one.

## 2. Reconciliation — reconnecting a note to its merge request

- Reconciliation: a note whose local pointer is missing is reconnected
  by reading `doc_id` from its front matter and querying merge requests
  with `source_branch = doc/<doc_id>`, ALL states, newest first. Resolve
  the result as follows:
    - An open merge request wins if one exists. At most one can, since
      GitLab refuses a second open merge request from the same source
      and target branch, so this match is unambiguous.
    - Otherwise the most recent merge request determines the state:
      merged means published and the branch is already gone; closed
      means not accepted and the branch may still exist.
    - No merge requests at all means the note has never been submitted.
  Do NOT filter the query to open merge requests only. That returns
  nothing for a rejected document, so reconciliation would report it as
  never submitted; the author would then submit, and the call would
  fail because the branch from the rejected cycle is still there.
  Because `doc_id` is committed with the note, a file pulled fresh from
  `main` on a different machine reconciles with no local state at all.
  This matters because plugin data is not reliably synced and does not
  survive a plugin reinstall or a vault restored from backup. Reconcile
  by listing merge requests once and matching every orphan against that
  result locally — one call total, not one per note.

## 3. `doc_id` — what it is, and when it is written

- `doc_id` in front matter is NOT a contradiction of the rule against
  storing submission state there. That rule bans values that change
  every review round and go stale in `main`. `doc_id` is immutable
  identity: written once, never updated, no diff noise.
- `doc_id` IS THE NOTE'S FILENAME, SNAPSHOTTED AT FIRST SUBMIT.
  DECIDED 2026-08-26, replacing "plugin-generated short opaque
  identifier". Recorded at length because it reverses something this
  file argued for hard, and the part of that argument which SURVIVES
  matters as much as the part that changed.
  Why it changed: the team already governs filenames strictly and
  already files them in a nested hierarchy —
  `SBT-KE-001_EG95-mTLS-Socket-Reopen-Error200.md` under
  `Smart Buddy POS/Known-errors/`. A plugin emitting `a7f3k2m9.md` into
  a flat tree would produce a corpus that does not match the repository
  it writes into, bending the team to the tool. Reality intervened,
  which this list's own preamble anticipates.
  WHEN it is written is what makes this safe, and it is not at
  creation. Milestone 3 leaves `doc_id` absent; milestone 4 snapshots
  the then-current filename at first submit. Before the snapshot the
  author renames and moves freely — that freedom is the whole
  ergonomic point of shift-right. After it the value is frozen
  permanently: the handover policy's "`doc_id` IS IMMUTABLE,
  permanently" is unchanged and now has a defined moment of birth.
  REJECTED: letting `doc_id` track the live filename. A rename after
  submit would mint a new `doc_id`, rename the branch, and make
  reconciliation query a branch that does not exist — reporting a
  submitted document as never submitted and splitting its history in
  two, silently. That is the same failure the all-states reconciliation
  rule above exists to prevent, arriving by a different route.
  CONSEQUENCE, and it is real work: the filename must be validated as
  ref-legal before the snapshot is taken — no spaces, none of
  `~^:?*[\`, no leading dot, no trailing `.lock` — and Vietnamese
  diacritics need ASCII-folding that opacity previously made
  unnecessary.
  CONSEQUENCE: hand-picked ids can collide where generated ones could
  not. Two authors independently choosing `SBT-KE-004` produce one
  branch name, and GitLab refuses a second open merge request from the
  same source branch. The collision rule below already requires the
  plugin to detect this and refuse; that rule now covers a likely case
  rather than a rare one.
  THEREFORE, STATED AS A RULE ON THE REPOSITORY rather than only as a
  risk the plugin detects (added 2026-09-15): EVERY DOCUMENT FILENAME
  MUST BE UNIQUE ACROSS THE WHOLE REPOSITORY, not merely within its
  folder, because the folder is not part of `doc_id`. This is a
  correctness requirement, not a style preference — a document whose
  filename is taken cannot be published at all. Observed breaking on
  the real corpus: six of eight refused imports were files sharing a
  basename across folders (`README.md`, `_placeholder.md`). Which one
  won was decided by path sort order and by nothing else. Full analysis
  and the rules a conforming repository follows:
  `docs/document-naming.md`.
- AMENDED 2026-09-14 (add-discover-and-import): `doc_id` is frozen at
  the moment a document's identity becomes fixed — FIRST SUBMIT for a
  document this vault authored, and IMPORT for a document it did not.
  The rule above is unchanged for every document the plugin creates;
  this widens it to cover the one it does not.
  Why the shift-right freedom the bullet above protects does not apply
  to an imported document: its name and path were already decided, on
  the remote, by whoever published it, and §4's refuse-to-move already
  forbids changing them. There is no freedom being taken away, only a
  snapshot being taken of a value that was never in motion.
  What it buys, and the reason it is not merely tidy: an imported
  document with no `doc_id` takes the FIRST-submit path, where
  `checkTargetPathFree` refuses it — a file does exist at its path on
  the default branch, by construction, for every imported document
  (`docs/ce-verification.md` §E3). Freezing the id at import makes the
  first submit a RESUBMISSION, which does not run that check and reads
  the commit verb rather than assuming `create`. Import without this
  produces documents that cannot then be submitted.
  A document being imported that ALREADY carries a `doc_id` — one this
  plugin published, read back from the remote — keeps the value it
  carries. The identity has a birth already; import does not give it a
  second one.
  REJECTED: teaching `checkTargetPathFree` to recognise an imported
  document. It would need a local trace to recognise it BY, which is
  the tracking this amendment adds anyway — arriving at the same place
  having also weakened a guard that is currently exactly right.
- Duplicating a note in Obsidian copies its front matter, so two notes
  can claim the same `doc_id`. The plugin must detect a collision and
  refuse to submit rather than silently commit two files to one branch.
  EXTENDED 2026-09-14: the same collision is now detected at IMPORT
  too, before anything is written, naming the note that already holds
  the id. Detecting it only at submit was far too late for a collision
  the import itself created.

## 4. Paths — vault mirroring, refusing to move, reorganization

- VAULT ROOT = REPO ROOT. DECIDED 2026-08-26, replacing a
  `docs/<category>/<filename>` routing scheme that was in play but was
  never written down here. A note's path relative to the vault root IS
  its path in the repository, mirrored exactly, nested folders and all:
  `Smart Buddy POS/Known-errors/SBT-KE-001_….md` in the vault is that
  same path on the remote.
  Consequence, and the reason to prefer this: the mapping function is
  Obsidian's `TFile.path` verbatim. It is already vault-relative with
  forward slashes, so there is no transformation to get wrong and none
  for the path comparison below to drift against.
  Nothing sweeps the vault. The plugin commits only the file the author
  submitted, plus from milestone 4a the attachments it embeds, so
  templates, personal notes and `.obsidian/` are never pushed by
  accident.
- REFUSE TO MOVE. DECIDED 2026-08-26. When a document's local path no
  longer matches the path it occupies on the remote, the plugin BLOCKS
  the submission and names the path to restore. It does not follow the
  move.
  REJECTED: issuing the commit API's `move` action with
  `previous_path`. It works, and it would be invisible to the author,
  but it widens the write path and the failure surface for v1. Note
  what refusing does NOT save: detecting a mismatch requires knowing
  the remote path either way, so the lookup stays — only acting on it
  goes. The remote path is read from the reconciliation query's merge
  request and its changes, not stored locally; plugin data is not
  reliably synced and does not survive a reinstall, so it is the wrong
  place to keep it.
  ORDER OF CHECKS IS LOAD-BEARING, not stylistic:
    1. duplicate `doc_id` across two notes in this vault → refuse
    2. only then, local path against remote path → refuse
  Reversed, a duplicated note reads as "moved" and the author is told
  to move a file that is already exactly where it belongs.
  Path comparison is CASE-SENSITIVE. `Known-errors/` and
  `known-errors/` are different paths to git and orphan each other, and
  this is the confusing case precisely because Windows and macOS file
  explorers show the author no difference.
  Binds from the SECOND submit onward. A first submit has no remote
  path to drift from, which is what preserves the shift-right
  ergonomics — renaming to the control ID happens before anything has
  been sent.
  The message is author-facing, so the vocabulary ban is in full force:
  it names the path and says nothing about branches or commits.
- REORGANIZING A PUBLISHED DOCUMENT IS OUT OF SCOPE for v1. This is a
  consequence of refusing to move rather than a separate choice, and it
  is recorded so it reads as a decision rather than an omission. An
  author cannot rename, reclassify or relocate a document that has been
  published. The escape hatch is the one this file already uses for
  reviewer edits: a Maintainer performs the move in GitLab's Web IDE
  and the author moves their local copy to match. Because `doc_id` is
  frozen in front matter, the document reconciles afterwards with
  nothing else to do.

---

## 5. Branch recreation — when `doc/<doc_id>` is already taken

Extracted from `openspec/config.yaml` on 2026-09-09, for the same reason
§§1-4 were extracted on 2026-08-26: resolving this decision pushed that
file past OpenSpec's 50 KB context limit, at which point the whole field is
silently dropped rather than truncated. It moved only once it was CLOSED —
`openspec/config.yaml` deliberately keeps OPEN questions, because those
belong where they will be seen. Two forward-references to "the open
sub-question below" were corrected in the move, the resolution below having
made them stale; nothing else was reworded.

- BRANCH RECREATION — FULLY RESOLVED 2026-09-09, for submission-tracking.
  Was an OPEN DESIGN QUESTION until that date; kept in place, answers
  folded in, because the reasoning is what stops it being reopened.
  The question: what happens when the plugin needs to create
  `doc/<doc_id>` and something is already in the way. Two cases,
  deliberately recorded together because they share a trigger and a
  reconciliation query, and answering one without the other will produce
  inconsistent behaviour. Both now end in the SAME action — cut
  `doc/<doc_id>` from current `main` and open a new merge request —
  differing only in whether something must be cleared first:
    1. Rejected, same cycle. RESOLVED 2026-09-09, including the
       sub-question it raised. The merge request was closed without
       merging, and GitLab does not auto-delete the source branch on
       close, so the branch is still alive with the old content on it.
       DECIDED: CLOSED IS TERMINAL. A resubmission after "Not accepted"
       starts a fresh cycle — a new merge request, cut from current
       `main` — and never reopens the closed one.
       REJECTED: reopening the same merge request. It drags the
       rejection discussion into a review of different content, and it
       only works while the source branch survives, so it needs the
       start-fresh path built anyway as a fallback and buys a second
       code path for it. Closing terminally instead leaves the original
       review and its comments intact and readable in GitLab, which is
       the audit trail that mattered.
       CONVERGENCE, and the reason this is the simpler fork: case 1 and
       case 2 now end in the SAME action — cut `doc/<doc_id>` from
       current `main` and open a new merge request. Case 1 differs only
       in what must be cleared out of the way first, answered below.
       Milestone 7 and milestone 7a therefore share
       one write path rather than branching on how the previous cycle
       ended.
       WHO DELETES THE ABANDONED BRANCH: THE PLUGIN DOES, SILENTLY, AT
       RESUBMIT. DECIDED 2026-09-09, closing the last sub-question this
       case had. `doc_id` is immutable, so the fresh branch needs the
       name `doc/<doc_id>` — which the stale branch from the rejected
       cycle still holds. Nothing else can clear it without blocking the
       author, so the resubmit path deletes it and then cuts fresh.
       Sequence, and the order is the whole of it: delete
       `doc/<doc_id>`, then create it again from current `main` with the
       author's revised content, then open a new merge request.
       Needs no new access: deleting a NON-PROTECTED branch is within
       Developer (30) per `docs/gitlab-roles.md` §3, the level creating
       and submitting already require. `doc/<doc_id>` is never
       protected — only `main` is.
       NOTHING REVIEWABLE IS LOST, which is what makes this safe rather
       than merely convenient. GitLab stores a closed merge request's
       diff and its discussion independently of the source branch, so
       the rejected cycle stays readable in GitLab after the branch is
       gone. The only thing destroyed is a draft the author is in the
       act of replacing.
       SILENT ON PURPOSE. The author is not told, asked, or warned. They
       are resubmitting a document that was not accepted; the stale
       branch is an artefact of a mechanism the author-facing vocabulary
       rule forbids naming to them, and there is no decision here for
       them to make. Surfacing it would mean saying "branch" to an
       author to explain a cleanup they did not request.
       FAILURE ORDERING IS DELIBERATE. If the delete succeeds and the
       create then fails, nothing is in the way and a plain retry
       succeeds — strictly better than the reverse order, which cannot
       even be attempted. If the delete itself fails, the resubmit stops
       before writing anything and the author sees the ordinary
       submit-failure message; no `doc_id` moves and no front matter
       changes.
       REJECTED: leaving it for a Maintainer to clear by hand in GitLab,
       the escape hatch orphaned attachments and reorganization use. It
       blocks a rejected author until someone else acts, which is the
       very thing milestone 7a exists to fix and the same bottleneck
       objection that settled the self-merge decision below.
       REJECTED: reusing the stale branch — it splits cases 1 and 2 back
       into two write paths and re-shows already-rejected commits to the
       reviewer. REJECTED: suffixing the new branch `doc/<doc_id>-2` —
       it breaks the rule in `docs/document-identity.md` §1 that the
       branch derives from the frozen `doc_id`, and adds a document-to-
       branch mapping to store and reconcile.
       CONSEQUENCE FOR git-publishing: milestone 7a needs a branch-delete
       method there. It belongs to that capability like every other remote
       call, and its failure classifies through the write path, not the
       read one. 7a no longer INTRODUCES it, though: the
       fix-interrupted-submit change adds `deleteBranch` — the
       capability's first destructive call — because completing an
       interrupted submit needs the same delete for the same reason. 7a
       reuses that method and supplies only the author-facing state and
       action around it.
    2. Published, new cycle. RESOLVED, and owned by milestone 7 as of
       2026-08-26 — this case is no longer part of the open question.
       The merge request merged, the branch was
       auto-deleted, and months later the author revises the document
       and submits again. Nothing is in the way on the remote, but the
       name `doc/<doc_id>` now collides with the history of one or more
       already-merged merge requests. The new branch must be cut from
       current `main`, not from anything cached locally.
       It was recorded here alongside case 1 because the two share a
       trigger and a reconciliation query, and that grouping is still
       why they must stay consistent — but it has no unresolved forks
       of its own. Keeping it filed under an OPEN question made it look
       blocked when it never was, which is how it went unmilestoned.
  Both cases now resolve to the same action; what remains open is only
  case 1's sub-question of who clears the stale branch out of the way,
  stated above. Neither case may assume `doc_id` maps to a single merge
  request over the document's lifetime — that holds for case 2 too, and
  milestone 7 is the first milestone to actually exercise it.
