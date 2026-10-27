# Release checks still to run

Left over when the changes `replace-rest-with-local-git-ssh` and
`panel-by-path-without-doc-id` were archived (2026-10-27). Everything the
automated tests can say is said (the suite runs against real git and a stand-in
SSH server); these are the checks that need something the tests cannot supply.
None of them has a recorded result. Record each result in the file named beside
it, not here.

## Already seen working, on the author's own vault in Obsidian (2026-10-27)

Connect, the panel's groups and rows, New and Waiting lists, Submit of a new note,
Send update, Reset, Get updates bringing back a deleted note, a rename redrawing
the panel, and a before/after checksum of 198 files after a session with no file
changed except by the author or an update (`plugin/scripts/vault-checksum.sh`).

## Still to run

| Check | Needs | Where to record |
|---|---|---|
| Windows: a fresh vault goes from nothing to "Ready", steps 1–15 | A Windows PC with Git for Windows | `docs/ssh-setup.md` §2 results table |
| GitLab's real behaviour: a push opens a review request, the source branch is removed on merge, sending twice makes no duplicate, the link-only reply, the exact error lines (key rejected, project not found, access forbidden) | A scratch project on the real GitLab | `docs/ce-verification.md` §F; then replace the stand-in fixtures in `tests/push.test.ts` |
| Another account pushes to a review branch: the next Send update says "The version under review has changes that aren't in your note…", Reset brings it in, the next send is accepted | A second account | `docs/ce-verification.md` §F |
| An image-only revision reads "Waiting for review"; a merge on GitLab reads "Published" after Refresh | The scratch project | `docs/ce-verification.md` §F |
| Two vaults on one project: A publishes and merges, B gets updates; both edit different paragraphs (merged, with the notice), then the same sentence (three-way prompt) | A second vault | `docs/ssh-setup.md` |
| Typing in an open note while Get updates would change it: no keystrokes lost, the note is skipped with the unsaved-changes message | Obsidian | `docs/ssh-setup.md` |
| A review opened by the old plugin (branch exists, no local send record) shows "Waiting for review" after the first fetch | A vault from before the change | `docs/ce-verification.md` §F |
| Connect against a vault that is already a repository for another project (refused, nothing changed) and one nested in another repository (refused) | Obsidian | `docs/ce-verification.md` §F |

Run first the two that could change code: Windows, and GitLab's real messages.
