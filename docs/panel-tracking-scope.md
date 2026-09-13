# Panel tracking scope: milestone 5b (reset) and milestone 9 (discover & import)

Background for two milestones that both reshape what the sidebar panel
tracks and shows, and that directly reference the open questions
`openspec/changes/add-document-recovery/future-work.md` already logged.
Read that file first — this doc picks up exactly where it left off, for the
two threads it names but does not resolve.

## Milestone 5b — Reset, and repurposing "Your documents"

SHIPPED 2026-09-13 (`add-reset-and-panel-scope`). This section described the
design questions before the milestone was built; it now describes what is
actually in the plugin, with the reasoning kept wherever it is what stops a
decision being quietly reversed.

### Reset is Recover's mirror, not a new read

`recoverDocument`/`fetchRecoveryContent` (`plugin/src/submission-tracking/recover.ts`)
already read content three-way at path+ref (found/absent/failed), exactly
`add-document-recovery` design.md decision 2's shape. What distinguishes
Recover from Reset is the overwrite policy, and it is deliberately opposite:

- **Recover** refuses outright when a local file already occupies the
  target path (design.md decision 3) — existence there means something
  else already claims that identity, and recovery must never guess which.
- **Reset** is for exactly the case Recover refuses: the local file IS the
  tracked document, and the point is to discard its local edits and pull
  the remote content back down. Overwrite is not a risk to avoid here,
  it is the requested action.

AS BUILT, the read is a SEPARATE function rather than
`fetchRecoveryContent` reused — `fetchResetContent`
(`plugin/src/submission-tracking/reset.ts`), which asks the document's own
tracked branch and stops there. The earlier expectation recorded here, that
this would be the same read with the inverse write policy, was revised
during design for one reason: `fetchRecoveryContent` falls back to the
default branch when the record's branch answers absent, which is right for
recovering a published orphan and wrong here. A resettable document has a
live branch by definition, so an absent answer means the panel's state is
STALE — the review ended since the last refresh — not that the content
lives elsewhere. Falling back would write content from a different cycle
over local work the author never offered up. Reset refuses and says so
instead. A shared read with a flag was rejected for the same reason: the
flag would be one edit away from being passed wrong.

The remote path is read from the document's merge request rather than taken
from the note's own vault path, per `docs/document-identity.md` §4 — a note
moved locally since submit would otherwise read as absent rather than as
the moved note it is.

The write is `resetDocument` (`plugin/src/doc-authoring/reset-document.ts`),
alongside `recover-document.ts`, guarded on a note actually existing at that
path — the opposite of `recoverDocument`'s guard. It writes the remote's
content verbatim, front matter included, so the note lands byte-identical to
what reviewers are reading. It writes no tracking record, changes no state,
and re-asserts no front matter field: resetting local content changes
nothing about the review.

**SETTLED 2026-09-12, shipped as settled:** Reset applies only to active-MR
states (pending, changes-requested) — not published. A published document
has no live branch to reset against without milestone 7's fresh-cut path
existing first; reading the default branch's current content instead would
be a different, confusingly-same-named operation. Revising a published
document is milestone 7's job, under its own name. A document whose state
has NOT been resolved is not resettable either — offering a destructive
action off an unknown state would act on an assumption nothing established.

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

HOW THAT CONDITION IS HELD IN THE CODE, since "remember to confirm" is not
a durable guarantee: the confirmation modal is private to
`reset-document.ts` and runs INSIDE `resetDocument` itself, which is the
only exported function in the plugin that replaces an existing note's
content. There is no parameter that skips it and no setting that disables
it, so the property survives callers who have never read this file. The
prompt is also unconditional — not suppressed when nothing would be lost —
because Obsidian exposes no signal for that, and diffing local against
remote first would make the prompt conditional, which is one refactor from
the silent path the amendment forbids.

Reset is offered only for the CURRENTLY OPEN note, in `renderSubmitSection`
beside the resubmit action, and never as a per-row control. That is a
safety property rather than a layout choice: requiring the note to be open
means the author is looking at what they are about to discard, so the
confirmation is the second thing guarding a misclick rather than the only
one. There is deliberately no command-palette entry either.

### Repurposing "Your documents" to active-MR states

Shipped as scoped. `renderDocumentList` partitions `listVaultDocuments`
against `this.statuses.statusFor` — no new read, no remote call:

```
Your documents    → never submitted, unresolved, pending, changes-requested
Other documents   → published, not accepted
```

An UNRESOLVED document stays in "Your documents". Moving it would assert
its cycle is over, which is the silent wrongness `add-document-status`
exists to prevent — the same reason its row shows no state label.

"Other documents" is absent entirely when empty, the way "Documents you can
recover" already is, rather than shown with a competing empty state. The
primary section has its own second empty state for the vault whose every
document has finished ("Nothing is waiting for review right now"), since
"Nothing submitted yet" would be false there.

The heading shipped as "Other documents" — the working name, kept, with a
line under it naming what it holds ("Published documents, and documents
that weren't accepted."). The heading stays true as states are added; the
description is what keeps it from reading as a leftovers bin.

What the second section buys is VISIBILITY, not rescued actions. The
resubmit actions for published and not-accepted documents render in the
submit section for whichever note is open — see the corrected premise at
the end of this doc — and no row in either list carries an action.

### The recovery-scope question `future-work.md` already raised

`future-work.md` flagged, as a loose end: *"Whether 'browse and import' and
'recover' should visually live in the same list once both exist... recovery
is 'yours, just misplaced'; discovery is 'not yours, but available.'"*

Narrowing "Documents you can recover" to active-MR orphans only would raise
exactly that question in a sharper form: a **published**-but-locally-deleted
record is currently in that list (it resolves as recoverable via the
stored `path` or the merge-request fallback, `recover.ts:88-114`,
regardless of state). If it were removed because that list now means
"active MR only," does it:

1. **Stay findable through Discover instead** (§ below) once that ships —
   meaning Discover needs to know about `SubmissionStore`'s own records,
   not just diff the vault against the repository tree; or
2. **Disappear from both surfaces** until Discover ships, a real gap for
   anyone who deletes a published note's local copy in the meantime.

DECIDED FOR 5b, 2026-09-13: "Documents you can recover" was NOT narrowed.
It still lists orphaned records in every state, exactly as it did. Option 2
is a live gap with no ship date attached to its fix, and 5b had no reason
to open it. The question itself stays open and still leans toward (1) once
milestone 9 exists, since a published, tracked, locally-missing document
and a genuinely-unknown remote document differ only in whether the plugin
already holds a stored record for it — and `resolveOrphanedRecords`'s
existing logic already knows how to answer that distinction. Flagged for
whoever designs 9.

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

CORRECTED 2026-09-13, after 6/7/7a actually shipped: the premise below
overstated the conflict. It assumed 6/7/7a's actions render as per-row
buttons in "Your documents," so narrowing the list would strand them. They
do not. `renderSubmitSection` renders the resubmit action for the
CURRENTLY OPEN note, keyed off `getActiveFile()`; `renderDocumentRow` has
no action button at all — name, state label, and an "Open in GitLab" link
only. Narrowing the list therefore strands nothing: a published or closed
document's action works the moment its note is open, whatever the list
shows.

What narrowing actually costs is VISIBILITY — the author can no longer see
that a published or closed document exists, or what state it is in,
without opening it. That is a real loss and still justifies a second
section, but it is a weaker and different reason than "the actions lose
their row," and 5b should be scoped against the real one. The decision
below stands; its rationale is amended to this.

SHIPPED 2026-09-13 as decided below.

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
