## Why

The plugin can write a document to the remote and, since add-document-status,
read its state back. It has never been able to read a document's CONTENT
back. Two real situations need exactly that, and both surfaced from actually
using the plugin against a shared, multi-contributor GitLab project rather
than from speculation:

**A local note can be lost while its submission is still real.** Delete a
note in Obsidian after submitting it and the merge request keeps existing on
GitLab — open, later merged, whatever happens to it — but the plugin can
never find it again. `doc_id` lives nowhere except that note's own front
matter (`docs/document-identity.md` §3), reconciliation only ever asks the
remote about `doc_id`s it finds in the vault
(`plugin/src/submission-tracking/document-status.ts`), and the plugin's own
stored record for that document — which still exists in `data.json`, keyed
by `doc_id`, exactly where `store.save` left it — is never consulted for
this. The tracking survives; only the reachable trail to it doesn't.

**A first-time submit onto an already-published path fails with nothing
useful said.** `docs/document-identity.md` §3 anticipated author collision on
hand-picked `doc_id`s explicitly: "Two authors independently choosing
`SBT-KE-004` produce one branch name... The collision rule below already
requires the plugin to detect this and refuse." That rule — the pre-flight in
`clearPreviousAttempt` — catches it while the colliding document's merge
request is still open. It does not catch it once that merge request has
merged: the branch is gone by then, `branchExists` reports absence, and the
pre-flight reads that as "proceed, ordinary first submit." The write is
attempted, GitLab refuses a `create` action against a path that already
exists on the branch it was cut from, and the author sees the same generic
"Submit didn't go through" that covers every other undifferentiated failure
— no hint that a document already exists, and no path forward except
guessing.

Both gaps are the same missing primitive wearing different clothes: a way to
read one file's content at a specific path and ref. This is Option 1 of a
two-part exploration; the wider idea — browsing and importing content this
vault has never had any local trace of at all, from contributors who never
touched this vault — is deliberately not here. See `future-work.md` in this
change's own folder for that half and the open questions under it.

## What Changes

- `SubmissionRecord` gains an optional `path` field — the document's remote
  path, captured at the moment of a successful submit, going forward only.
  Records written before this change carry no path, by definition.
- The panel gains a second list, "Documents you can recover": every stored
  record whose `doc_id` has no matching note currently in the vault. Each
  entry offers a **Recover** action when its content can actually be
  located, and otherwise says why not and offers the existing "Open in
  GitLab" link instead of pretending recovery is possible.
- Recover reads the file's content from the remote at its known or
  discoverable path and creates a local note there with that content,
  verbatim. It refuses outright — writes nothing — if a note already
  occupies that path, and refuses if the path cannot be determined at all
  rather than guessing one.
- A first-time submit (no `doc_id` in front matter yet) gains a pre-flight:
  does a file already exist at this exact path on the project's default
  branch, independent of whether any branch or merge request for it still
  exists? If so, the submit is refused before anything is written, the
  author is told a document already exists there in plain language, and
  offered the same Recover action rather than a generic failure.
- Two new reads in `git-publishing`: a file's content at a path and ref
  (three-way: exists-with-content / absent / failed, mirroring
  `branchExists`'s shape and for the identical reason — a caller must be
  able to tell "nothing there" from "the read itself failed"), and the
  single path a given merge request's own commit touched, used only as the
  fallback for a record with no stored path.

## Deferred, deliberately

- **Discovering or importing a document this vault has never had any trace
  of** — no note, no stored record, nothing to key off. That needs browsing
  the whole repository, is a different-sized capability, and raises a real
  question about whether every document in the corpus even carries this
  project's front-matter contract. Carried forward in `future-work.md`.
- **An ongoing mirror of the knowledge base.** This proposal is strictly
  on-demand and author-triggered — press Recover, get one document. Keeping
  a vault continuously current with everyone's changes is the different
  problem `openspec/config.yaml`'s no-CI decision already reasoned through
  and declined to make mandatory, for reasons that apply here too.
- **Recovering a record with no stored path and no merge request left to
  ask.** A record that predates this change, whose document has since been
  merged or closed, has nothing left on the remote that names its path —
  the branch is gone and there is no fallback to read. This is a genuine
  dead end, stated as one: the row still appears, offering only "Open in
  GitLab," which already exists and already works for a human doing this by
  hand.
- **Attachments embedded in a recovered document.** Recover restores the
  note's own text only. An embedded image in a recovered document is 4a's
  problem revisited, not this one's.

## Capabilities

### New Capabilities

None. Recovery is new requirements inside capabilities that already exist,
matching the boundaries add-document-status already established: transport
in `git-publishing`, meaning in `submission-tracking`, the write sequence's
own decisions in `doc-authoring`, the surface in `plugin-shell`.

### Modified Capabilities

- `git-publishing` — gains the two reads above. Both are scope-gated reads,
  classified through `classifyScopedStatus` exactly as `listMergeRequests`
  and `hasUnresolvedThreads` are.
- `submission-tracking` — `SubmissionRecord` gains `path`; gains the
  resolution logic for what is and is not recoverable from a given record.
- `doc-authoring` — gains the path-collision pre-flight on a first submit,
  and the write that recreates a note from recovered content at its
  original path only.
- `plugin-shell` — gains the "Documents you can recover" list and its
  per-row action.

## Impact

- `plugin/src/git-publishing/gitlab-client.ts` — `getFileContent`,
  `getMergeRequestChangedPath`.
- `plugin/src/submission-tracking/submission-record.ts` — `path` field.
- `plugin/src/submission-tracking/` — recovery resolution, likely its own
  file alongside `reconcile.ts` rather than inside it: reconciliation reads
  state for documents the vault already knows about, recovery reads content
  for documents it doesn't, and the two ask the remote different questions.
- `plugin/src/doc-authoring/submit-document.ts` — the new pre-flight check,
  ordered before the existing branch-based one (see design.md decision 5).
- `plugin/src/doc-authoring/` — the recovered-note write, likely alongside
  `create-document.ts` since both create a note from nothing, differing
  only in where the content comes from.
- `plugin/src/main.ts` — the new panel section.
- `docs/document-identity.md`, `docs/access-tokens.md`,
  `docs/ce-verification.md` — the new reads' permission is not observed
  against any instance and needs the same treatment as the discussions read
  add-document-status added.
- No change to reconciliation's own behavior, to `listMergeRequests`, to
  `hasUnresolvedThreads`, or to how "Your documents" is built. This
  proposal is additive to a working, closed change, not a revision of it.
