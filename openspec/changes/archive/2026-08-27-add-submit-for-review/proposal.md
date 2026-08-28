## Why

A document created by milestone 3 can be written and renamed freely, but has
no way to leave the vault: nothing calls the GitLab API to publish it. This is
the first end-to-end slice — click Submit, and the document actually reaches
review — and per `openspec/config.yaml` it is UNBLOCKED: the `owner` question
that shaped the front matter contract is decided, and milestone 3 already
provides the connection state and access gate this reuses.

## What Changes

- Add a "Submit for review" action, gated identically to milestone 3's "New
  Document" (details entered → connection verified → Developer access), that
  opens one modal collecting `title` (free text) and `category` (one of the
  nine fixed deliverables), with a read-only preview of the document's target
  remote path shown before anything freezes.
- On confirm, validate the note's current filename as git-ref-legal (fold
  Vietnamese diacritics to ASCII; reject spaces, `~^:?*[\`, a leading dot, a
  trailing `.lock`) and hold it as the pending `doc_id` — not yet written to
  the note.
- Add the plugin's first write path to `git-publishing`: create the branch and
  commit the file (`POST /repository/commits` with `start_branch`), then
  create the merge request (`POST /merge_requests`). Only after both succeed
  does the plugin write `title`, `category`, and `doc_id` into the note's
  front matter — this ordering is load-bearing for the retry story below, not
  a style choice.
- Add a write-oriented failure classification alongside the existing
  read-oriented `FailureKind`, carrying through the named permission GitLab
  reports in an `insufficient_granular_scope` error body instead of
  discarding it, so a permission-scoped rejection can name what's missing.
- Any failure on this first-submit sequence — an explicit "branch already
  exists" response or a network interruption of unknown outcome — is reported
  identically, as one failure case, with no resumability or reconciliation
  attempted. The fix is the same in both cases: rename the file (free before a
  successful first submit) and submit again, which produces a new `doc_id`
  and sidesteps whatever is sitting on the remote under the old name.
- **New capability** `submission-tracking`: persist one record per submitted
  document to plugin data, keyed by `doc_id`, recording at minimum the branch
  name, merge request IID, and submission state. This milestone produces
  exactly one transition, unsubmitted → pending; the fuller state set
  (`changes-requested`, `published`, `closed`) is reserved by the type for
  milestones 5 onward, not produced here.
- The note displays "Waiting for review" once submitted, read from this new
  tracking record.

Deferred, explicitly out of scope for this change:
- Attachment sync (embedded images) — milestone 4a, a separate proposal.
- The duplicate-`doc_id` and path-mismatch pre-submit checks — they do not
  bind on a first submit (nothing on the remote yet to duplicate or drift
  from) and belong to milestones 6 and 7.
- Any `GET /merge_requests` read/reconciliation call — milestone 5.
- Resuming or repairing a partial failure (branch created, merge request
  creation failed) — deliberately punted; see design.md.

## Capabilities

### New Capabilities
- `submission-tracking`: the submission state record persisted per document
  (keyed by `doc_id`), the states this milestone produces, and how a note is
  resolved to its record.

### Modified Capabilities
- `doc-authoring`: the front matter contract gains `title`, `category`, and
  `doc_id`, written once at first submit rather than left absent
  indefinitely, and the submit action's gating and target-path confirmation.
- `git-publishing`: adds the capability's first write operations (branch +
  commit, merge request creation) and a permission-scoped failure
  classification that carries the GitLab-reported detail through to callers.

## Impact

- `plugin/src/git-publishing/gitlab-client.ts` — new write methods; extends
  `ClientResult`'s failure shape with an optional detail payload for the new
  permission-scoped kind.
- `plugin/src/doc-authoring/` — new submit modal and its gate, reusing the
  pattern in `create-document.ts`; `front-matter.ts` gains the deferred-field
  write, applied post-success only.
- `plugin/src/submission-tracking/` — new directory: the record shape, its
  `data.json` persistence, and doc_id-keyed lookup.
- `plugin/src/platform-config/settings-tab.ts` — extends the
  `FailureKind`-to-message table for the new permission-scoped kind.
- `plugin/src/main.ts` — registers the "Submit for review" command alongside
  "New Document".
- No change to `plugin-shell` or `platform-config`'s connection/credential
  handling.
