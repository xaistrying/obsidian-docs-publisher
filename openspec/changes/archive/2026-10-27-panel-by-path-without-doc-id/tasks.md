## 1. Shared matching

- [x] 1.1 Move the moved-note matcher out of `vault-sync/get-updates.ts` into its own module (absent project path, exact bytes at a path the project lacks); Get updates uses it unchanged; add its own tests
- [x] 1.2 `note-identities.ts`: cache content identifiers for all candidate notes (markdown, not hidden, not reserved) keyed by path with `mtime`/`size`; lazy, bounded; tests for reuse and for a changed file
- [x] 1.3 `derive-state.ts`: resolve a note to a document by the order in design D1 (legacy `doc_id`, path on the project, send record's path, exact content match); two candidates at a step give none; unit tests for each step and for ambiguity
- [x] 1.4 Read the send record's path from the recorded commit (design D3); test with a send, a rename, and a second vault with no record

## 2. Panel

- [x] 2.1 `vault-documents.ts`: list documents by D1, not by front matter alone; keep legacy `doc_id` as an alias
- [x] 2.2 `panel-model.ts`: statuses Not sent yet, Waiting for review, Published, Edited, Moved; moved marker beside the state label; tests for every status and combination
- [x] 2.3 "Not sent yet" section: every note not on the project, collapsed by default, count in the heading, rows with name, folder and Submit; empty message; hidden and reserved folders never counted (the title and category filter was removed 2026-10-27, design D5)
- [x] 2.4 Panel's waiting-updates count uses the shared matcher so a moved note is not counted (design D7)
- [x] 2.5 Author messages in `author-messages.ts` for every new string (author vocabulary ban holds); styles for the new rows

## 3. Submit

- [x] 3.1 Stop writing `doc_id` on submit (`front-matter.ts`, `submit-document.ts`); keep completing `title`, `category`, `owner`; tests that no property is added and that an existing one is untouched
- [x] 3.2 Identity for a note matched by D1: continue the document's branch after a rename; first submissions still derive from the file name
- [x] 3.3 `plumbing-commit.ts`: a commit that adds a new path and removes the document's old path only (design D4); never removes attachments; tests with real git
- [x] 3.4 Move confirmation dialog in plain words; declining sends nothing; a new path already held on the project is refused with the existing message
- [x] 3.5 Stale guard for a move: the project's copy at the old path must equal the vault's last known version

## 4. Docs and checks

- [x] 4.1 Amend `docs/document-identity.md` (identity and the `doc_id` decision) and `docs/document-naming.md` where they assume the property; update `plugin/README.md`
- [x] 4.2 Measure first open on a vault of several thousand notes; record the result in design.md
- [x] 4.3 Typecheck, full test run, vocabulary scan, `openspec validate --strict`
- [x] 4.4 Manual check in Obsidian: notes in untouched folders, a rename, a move, a move with an edit, a submit from a Not sent yet row, a confirmed move
- [x] 4.5 After `replace-rest-with-local-git-ssh` is archived, archive this change
