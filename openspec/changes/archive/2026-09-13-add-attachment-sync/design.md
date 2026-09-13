## Context

The write path currently commits exactly one file. `createBranchWithCommit`
and `commitToBranch` each build `actions: [{ action, file_path, content,
last_commit_id? }]` — an array with one entry, already carrying the verb and
guard `add-resubmission-lifecycle` parameterized. Widening that array is the
smaller half of this change.

The larger half is everything around it:

- **Obsidian side.** `![[image.png]]` contains no path. Obsidian resolves
  it by shortest-path lookup through `metadataCache`, so a regex over the
  note's text yields a filename that is wrong the moment two folders hold a
  same-named image. Standard `![alt](path.png)` links do carry paths and
  behave differently. Both forms occur.
- **Three shipped consumers of a one-file assumption.**
  `getMergeRequestChangedPath` answers null unless a merge request changed
  exactly one file. `submit-document.ts` (path-mismatch check), `reset.ts`,
  and `recover.ts` all read it. The first *skips* its check on null; the
  other two refuse. Attachments make null the normal case for any
  illustrated document.
- **No tests exist.** No runner, no test files, no runtime dependencies,
  and every module imports `obsidian` at runtime (`Notice`, `Modal`,
  `requestUrl`) — a module that does not exist outside Obsidian.

## Goals / Non-Goals

**Goals:**

- A document that embeds images publishes with those images, at the same
  paths they occupy in the vault.
- The three shipped features that depend on identifying a document's own
  remote path keep working once a merge request carries more than one file.
- Plugin-side behaviour is covered by tests rather than by a manual matrix.
- The manual matrix shrinks to the facts only a real server can settle.

**Non-Goals:**

- Pulling attachments down (Recover/Import). Write side only.
- Deleting orphaned remote attachments, ever.
- Resolving a genuine content conflict on a shared attachment.
- Transclusion of other notes.

## Decisions

### 1. `getMergeRequestChangedPath` narrows to "exactly one MARKDOWN file"

The repair for all three consumers happens inside the one function they
share, so none of their own code changes.

Today: zero or 2+ changed paths → null. After: filter the changed paths to
those ending `.md`, then apply the same rule — exactly one → that path,
anything else → null. An illustrated document's merge request carries one
markdown file and N images, so it resolves cleanly again.

This is exact rather than heuristic under the current model: attachments
are images by definition, and note-in-note transclusion is out of scope
project-wide, so no second markdown file can appear in a document's own
merge request. If transclusion is ever taken on, this rule is the thing it
breaks, and this paragraph is the note saying so.

REJECTED: matching the changed path against `doc_id`. It looks exact and is
not — `doc_id` is ASCII-folded from the filename at first submit, so a note
named `Bảo-trì.md` has `doc_id: Bao-tri`, and the remote path's basename
and `doc_id` legitimately differ. Matching on it would fail exactly for the
documents this project's own corpus is most likely to contain.

REJECTED: having callers pass what they expect and filtering to it. It
moves the same rule into three places and gives each one a chance to drift.

### 2. Embed resolution is pure logic over a cache interface, not over `App`

Resolution takes the note and something shaped like Obsidian's
`metadataCache` and returns the set of vault paths the note embeds. It does
not take `App`, does not read files, and does not touch the network.

- Wikilink embeds come from the cache's own `embeds` entries, each resolved
  through `getFirstLinkpathDest` — Obsidian's own resolver, which is the
  only thing that knows the shortest-path rule.
- Markdown-style embeds carry a path already; it is normalized against the
  note's folder and confirmed to exist in the vault.
- An embed that resolves to nothing is SKIPPED, not failed: a broken link
  in the author's own note is not a reason to refuse their submission, and
  refusing would make a typo block publishing.
- An embed pointing outside the vault, or to the note itself, is skipped
  for the same reason.

This shape is what makes the hardest part of this change testable with a
fake cache and no Obsidian at all (decision 5).

### 3. Each action's verb is read, never assumed, and reuses what exists

For every file in the submission — note and attachments alike — the verb is
decided by asking whether that path already exists on the ref being
committed to, via the `getFileCommitId` read
`add-resubmission-lifecycle` already built: present → `update` carrying
that file's `last_commit_id`; absent → `create`.

This is the same rule the note already follows, applied per file. A shared
attachment (a logo in twenty documents) is present on the default branch
and becomes an update; a new screenshot is a create. No special case
distinguishes notes from attachments.

Cost: one read per file per submit. Accepted — a document embeds a handful
of images, not hundreds, and the alternative is guessing the verb, which is
precisely the bug `add-resubmission-lifecycle` was created to fix.

### 4. Binary content goes as base64, and that is a payload-shape change

Images are not text. GitLab's commit API takes per-action `encoding:
"base64"` alongside the content. The note stays plain text; attachments
carry the encoding flag. This is the one part of the payload whose
acceptance cannot be established without the server (proposal's observed
list).

### 5. Tests: Vitest, an `obsidian` stub, and a line about what tests cannot do

DECIDED: Vitest, aliasing `obsidian` to a local stub module.

- It runs TypeScript with no separate transform config, which Jest needs
  via ts-jest or babel, and this repo has no such config to extend.
- The alias is one line, and aliasing is the whole problem: every module
  imports `obsidian` at runtime, so without it nothing is importable in a
  test process.
- REJECTED: `node:test`, which needs its own TypeScript build step first —
  more moving parts than the thing being tested.

The stub provides only what tests actually touch (`Notice`, `requestUrl`,
`normalizePath`, and enough of `Modal`/`Setting` to import). It is not a
reimplementation of Obsidian and must not grow into one.

**What is tested:** embed resolution against a fake cache, action-list
construction (paths, verbs, encoding, `last_commit_id` placement), the
changed-path markdown rule, and that a skipped/unresolvable embed does not
fail a submission.

**What is NOT tested, deliberately:** whether GitLab accepts what is built.
A test asserting the payload shape asserts this project's belief about the
API, and `docs/ce-verification.md` exists because that belief has been
wrong before. The payload tests pin the shape so it cannot change by
accident; the three instance checks establish that the shape is right.
Those are different jobs and neither substitutes for the other.

### 6. Orphans accumulate; nothing is deleted

Unlinking an image locally leaves the remote copy in place. Consistent with
the refuse-to-move contract, and unchanged from the roadmap entry: a
Maintainer clears them in GitLab. The plugin has no delete path for
attachments and gains none here.

## Risks / Trade-offs

**The markdown rule breaks if transclusion is ever supported** → Recorded
in decision 1 and in the function's own comment, so the next person to take
on transclusion meets it rather than discovers it.

**One `getFileCommitId` read per attachment per submit** → Accepted per
decision 3; bounded by how many images one document embeds.

**Tests over a stub can drift from the real API** → Explicitly accepted and
bounded by decision 5: the tests pin shape, the instance checks establish
correctness, and `ce-verification.md` is where the second lives.

**A shared attachment's `last_commit_id` is read at submit and the file
changes before merge** → The write fails loudly at the next submit rather
than silently overwriting, which is the guard working. Two authors
committing different bytes to one path remains unresolvable by the plugin.

## Open Questions

- Whether the note should be first in the actions array. GitLab is not
  documented to care, and nothing here depends on it, but a stable order
  makes commits easier to read and diffs easier to compare. Left to
  implementation.
- Attachment size. Nothing bounds how large an embedded image may be, and
  a base64 payload is ~33% larger than the file. No limit is imposed here;
  if one is ever needed, the failure today is a rejected commit with the
  generic message, which is survivable but not good.
