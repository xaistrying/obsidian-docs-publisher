## Why

The plugin can publish a document, track it, recover it, reset it and revise
it — but only ever documents this vault already knows about. A teammate's
document, authored from their vault and merged months ago, is invisible here:
no note, no stored record, no `doc_id` to key off. The only way to read it is
to leave Obsidian and open GitLab, which is the thing this plugin exists to
make unnecessary.

That gap has been known since `add-document-recovery` parked it in
`future-work.md`, deliberately, to be revisited once recovery had shipped and
been used. It has. And two checks run against the real corpus on 2026-09-14
(`docs/ce-verification.md` §E) have since answered the question that was
blocking it and turned up the one that actually matters:

- **It is smaller than feared** (§E2). The corpus was expected to need a
  backfill engine for foreign content. It does not: what its 34 documents are
  missing is exactly the set this plugin writes at creation and first submit,
  and their filenames already are the control IDs `doc_id` is derived from. A
  subset of the contract, not a rival convention.
- **The real blocker is not front matter at all** (§E3, verified in code). An
  imported document has no `doc_id`, so its first edit-and-submit takes the
  first-submit path — where `checkTargetPathFree` refuses it, because a file
  does exist at its path on the default branch. By construction, for every
  imported document. Import built naively produces documents that cannot then
  be submitted, which is worse than no Import.

The attachment read side ships here too. `add-attachment-sync` pushes
attachments up; nothing pulls them down, so Recover already restores notes
with broken embeds and Import would inherit that on day one — the same defect
that milestone just fixed in the other direction, in the same code path.

## What Changes

- **A Discover list**: every markdown document on the remote's default branch
  that this vault has no note for, resolved by comparing remote paths against
  vault paths.
- **Import**, per document and as an "add all", writing each note at its exact
  remote path.
- **Imported documents are tracked from the moment they land.** Import freezes
  `doc_id` into the note's front matter, because an imported document's
  identity already exists on the remote — its path and name are fixed there
  and refuse-to-move already forbids changing them. This is what makes an
  imported document submittable; without it the collision pre-flight refuses
  it forever. See design.md, which weighs this against
  `docs/document-identity.md` §3's "snapshotted at FIRST SUBMIT" rule rather
  than quietly reinterpreting it.
- **A duplicate-`doc_id` check at import time**, not only at submit time. An
  imported document's `doc_id` can collide with a note this vault already has,
  and today nothing would notice until a submit much later.
- **An exclusion rule**, so a README or a scratch file is not offered as an
  importable document. §E2 found `README.md` and `Global/Tools-&-Access.md`
  carrying no front matter at all.
- **Attachments are pulled down** for an imported document and for a recovered
  one, so neither lands with broken embeds.
- **`git-publishing` gains a repository-tree read**: recursive, paginated, and
  bounded, reporting truncation honestly rather than returning a partial
  answer that looks complete — the same rule `listMergeRequests` follows.

### Deferred, deliberately

- **Sync.** This is author-triggered import only: nothing pulls without being
  asked, and nothing keeps the vault continuously current. `openspec/config.yaml`'s
  no-CI reasoning against automatic pulls stands, and its Reset amendment
  exempted exactly one explicit, confirmed, single-document action — not a
  background refresh.
- **Importing non-conforming documents as first-class.** A file with no front
  matter at all is excluded from the list rather than imported and repaired.
  Backfilling `lifecycle`/`created` for documents that DO carry partial front
  matter is in scope only insofar as import must not produce a note the plugin
  then refuses to submit; a general adoption flow is not.
- **Milestone 3a** (the default-directory setting) and **milestone 8** (Merge).
  3a is named here only to forbid wiring it in: an imported document goes to
  its remote path, never a configured folder.

## Capabilities

### New Capabilities

None. Discovery is new requirements inside capabilities that already exist,
matching the boundaries every change since `add-document-status` has kept.

### Modified Capabilities

- `git-publishing` — gains the repository-tree read, bounded and honest about
  its bound.
- `submission-tracking` — gains the resolution of "what does the remote have
  that this vault does not", which is the mirror of recovery's "what does this
  vault's records have that its files do not".
- `doc-authoring` — gains the import write: a note at an exact remote path,
  with `doc_id` frozen, refusing on a duplicate; and the attachment fetch that
  follows both it and recovery.
- `plugin-shell` — gains the Discover surface and its import actions.

## Impact

- `plugin/src/git-publishing/gitlab-client.ts` — the tree read.
- `plugin/src/submission-tracking/` — discovery resolution, its own module
  alongside `recover.ts` and `reset.ts`, following the one-file-per-direction
  convention those two established.
- `plugin/src/doc-authoring/` — the import write, and the attachment fetch
  shared with recovery; `recover-document.ts` gains the attachment step.
- `plugin/src/main.ts`, `plugin/styles.css` — the Discover surface.
- `plugin/tests/` — the harness `add-attachment-sync` introduced; discovery's
  path comparison, exclusion rule and duplicate detection are all pure logic
  and belong there rather than in a manual matrix.
- `docs/ce-verification.md` — the tree endpoint's response shape and its
  permission name, neither ever spiked.
- `openspec/config.yaml`, `docs/panel-tracking-scope.md` — milestones 9 and 9a
  marked done once shipped.
