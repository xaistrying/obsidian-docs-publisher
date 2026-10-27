## Context

`replace-rest-with-local-git-ssh` (not yet archived) makes the vault the project's
working tree and derives every state from git (its D8). It still keys a note to its
document by a `doc_id` property written at first submit (its D8/D16,
`docs/document-identity.md` §1). Manual testing showed the cost: notes never sent are
invisible in the panel, and a moved note needed a rule of its own in Get updates. The
vault path equals the project path, and Get updates already treats a missing file whose
exact bytes sit elsewhere as a move. This change finishes that idea for the panel and
for Submit.

## Goals / Non-Goals

**Goals**
- The panel is a status view of the vault against the project, including notes never sent.
- No `doc_id` is written into notes. Existing ones keep working.
- A rename or move keeps a note tied to its document when its bytes are unchanged.

**Non-Goals**
- No similarity (rename-detection) matching. Exact bytes only.
- No change to Reset, Get updates, or setup.
- No new stored state: nothing is kept outside git refs this vault already writes.

## Decisions

### D1. Identity is derived, in a fixed order
Order: legacy `doc_id` in the note, else the project's file at the note's path, else the
send record that touched the note's path, else an exact content match against a version
this vault knows at a path now absent from the vault. First step that yields exactly one
document wins; two candidates at a step yield none (the existing "more than one counts
as none" rule from D8).
*Rejected:* similarity matching (a wrong guess ties a note to someone else's review).
*Rejected:* keeping `doc_id` and only adding the status list (leaves the duplicate
source of truth and the edit to the author's note).

### D2. The branch identity is still derived from the file name at first submit
`doc/<id>` and `sent/<id>` keep their names, so nothing already pushed changes and the
naming rules in `docs/document-naming.md` stand. After that, the identity is not
re-derived from the live file name: a note matched to a document by D1 uses that
document's id, so a rename does not rename the branch.

### D3. The send record's path is read from the commit, not stored
`sent/<id>` points at a commit built by this vault. The path of the send is read from
that commit: a `Docs-Publisher-Note: <path>` line in its message, which every send now
writes, and for a commit without one (an earlier send) the one markdown file it changed
(already how `changedFiles` finds a branch's document). The line is needed because a send
that changed only an image changes no markdown file. It shows in the review's description
on GitLab. No new ref or file is added; reading is cached by commit, which never changes.

### D4. A move on the project is a commit that removes one path and adds another
`plumbing-commit.ts` currently only adds or replaces (design D5 step 4a "never
deletes"). A move needs one controlled removal: `update-index --force-remove` of the old
path in the throwaway index, only for the document's own old path and only after the
author confirms. Attachments are never removed. The lease and stale guards are unchanged;
the stale guard additionally requires the project's copy at the old path to equal the
vault's last known version, so a move cannot discard someone else's later edit.

### D5. "Not sent yet" lists every note that is not on the project
Decided 2026-10-27 after testing: a first version filtered to notes with `title` and
`category` and counted the rest in a muted line, and the author never saw their `L1/` and
`L2/` notes because they lacked those properties and the line was hidden while the section
was collapsed. The panel is a status view, so it lists what git would list as new. The
section is collapsed by default and shows its count, which keeps a large vault tolerable;
Submit asks for a title and category when a note has none. *Rejected:* the filter (hides
the very notes the author is looking for); a separate "other notes" count (the same
information in a place nobody opens).

### D6. Content identifiers are cached for all candidate notes
The panel needs the blob id of every note not on the project, plus those that moved. The
cache in `note-identities.ts` is keyed by file path and `mtime`/`size`, filled lazily in
the background, and only for notes that could matter: markdown, not hidden, not under the
reserved folders. A note whose identifier is not known yet is not matched by D1 step 4
and shows no moved marker until it is.

### D7. Get updates and the panel share one move matcher
The matcher added to `get-updates.ts` (absent project path, exact bytes elsewhere in the
vault at a path the project lacks) moves into a small module used by both, so the
panel's "waiting updates" count and Get updates agree. Today the count includes a moved
note as one update that Get updates then does not apply.

## Risks / Trade-offs

- **Move plus edit** looks like a deletion plus a new note. Get updates restores the
  original and the edited note is "Not sent yet"; submitting it is a first submission and
  is refused if its derived identity is taken. Mitigation: the refusal message already
  tells the author what to do; a later change could offer "this looks like X".
- **Large vaults.** Hashing every candidate note costs time on first open. Mitigation:
  D6 caching and laziness. The task list measures it on a vault of several thousand notes.
- **Two vaults, one document.** A second vault without the send record derives identity
  from paths only and cannot show a move it never saw. Acceptable: moves are local facts.
- **A removal in a commit** is the one place Submit deletes. Guarded by confirmation, by
  being limited to the document's own old path, and by the stale guard in D4.

## Migration Plan

Nothing to migrate. Notes with a `doc_id` keep it; new submits stop adding it. No ref is
renamed. `docs/document-identity.md` gets an amendment banner and `design.md` D8/D16 of
the earlier change get a pointer here when both are archived.

## Measurements

Task 4.2, 2026-10-26, on a development machine (Linux under WSL2, local disk, notes of
about 3 KB each, the vault matching the project except 100 notes moved and 100 never
sent; reads go through Node's file API, not Obsidian's, so the first-read figure is a
floor and not what Obsidian on Windows will give):

| Notes | Derive every document (`deriveStates`) | First read of every note | One panel draw (resolve every note) |
|---|---|---|---|
| 5,100 | 56 ms | 283 ms | 31 ms |
| 15,100 | 176 ms | 869 ms | 77 ms |

Both runs found exactly the 100 moved notes and the 100 never-sent ones. The first read
runs in the background in batches of 50, yielding between batches, so the panel fills in
while it goes. A draw resolves every note and runs on each note switch and edit; at 15,000
notes it is under 100 ms, so nothing is memoised. If a larger vault or a slower disk makes
that visible, resolve only when the derived states or the set of notes changes.

## Open Questions

- ~~Should a published note that was moved be sendable at all in this change, or should
  "Moved" be display-only first?~~ Decided with the owner (2026-10-26): sendable, with
  confirmation, as the proposal says. A move is a status git can track, so Submit sends
  it like any other change.
- Should "Not sent yet" group its rows by folder once it is long? A vault with hundreds of
  unsent notes (templates, assets notes) makes a flat list tedious. Not decided; flat for now.
