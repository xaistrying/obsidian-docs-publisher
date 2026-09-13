## Why

"Your documents" lists every note in the vault carrying a `doc_id`, in
every state, forever. A knowledge base that works accumulates published
documents, so the one list an author checks to see what needs their
attention fills up with documents that need nothing from anyone. The
active review cycle — the only part with an action pending — gets buried
under its own history.

Separately, an author who has edited a document that is under review has
no way back. Their local note has drifted from what reviewers are looking
at, and nothing in the plugin restores it. Milestone 5a can recreate a
note that was DELETED, but refuses outright when the note is still
there — which is exactly the case here.

These ship together because they are one surface with one meaning. Reset
applies precisely to the states "Your documents" is being narrowed to, and
the narrowing is what gives that list a definition worth having: documents
with an open review cycle, which are the documents the author can act on
right now. Scoping the narrowing without Reset would produce a list
defined by what it excludes rather than what it offers.

## What Changes

- **Reset** — for a document whose resolved state is pending or
  changes-requested, the author can discard local edits and restore the
  note to the content currently on that document's own tracked branch.
  - It SHALL ask for confirmation before every overwrite, with no silent
    path. This is not a UX preference: it is the condition under which
    `openspec/config.yaml`'s NO CI PIPELINE decision exempts Reset from
    its own "a pull mechanism must refuse while a document is awaiting
    review" rule. A no-confirm variant would be the exact case that rule
    exists to prevent.
  - Published and closed documents are out of scope for Reset. A
    published document has no live branch to reset against, and revising
    one is milestone 7's job under its own name.
- **"Your documents" narrows** to documents with an open review cycle
  (pending, changes-requested). Documents resolved as never-submitted
  continue to appear, as they do today.
- **A second "Other documents" section** lists published and not-accepted
  documents still present in the vault, at lower prominence. This
  preserves visibility of documents the narrowing removes from the main
  list — the author can still see that a published document exists and
  what state it is in, without opening it.

### Corrected premise, recorded because it changed this change's shape

An earlier note in `openspec/config.yaml` and
`docs/panel-tracking-scope.md` said this change had to RELOCATE milestone
6/7/7a's resubmit actions out of the narrowed list, on the assumption they
render as per-row buttons. They do not. `renderSubmitSection` renders the
resubmit action for the currently open note, keyed off the active file;
`renderDocumentRow` carries no action button at all. Narrowing the list
strands nothing, and no action needs moving. Both notes have been
corrected. What the narrowing actually costs is visibility, which is what
"Other documents" is now scoped to solve.

### Deferred, deliberately

- **Milestone 9 (Discover & Import)**, and the still-open question of
  whether "Other documents" eventually folds into it. This change builds
  "Other documents" as its own section; 9 absorbing it later is a merge,
  not a rebuild.
- **Narrowing "Documents you can recover"** to active-MR orphans. It keeps
  listing orphaned records in every state, exactly as it does today —
  narrowing it would drop published-but-locally-deleted documents off
  every surface until milestone 9 ships.
- **Reset for published or closed documents**, per above.
- **Milestone 3a** (default directory) and **milestone 8** (Merge).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `submission-tracking` — gains the content read Reset needs, against the
  document's own tracked branch, and the rule for which states can be
  reset at all.
- `doc-authoring` — gains the local overwrite write path and its mandatory
  confirmation. This is the mirror of recovery's write, with the opposite
  guard: recovery refuses when a note occupies the path, Reset requires
  one to.
- `plugin-shell` — the panel's document list narrows, a second section
  appears, and the Reset action is offered where it can succeed.

## Impact

- `plugin/src/submission-tracking/recover.ts` — the branch-ref content
  read Reset reuses or narrows from `fetchRecoveryContent`.
- `plugin/src/doc-authoring/` — the overwrite write path, alongside
  `recover-document.ts`, which already owns the non-overwriting twin.
- `plugin/src/main.ts` — `renderDocumentList` (narrowing), a new
  "Other documents" section, and the Reset control.
- `plugin/styles.css` — the second section's lower-prominence styling.
- `openspec/config.yaml`, `docs/panel-tracking-scope.md` — milestone 5b
  marked done once shipped.
