# Panel tracking scope: milestone 5b (reset) and milestone 9 (discover & import)

Background for two milestones that both reshape what the sidebar panel
tracks and shows, and that directly reference the open questions
`openspec/changes/add-document-recovery/future-work.md` already logged.
Read that file first — this doc picks up exactly where it left off, for the
two threads it names but does not resolve.

## Milestone 5b — Reset, and repurposing "Your documents"

### Reset is Recover's mirror, not a new read

`recoverDocument`/`fetchRecoveryContent` (`plugin/src/submission-tracking/recover.ts`)
already do the read this needs: three-way content at path+ref
(found/absent/failed), exactly `add-document-recovery` design.md decision 2's
shape. The only thing distinguishing Recover from Reset is the overwrite
policy, and it is deliberately opposite:

- **Recover** refuses outright when a local file already occupies the
  target path (design.md decision 3) — existence there means something
  else already claims that identity, and recovery must never guess which.
- **Reset** is for exactly the case Recover refuses: the local file IS the
  tracked document, and the point is to discard its local edits and pull
  the remote MR's content back down. Overwrite is not a risk to avoid here,
  it is the requested action.

So this is the same `fetchRecoveryContent` read, reused with the inverse
write policy — not a new remote capability. What's new is the write path
(a local overwrite, guarded on "does a note actually exist at this path
locally," the opposite guard from `recoverDocument`'s) and the ref to read
from: Reset should almost certainly read from the record's own tracked
`branch`, not fall back to the default branch the way recovery's
`fetchRecoveryContent` does for the published-orphan case — a **published**
document has nothing left to "reset" to that differs from its own local
content in the ordinary case, and if it does differ, that is milestone
7's resubmit territory, not this one's.

**SETTLED 2026-09-12:** Reset applies only to active-MR states (pending,
changes-requested), as originally scoped — not published. A published
document has no live branch to reset against without milestone 7's
fresh-cut path existing first; reading the default branch's current
content instead would be a different, confusingly-same-named operation.
Revising a published document is milestone 7's job, under its own name.

**Also settled, amending `openspec/config.yaml`'s NO CI PIPELINE decision:**
that decision's "a pull mechanism must refuse while a document is awaiting
review" governs an IMPLICIT/automatic pull, not an explicit one — Reset is
exactly the case that rule anticipated a name for and didn't have. Reset is
exempt from it on one condition that keeps the exemption safe: **it MUST
ask for confirmation before every overwrite, with no silent path.** The
risk that rule actually guards against is silent loss of local edits, not
the fact of overwriting per se — see `openspec/config.yaml`'s amended text
for the reasoning. Do not build a "reset without asking" variant later
under an efficiency argument; that would be exactly the case the original
rule was written to prevent.

### Repurposing "Your documents" to Pending-only

Today `renderDocumentList` (`plugin/src/main.ts:433-467`) lists every
vault note carrying a `doc_id`, in every state. Narrowing it to
active-MR states only (pending, changes-requested) is a filter on data
this code already has — `listVaultDocuments` plus `this.statuses.statusFor`
— not a new read. The real design work is what happens to the states this
removes from view:

- **published**, still present locally: needs *some* surface, since the
  author still opens and edits it. If "Your documents" drops it entirely,
  where does its Reset/Revise action live?
- **closed** ("Not accepted"), still present locally: same question —
  7a's resubmit action needs a row somewhere.

**This doc does not resolve that** — it is a genuine fork, not an
oversight, and should be decided alongside milestone 7/7a's panel wiring
(`docs/resubmission-lifecycle.md` §4), not independently, since both land
in `renderDocumentRow`.

### The recovery-scope question `future-work.md` already raised

`future-work.md` flagged, as a loose end: *"Whether 'browse and import' and
'recover' should visually live in the same list once both exist... recovery
is 'yours, just misplaced'; discovery is 'not yours, but available.'"*

Narrowing "Documents you can recover" to active-MR orphans only (matching
this milestone's framing of the panel as pending-focused) raises exactly
that question in a sharper form: a **published**-but-locally-deleted
record is currently in that list (it resolves as recoverable via the
stored `path` or the merge-request fallback, `recover.ts:88-114`,
regardless of state). If it's removed from "Documents you can recover"
because that list now means "active MR only," does it:

1. **Stay findable through Discover instead** (§ below) once that ships —
   meaning Discover needs to know about `SubmissionStore`'s own records,
   not just diff the vault against the repository tree; or
2. **Disappear from both surfaces** until Discover ships, a real gap for
   anyone who deletes a published note's local copy in the gap between
   this milestone and milestone 9.

Leaning toward (1) once milestone 9 exists, since a published, tracked,
locally-missing document and a genuinely-unknown remote document differ
only in whether the plugin already holds a stored record for it — and
`resolveOrphanedRecords`'s existing logic already knows how to answer that
distinction. Not decided here; flagged for whoever designs 5b and 9
together.

## Milestone 9 — Discover & Import

Restating `future-work.md`'s framing, since it is the starting point:

```
RECOVERY (5a, built)                DISCOVERY (this milestone)
starts from a doc_id the            starts from nothing — no doc_id,
plugin already has a trace of        no record, no note to key off
        │                                    │
        ▼                                    ▼
  "I know this exists,                "I don't know this exists,
   just need its content"              I don't know its doc_id,
                                        I don't even know to look"
```

### What it needs, per future-work.md, unchanged

- A repository browse (`GET /projects/:id/repository/tree`, recursive),
  bounded and honest about the bound the same way `listMergeRequests`
  is (`docs/document-identity.md` §2 and add-document-status design.md
  decision 2) — reaching the cap reports `truncated`, never a silent
  partial answer.
- A local diff: vault paths vs. repository tree paths, by path — the one
  thing guaranteed comparable under vault-root-is-repo-root
  (`docs/document-identity.md` §4).
- A picker, likely tree-shaped rather than a flat list, matching how this
  corpus is actually organized (nested category folders).
- **A duplicate-`doc_id` check at import time, not only at submit time.**
  `docs/document-identity.md` §3 requires detecting a duplicate `doc_id`
  across two local notes, but today that check only ever runs at submit —
  nothing runs it at Recovery or would run it at Import. An imported
  document's `doc_id` (baked into its front matter by whoever originally
  submitted it) could collide with an unrelated local note's hand-picked
  one; import must check for this and refuse, the same way submit does,
  before writing the note.
- **The remote path, never the configurable default directory.** Milestone
  3a's default-folder setting is for brand-new, identity-less documents
  only. An imported document already has a remote identity — its path IS
  half of that identity (`docs/document-identity.md` §4) — so Import must
  write to that exact path, verbatim, the same rule Recovery's design.md
  decision 3 already established. The two settings must never be wired
  together.

### The legacy-content question — STILL UNANSWERED, check before scoping further

`future-work.md` raised this and it has not been checked against the
actual target project since: **does every file in the target GitLab
project already carry this plugin's front-matter contract** (`doc_id`,
`title`, `category`, `owner`, `created`, `last_reviewed`, `lifecycle`)? If
the corpus predates the plugin, or anyone has ever edited a file directly
in GitLab's web UI, Discover has to handle content with none of that — no
`doc_id` to freeze, no category to assign, possibly not even valid YAML
front matter. That is a materially larger feature (adopting foreign
content, backfilling required fields) than pulling down something this
tool already wrote in its own shape. This is the single fact most likely
to change this milestone's size, and it is answerable by looking at the
actual project rather than reasoned about further here.

### Import, not sync — the boundary stays where future-work.md drew it

`openspec/config.yaml`'s no-CI decision reasoned that an automatic pull
that refuses on a local/remote difference deadlocks the moment the
difference is the pull's own prior write, and that whole-file commits (no
diff, no merge) make any automatic pull risky. That reasoning is about
CI-driven writes specifically, but the shape of the problem — whole-file
overwrite, no diffing — applies to any automatic pull, including a
human-scheduled one. Milestone 9 stays on the safe side of that line as
long as it is strictly author-triggered, one document (or an explicit
"add all" batch) at a time, same trust model as Recover. **"Sync" in this
milestone's name should not come to mean "keep the vault continuously
current without being asked"** — if that is ever wanted, it is a
separate, materially riskier proposal, per future-work.md's own framing.

### Where it lives in the panel

`future-work.md`'s open question, restated: does Discover belong in
`plugin-shell` as a new view, or as a mode of the existing sidebar panel?
The existing panel is already dense — connection state, actions, the
document list, recovery — and a full repository browser competing for the
same vertical space as milestone 5b's narrowed, pending-focused list is
worth deciding together rather than bolting on separately.

## RESOLVED 2026-09-12 — the panel-scope conflict between ideas 2 and 3

5b narrows "Your documents" to active-MR states (pending,
changes-requested) only. Milestones 6/7/7a need an author-facing action
for EVERY tracked state, published and closed included
(`docs/resubmission-lifecycle.md` §4) — narrow the list on its own and
those two actions lose the row they'd be pressed from. Discover (9) was
floated as where published/closed documents could live instead, but 9 may
not ship before or with 5b, and an imported (necessarily *published*)
document would vanish from every surface the instant Import finished,
defeating Import's own purpose. This was idea 3 (narrow the panel) and
idea 2 (act on every tracked state) pulling in opposite directions on one
list, sharpened by idea 1 not being guaranteed to exist yet when 5b ships.

DECIDED: 5b adds a SECOND, lower-prominence section — not "Your
documents," working name "Other documents" — for published and closed
records still present locally. 6/7/7a's actions render there. "Your
documents" itself narrows to active-MR states exactly as scoped. This
unblocks 5b and 6/7/7a without betting their shipping on milestone 9's much
larger scope, and it is a strict subset of what 9 would eventually need
anyway (a list of tracked-but-not-pending documents) — 9 folding "Other
documents" into Discover later is a merge, not a rebuild.

REJECTED: sequencing 5b's narrowing after 9 ships — clean end state, but
ties a small, well-scoped panel change to a much bigger, less-defined
milestone and delays 6/7/7a's own panel wiring for no necessary reason.
REJECTED: leaving "Your documents" state-agnostic and only reordering it —
avoids the conflict by not narrowing at all, which is not what was asked
for.

## Other open questions for whoever proposes 5b and 9

- Has the legacy-content question been checked against the actual target
  project yet? (9)
- Does Discover get its own panel surface or share the existing one? (9)
- No permission spike has been run for the repository-tree endpoint —
  same treatment as everything else once this becomes real: add it to
  `docs/ce-verification.md` rather than assuming (carried from
  future-work.md, still true).
