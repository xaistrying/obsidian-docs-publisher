## Why

Every submitted document reads **"Edited — not sent yet"** from the moment it
is submitted, on a note nobody has touched. The panel's list therefore cannot
display a state for any document — the label it shows instead is the edited
marker — and the list is the surface the document-status milestone was built
to produce.

Found during `verify-against-target-instance` and written up as
`docs/ce-verification.md` §D0b, where the author reported it as confusing UI
before it was traced. It is one root cause with three symptoms, and it blocks
D1, D8 and D9 of that run from being readable at all: those checks ask what
the list says, and the list says the same thing whatever the review does.

## What Changes

`hasLocalEdits` is `file.stat.mtime > record.mtime`. The baseline it compares
against is **written in three places and maintained in none.**

- **Reset stops leaving a false edit behind.** `restoreDocument` writes the
  remote's content and deliberately writes no tracking record, so the write
  bumps the note's mtime while the baseline stays where the last submit left
  it. Every reset reads as an edit — on the one note guaranteed to match the
  review byte for byte. The fix refreshes the baseline **without** touching
  state, branch or path, which are what "writes no tracking record" exists to
  protect.
- **Submit stops recording a baseline that is one write behind.** Both submit
  paths read `file.stat.mtime` immediately after their front-matter write,
  intending "the note as it now stands on disk". `TFile.stat` is Obsidian's
  cached stat and can still hold the pre-write value at that instant, so the
  baseline lands stale and the note reads as edited immediately. The fix takes
  the baseline from a source that reflects the write.
- **The edited marker stops hiding the state.** `renderDocumentRow` shows
  `EDITED_LABEL` *instead of* the state's label, on the reasoning that the
  state "is not the reason this row is in the list". That rule was written
  assuming `edited` is rare. It has never been rare, so the precedence has
  never been tested against its own premise — this change re-decides it now
  that the premise will hold.

**Not in scope:** the panel's 2026-09-22 narrowing (`needsAuthor`, the removal
of "Other documents", the restore list's narrowing to documents under review)
is uncommitted work carrying no OpenSpec change, and `specs/plugin-shell` still
describes the superseded two-section panel. That drift is real and needs its
own retro-change; this change neither depends on it nor fixes it. The
requirement modified below is violated under either panel design.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `plugin-shell`: the requirement that each listed document shows its current
  state's label currently permits a marker to replace that label. It is
  tightened so a document's state is always visible, and so the edited marker
  is additive rather than a substitute.
- `submission-tracking`: the edit baseline gains a requirement of its own. It
  is currently an unowned field — written by whoever happens to write a record
  and corrected by nobody — and every symptom above follows from that. The
  rule is that any operation which changes a note's content on the author's
  behalf leaves the baseline describing what it wrote.
- `doc-authoring`: Reset's "SHALL NOT write a tracking record" is narrowed to
  what it was protecting — state, branch and path — so that refreshing the
  edit baseline is permitted and required. Left as-is, the spec forbids the
  fix.

## Impact

- `plugin/src/submission-tracking/document-status.ts` — `hasLocalEdits`, and
  whatever the baseline becomes.
- `plugin/src/doc-authoring/submit-document.ts` — both baseline writes.
- `plugin/src/doc-authoring/import-document.ts` — the third baseline write.
- `plugin/src/doc-authoring/reset-document.ts` — must now maintain it.
- `plugin/src/main.ts` — `renderDocumentRow`'s label precedence.
- `docs/ce-verification.md` §D0 — the findings are struck when this ships, and
  D1, D8 and D9 become readable.
