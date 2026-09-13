## Why

Submit commits one file: the note. A document that embeds an image
publishes with a broken embed — in GitLab, and anywhere downstream that
reads the corpus. The corpus does use images, so this is the normal case
for a Diagnostic Reference or a Known Errors document, not an edge case.
It has been a known oversight since 2026-08-26 and is the last correctness
defect left in the write path.

It also cannot be deferred much further without breaking things that
already shipped. Three shipped features identify a document's remote path
by asking which single file its merge request changed — the path-mismatch
pre-submit check, Reset, and recovery's legacy-record fallback. The day a
document's merge request carries an image alongside the note, that question
returns "could not be determined" for all three. Two of them fail safe and
go dead; the third, the path-mismatch check, **silently stops binding**,
because a path it cannot establish is skipped rather than refused. So
shipping attachments without repairing that is not additive — it quietly
removes the refuse-to-move guarantee from every document that has a
picture in it.

## What Changes

- **Attachments are committed alongside the note.** The commit payload
  becomes an actions array: the note, plus every image it embeds, each at
  the same vault-mirrored path it occupies locally.
- **Embeds are resolved through Obsidian's own resolver**, never a regex
  over the text. `![[image.png]]` carries a filename, not a path, and
  resolving it by hand guesses wrong the moment two folders hold a
  same-named image. Both embed forms are handled — the wikilink form and
  standard `![alt](path.png)`.
- **Each action carries its own verb**, decided by whether that path
  already exists on the ref being committed to: a shared attachment
  already on the default branch is an update carrying its own
  `last_commit_id`; a new one is a create. This reuses the per-file verb
  decision and `getFileCommitId` that `add-resubmission-lifecycle`
  already built for the note.
- **`getMergeRequestChangedPath`'s rule changes** from "the merge request
  changed exactly one file" to "changed exactly one markdown file," which
  is what makes the three dependent call sites keep working once a merge
  request also carries images. Their own code is unchanged — the repair is
  inside the one function all three call.
- **Nothing is ever deleted.** Unlinking or moving an image locally
  strands the old remote file; orphans accumulate and a Maintainer clears
  them in GitLab, the same escape hatch reorganization already uses.
- **A test harness, and tests.** This repo has none today. Everything this
  change adds that can be verified without a live server is verified that
  way: embed resolution, actions-array construction, verb selection, and
  the changed-path rule.

### What is still observed against the real instance, and why it cannot be tests

A stubbed HTTP layer verifies that the code does what its author believes
GitLab wants. `docs/ce-verification.md` exists because that belief has been
wrong before, expensively. Three facts this change depends on can only be
established by the server:

- a commit payload with several actions and mixed create/update verbs is
  accepted;
- a per-action `last_commit_id` is honoured for actions other than the
  first;
- binary content survives the round trip as base64 through Obsidian's
  request helper.

Those are observed once and recorded in `docs/ce-verification.md`, per that
doc's own convention. Everything else is a test.

### Deferred, deliberately

- **Pulling attachments back DOWN.** Recover restores a note's text only,
  so a recovered document still has broken embeds, and milestone 9's
  Import would inherit the same gap. `add-document-recovery` handed this
  to "4a revisited"; this change is the write side and does not take it.
  Recorded here so it reads as a decision rather than an omission — **it
  still needs a milestone number of its own**, and has none.
- **Note-in-note transclusion.** `![[Other Document]]` references another
  note rather than an attachment; already out of scope project-wide.
- **Content conflicts on a shared attachment.** Two authors committing
  different bytes to one attachment path on concurrent branches is a
  genuine conflict the plugin cannot resolve and whose name the
  vocabulary rule bans. The `last_commit_id` guard makes the second write
  fail loudly rather than silently overwrite, which is the whole of this
  change's answer.
- **Backfilling attachments for already-published documents.** They
  publish broken today and stay broken until their next revision, which
  then carries their images.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `doc-authoring` — gains embed resolution and the set of files a
  submission carries, replacing "the note" with "the note and what it
  embeds".
- `git-publishing` — the commit call takes several file actions instead of
  one, each with its own verb and optional `last_commit_id`; the
  changed-path read's rule narrows to markdown.
- `submission-tracking` — no behaviour change, but its three consumers of
  the changed-path read keep working only because of the rule change
  above; covered by tests rather than left to chance.

## Impact

- `plugin/src/doc-authoring/` — embed resolution and submission file set,
  likely its own module since it is pure logic over Obsidian's cache.
- `plugin/src/doc-authoring/submit-document.ts` — builds the action list
  rather than one action, on all four write paths.
- `plugin/src/git-publishing/gitlab-client.ts` — `createBranchWithCommit`
  and `commitToBranch` take an action array; `getMergeRequestChangedPath`
  narrows to markdown.
- `plugin/package.json`, and a test config — the harness, plus an
  `obsidian` stub, since every module imports it at runtime and it does
  not exist outside Obsidian.
- `docs/ce-verification.md` — the three observed facts above.
- `openspec/config.yaml`, milestone 4a — marked done, and the deferred
  read-side given a home.
