## Why

Submitting a document makes it vanish from the panel. The author's primary
list, "Your documents", has held only work owed since the 2026-09-22
narrowing, so a document that is waiting for review and untouched is not in
it. Nothing on screen says where the document went. Recorded as a UX signal
in `docs/ce-verification.md` §D0a. It was masked until `fix-edited-baseline`,
because every submitted document wrongly read as edited and stayed listed.
With that fixed, the vanishing happens on every submit, and on 2026-09-27 it
read to the author as a failed submit.

The heading makes it worse. "Your documents" reads as "all of my documents",
so a document of yours that is missing from it looks like a bug rather than
like the rule working.

## What Changes

- **"Your documents" is renamed "Needs you".** Its contents do not change:
  `needsAuthor` still decides membership. The heading now names the rule, so a
  document missing from it no longer reads as a bug.
- **A new "Waiting on reviewers" section** lists documents waiting for review
  with no unsent edits. It is collapsed by default, and its heading still
  shows its count. A submitted document now moves from one section to the
  other rather than disappearing, and the count going up confirms the submit
  landed.
- **Both headings name who acts next**, so every document the panel lists is
  in exactly one of them. A published document with no unsent edits has no
  next actor and is in neither, as today. The 2026-09-22 decision not to list
  a roll-call of settled documents stands.
- **The "Needs you" empty state is reworded.** "Nothing is waiting for review
  right now" becomes false once untouched documents under review have a
  section of their own.
- **`specs/plugin-shell` is brought up to date for the document list.** Its
  two list requirements still describe the superseded pre-2026-09-22 panel: a
  primary section plus an "Other documents" section, with the rule that no
  document ever leaves view. This change has to restate both requirements
  anyway, and it restates them against the panel as built.

**Deferred (explicitly not in this change):**

- The "Documents you can restore" requirements in `specs/plugin-shell` are
  also stale, in two ways:
  - they still describe the orphaned-record list with three empty cases;
  - they don't record its narrowing to documents under review.

  That is a different section with no behaviour change owed, so it is a
  separate spec-only retrofit.
- Any change to what counts as "needs the author". `needsAuthor` is kept
  exactly as it is.
- Remembering collapsed sections across sessions. The view's collapsed set
  stays session-only, as recorded where it is defined.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `plugin-shell`:
  - **"The panel lists the author's documents with their current state":**
    documents with no next action (published and untouched) are now
    deliberately not listed. The current rule that no document leaves view is
    retired. This restates, rather than replaces, `fix-edited-baseline`'s
    tightened version of the same requirement: labels stay additive.
  - **"The panel separates documents with an open review cycle from the
    rest":** becomes a split by next actor, into "Needs you" and "Waiting on
    reviewers".

## Impact

- `plugin/src/main.ts`:
  - `DOCUMENTS_HEADING` and the empty-state constants;
  - `partitionDocuments`, which splits into three groups instead of two;
  - `renderDocumentList`;
  - a new section key, seeded into `collapsed`.
- `plugin/src/submission-tracking/document-status.ts`: possibly one
  classifier beside `needsAuthor`, if the partition's rule is moved there so
  it can be tested.
- `openspec/specs/plugin-shell/spec.md`: via this change's delta.
- `docs/ce-verification.md`:
  - §D0a, which then describes behaviour that no longer exists;
  - D9's "Your documents holds work owed" check, whose headings and empty
    states change.
- `docs/panel-tracking-scope.md`: its "Your documents" wording.
- **Depends on `fix-edited-baseline` being archived first.** Both modify the
  same `plugin-shell` requirement, and this delta is written on top of that
  one.
