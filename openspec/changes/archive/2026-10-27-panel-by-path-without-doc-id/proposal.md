## Why

The panel only knows about notes that carry a `doc_id`, a property written into the
note at its first submit. So it cannot show what the author most needs to see: which
notes were never sent, which were moved, which differ from the project. Notes in a
vault folder the author never submitted from (say `L1/`, `L2/`) are simply invisible.
Meanwhile the vault is now the project's working tree, so a note's path in the vault
already *is* its path on the project, and git can say what differs. The property
duplicates what git knows, edits the author's note, and is the only thing standing
between the panel and a plain "status" view.

## What Changes

- **BREAKING** A note's identity is no longer a `doc_id` front-matter property. The
  panel recognises a note as a document by what git knows: its path is on the project
  (published), a send from this vault touched that path (waiting for review), or its
  exact bytes match a version the project or this vault holds at another path (moved).
  Submit stops writing `doc_id` into the note. A note that already carries one keeps
  working: it is read as an alias for the same identity and never rewritten or removed.
- The branch name stays `doc/<id>` with `<id>` derived from the file name at the first
  submit (unchanged), and is remembered by this vault's own `sent/<id>` record. A note
  renamed while its review is open is matched to that record by its bytes, and its next
  submit continues the same branch.
- The panel becomes a status list of the vault against the project: **Not sent yet**,
  **Waiting for review**, **Published**, **Edited**, **Moved**, and files the project has
  that the vault lacks (they come back on Get updates). **Not sent yet** lists every note
  that is not on the project, as git lists new files, whatever its properties.
- Each **Not sent yet** row has a **Submit** button that opens the normal submit dialog,
  which asks for a title and category when the note has none.
- A moved published note is shown as "moved" and is not restored by Get updates (the
  matching rule for that already shipped). Submitting a moved note sends it at its new
  path and removes the old path in the same step, after the author confirms in plain
  words. This is the only case where Submit removes a file from the project.
- Reset, Get updates, and the setup checklist are unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `plugin-shell`: the document list is a status list over the vault (not only notes with
  a `doc_id`), with a Not sent yet section, a Moved status and per-row Submit.
- `submission-tracking`: identity and state are derived from paths and exact content,
  with `doc_id` accepted only as a legacy alias.
- `doc-authoring`: Submit no longer writes `doc_id`; a rename during review continues the
  same branch; a move sends the new path and removes the old one after confirmation.

## Impact

- Code: `plugin-shell/{vault-documents,panel-model,panel-view}.ts`,
  `submission-tracking/{derive-state,derived-states,note-identities,resolve}.ts`,
  `doc-authoring/{submit-plan,submit-document,front-matter,doc-id}.ts`,
  `git-publishing/plumbing-commit.ts` (a commit that removes a path),
  `vault-sync/get-updates.ts` (reuse of the move match), author messages, styles.
- Docs: `docs/document-identity.md`, `docs/document-naming.md`, `plugin/README.md`.
- Order: this change builds on `replace-rest-with-local-git-ssh`, whose delta specs
  introduce the derived-state and sent-record requirements named here. Archive that
  change first (its task 5.8), then archive this one.
- Risk: the panel must know the content identifier of every candidate note, not only
  notes with a `doc_id`, so note reading is cached per file and bounded (see design).
