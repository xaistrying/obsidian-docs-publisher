## Context

`add-document-status` built the first remote READ path: `listMergeRequests`,
the unresolved-threads check, and reconciliation from a note's own
front-matter `doc_id`. All of it answers one question — "what state is THIS
document in" — for documents the vault already has a note for. Nothing reads
a document's CONTENT, and nothing asks the remote about a `doc_id` the vault
has no note carrying at all.

That second gap is this proposal's target, narrowly: not "browse everything
the remote has" (deferred, see `future-work.md`), but "recover the content
of a document this vault's own `SubmissionStore` already knows the identity
of, or that a first submit is about to collide with by accident."

Binding constraints, taken from the reference docs rather than re-derived:

- `docs/document-identity.md` §3: `doc_id` is the note's own filename,
  snapshotted once at first submit, and lives nowhere else. There is no
  registry to consult when the note itself is gone except the plugin's own
  stored record.
- `docs/document-identity.md` §4: vault root is repo root. A note's path
  relative to the vault root IS its path in the repository, verbatim. This
  is what makes "does a file exist at this exact path on the default
  branch" a meaningful, precise question rather than an approximation.
- `docs/document-identity.md` §3's own anticipation of author collision on
  hand-picked ids, quoted in proposal.md — this proposal is that anticipated
  rule's missing half.
- add-document-status's design.md decision 9: transport in `git-publishing`,
  meaning in `submission-tracking`. This proposal inherits the boundary
  rather than re-litigating it.
- `openspec/config.yaml`'s refuse-to-move decision: a document whose local
  path has drifted from its remote one is refused, not moved. Recovery must
  not create a situation that decision would then have to refuse on the very
  next submit — see decision 3 below.

## Goals / Non-Goals

**Goals:**

- A document the plugin already has a stored record for, and whose content
  is still reachable via the API, can have its note recreated verbatim.
- A first-time submit that would silently collide with an already-published
  document is caught before anything is written, not after a confusing
  failure.
- Never guess at a path or at content. Every recovery either reads the real
  thing or refuses and says why.
- Never overwrite. A local note already at the target path stops recovery
  outright.

**Non-Goals:**

- Discovering a document with no local trace at all — no note, no stored
  record. `future-work.md`.
- Keeping a vault continuously current with the whole knowledge base.
- Recovering a record with nothing left on the remote to ask (see proposal
  "Deferred, deliberately").
- Any change to reconciliation, to the states list, or to how "Your
  documents" is built.

## Decisions

### 1. The path is captured going forward; a legacy record falls back to its
merge request's own changed path

`SubmissionRecord` gains `path`, written at submit time alongside `branch`,
`mrIid` and `state`. This is the reliable source whenever it exists.

For a record written before this change ships — which includes every
record that exists right now, since nothing has captured a path before —
recovery falls back to reading the changed-file path off the record's merge
request, when the record's `branch` still has an open one
(`findOpenMergeRequest`, unchanged, already built). This is a deliberate,
narrow fallback and not a general "figure out the path somehow": it works
because a document's merge request today commits exactly one file. If it
touches more than one — which becomes possible the day attachments (4a)
ship — the fallback REFUSES rather than guesses which changed path is the
document's own. Guessing wrong here would recreate the note under a filename
that is not actually its remote identity, silently mismatching the very
`doc_id`-to-path relationship §4 depends on.

A record with no stored path AND no open merge request left (merged or
closed) has nothing on the remote naming its path any more. This is not a
case the fallback degrades into — it is a case recovery cannot enter at all,
stated in the proposal as a real limit rather than smoothed over.

### 2. Content is read through a three-way answer, mirroring `branchExists`

`getFileContent(details, { path, ref })` returns exists-with-content /
absent / failed — the same shape `branchExists` uses and for the identical
reason stated there: a caller deciding whether to proceed must be able to
tell "nothing is there" from "the read itself did not succeed," because one
licenses continuing and the other must refuse. This matters twice here:

- The collision pre-flight reads "does a file exist at this path on the
  default branch." A failed read must refuse the submit, never fall through
  to "must be absent, proceed" — the exact mistake `branchExists`'s own
  design note already calls out as the one that would reintroduce a
  destructive dead end.
- Recovery reads "does this path, on this ref, have content." A failed read
  must not create an empty or partial note.

### 3. Recovery restores to the ORIGINAL remote path, never to a locally
convenient one

`createDocument`'s `freePath` appends ` 1`, ` 2`, … when a name is taken,
because a brand-new blank note has no identity yet — any free path is as
good as another. A recovered note is the opposite: its path is not
incidental, it IS half of its identity under vault-root-is-repo-root (§4),
and the refuse-to-move decision already treats a path that has drifted from
the remote's as something to refuse, not silently correct.

So recovery does not pick a free path — it uses the recovered path exactly,
and if a local note already occupies it, recovery refuses outright rather
than placing the content anywhere else. Placing it elsewhere would "succeed"
today and then get refused by the existing refuse-to-move check on the very
next submit, converting one honest failure now into a more confusing one
later.

### 4. The collision pre-flight asks the default branch directly, not
whether a branch exists

The existing pre-flight (`clearPreviousAttempt`) answers questions about
`doc/<doc_id>` — a branch that may or may not currently exist. That answers
nothing about a document that has already been merged: its branch is gone,
and `branchExists` correctly, faithfully reports absence, which
`clearPreviousAttempt` was built to read as "proceed" — because for THIS
document's OWN prior attempts, absence really does mean nothing is in the
way. The gap is that the same absence is also what a stranger's already-
published document looks like, and nothing before this change asked that
question at all.

The new check is independent of branch state entirely: does `file.path`
exist on the project's default branch, right now? This is strictly
complementary to the existing check, not a replacement for it — an open,
unmerged merge request's content is on its own branch, not yet on the
default one, so the new check correctly answers "no" while the existing
open-merge-request check correctly still catches that case. Order: the new
check runs first, because it is the stronger signal (a real file sitting on
the branch every reader actually sees) and because it is what turns a bare
refusal into an offer to recover.

### 5. The pre-flight runs only when there is no `doc_id` yet

Gated on `readDocId` returning null — the same branch that already produces
`INVALID_FILENAME_MESSAGE` for a ref-illegal filename. A document already
tracked by this vault owns its own path across every revision and cannot
collide with a stranger by definition; asking "does this path already exist
on `main`" for a document's OWN second submit would trivially answer yes
about itself and refuse every legitimate revision. The check only makes
sense at the one moment a `doc_id` is being freshly minted from a filename
with no history behind it yet.

### 6. Recovery is its own module, not folded into reconciliation

`reconcile.ts` resolves STATE for `doc_id`s the vault already has notes for.
This proposal resolves CONTENT for `doc_id`s the vault does NOT have notes
for. Different question, different remote calls, different failure modes —
folding them together would make one file answer two questions that happen
to share a `ClientResult` shape and nothing else. `recover.ts`, alongside
`reconcile.ts`, keeps `submission-tracking`'s file structure legible: one
file per direction of "what does the remote know."

### 7. The panel's new section is built from local data only; a network
call happens per row, on request

"Documents you can recover" is `SubmissionStore`'s keys minus
`listVaultDocuments`'s keys — a local set difference, costing nothing.
Fetching content happens only when the author presses Recover for one
specific row, exactly matching add-document-status's decision 5 (render from
what's known, refresh only on explicit request) — extended here to a
per-row explicit request rather than a whole-panel one, since recovering one
document has no reason to imply anything about the others.

## Risks / Trade-offs

**A legacy record's fallback silently stops working once attachments
ship** → Accepted, and it fails the SAFE way: refusing recovery for a
multi-file merge request rather than guessing, per decision 1. Worth
revisiting once 4a lands, not before.

**Two authors independently landing on the exact same filename is now a
hard stop instead of two competing writes** → This is the fix working
as intended, not a cost — GitLab was already going to refuse the second
`create` today; this proposal only moves the refusal earlier and makes it
legible instead of generic.

**A record recoverable today (open merge request, changed-path fallback
works) may not be recoverable after that merge request merges or closes,
if the author waits** → True, and unavoidable without a stored path — this
is exactly why `path` is captured going forward, so the window shrinks to
zero for every submission made after this ships. Worth stating in whatever
setup guide exists, so an author who spots an orphaned row is not
surprised recovery is available today and gone next week.

## Open Questions

- Should a record recovered from the legacy fallback (no stored `path`) have
  its `path` backfilled once recovery succeeds, so a SECOND accidental
  deletion of the same note recovers via the fast path next time? Leaning
  yes — it costs nothing and the information is already in hand at that
  point — but not decided here, since it is a one-line addition to whichever
  file ends up writing the record and better decided at implementation time
  against the actual write path's shape.
- Exact wording for the collision-refusal and recovery-unavailable messages
  is not fixed here — vocabulary-checked against the same ban as everywhere
  else (no "branch", "commit", "merge request", "MR", "conflict", "main"),
  left to specs/tasks so the actual sentences get the same scrutiny prior
  copy did rather than being frozen prematurely in a design doc.
