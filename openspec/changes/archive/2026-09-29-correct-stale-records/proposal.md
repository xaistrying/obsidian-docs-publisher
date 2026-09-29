## Why

The plugin treats its stored records as a cache of the remote's answer. Two
paths break that: one never writes a record, the other never updates one. Both
leave a document whose state nothing will ever correct, and neither can be
fixed from the panel.

Found during `verify-against-target-instance` and written up as
`docs/ce-verification.md` §D0e and §D0f.

## What Changes

**Reconciliation stops skipping the records that most need it.**
`refreshDocumentStatuses` reconciles `listVaultDocuments(app)` — notes PRESENT
in the vault. A document whose note was deleted while under review is therefore
never asked about, so its stored state stays `pending` for the life of the
vault however the review ends. Three consequences follow, all confirmed:

- `restorableDocuments` filters on that stored state, so it keeps offering the
  row forever. Pressing Restore reads a branch the merge deleted and answers
  "This document's review has already finished."
- `discoveryCandidates` deliberately excludes whatever Restore offers, so one
  document never appears on two surfaces — meaning the stale entry
  **suppresses** the import entry. The document is absent from the only
  surface that could act on it.
- `reset.ts` states the restore list is self-emptying: *"Every document here
  leaves on its own: the review ends and it becomes published (Discover covers
  it) or not accepted (it drops out entirely)."* Both exits depend on the state
  update that is being skipped, so the claim is false for exactly the documents
  on that list — it can only empty itself for a document whose note is in the
  vault, and having a note there is what keeps it off the list.

**A first submit stops being able to orphan its own document.** Submitting
`test-006` created its branch and an open merge request, then wrote neither
front matter nor a record. The note ended with no `doc_id`, which is the key
every route back to a document turns: `listVaultDocuments` skips it,
reconciliation never sees it, the restore list cannot offer it. The remote held
a review the vault could not see, and nothing would ever reconnect them.

The ordering is what makes that reachable — the record is saved AFTER the
front-matter write, so a failure in between loses the only local trace of work
that already exists on the remote. The record SHALL be written first, so the
worst case becomes a tracked document with incomplete front matter rather than
an untracked one with none.

**Not in scope:** the root cause of that failure, which is not established.
`createMergeRequest` can return `ok: false` for a merge request that was
created (`post` answers `unexpected` when the body will not parse), and
`writeSubmissionFrontMatter` can throw; the console distinguishes them and has
not been read. This change makes the failure survivable rather than diagnosing
it, which is worth doing either way — an intermittent fault on a write path
will outlive any single diagnosis.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `submission-tracking`: reconciliation's SCOPE becomes every document the
  plugin knows about, not only those with a note in the vault. The existing
  requirement already says the remote wins over a stored record; it does not
  say which records get asked, and the gap is where this bug lives.
- `doc-authoring`: a first submit's ordering becomes normative — the tracking
  record is written before any front-matter write, so no failure between them
  can leave work on the remote that the vault has no record of.

**Deliberately unmodified:** `plugin-shell`'s restore-list requirement. It
still describes the pre-2026-09-22 section (three empty cases, collapsible,
per-row recovery-unavailable states) and does not match the shipped panel. That
drift is real and predates this change; correcting it here would drag an
unrelated retro-spec into a defect fix. The restore list's behaviour is fixed
by correcting the records it reads, not by changing what it is specified to do.

## Impact

- `plugin/src/submission-tracking/document-status.ts` — what
  `refreshDocumentStatuses` passes to reconciliation.
- `plugin/src/submission-tracking/reconcile.ts` — possibly nothing; it already
  takes a list of `doc_id`s and reads the remote once for all of them.
- `plugin/src/doc-authoring/submit-document.ts` — the order of the record write
  and the front-matter write on the first-submit path.
- `plugin/src/submission-tracking/reset.ts` — the self-emptying claim in
  `restorableDocuments`' comment becomes true, and should say why.
- `docs/ce-verification.md` §D0e, §D0f — struck when this ships. §E6's import
  check stops being blocked by it.
