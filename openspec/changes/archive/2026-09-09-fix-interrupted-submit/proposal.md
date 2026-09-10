## Why

An interrupted submit permanently corrupts a document's identity, and a
dropped connection is enough to cause it. "Submit for review" makes two
remote calls that cannot be atomic. When the first succeeds and the second
fails, the document is half-published: it exists on the remote, but the note
carries no `doc_id` and no tracking record, so nothing local knows. The
author is told to rename the file and try again — and renaming is the one
action that makes it unrecoverable, because it freezes a *different*
permanent `doc_id` for the same document and abandons the first attempt
where nothing will ever find it. Submitting again without renaming fails
identically every time, so the author's only offered way forward is the
destructive one.

This closes a requirement the project already has rather than adding scope:
`openspec/config.yaml`'s no-offline-queue decision requires that "retries
must be idempotent (check whether the branch/MR already exists before
redoing a partially completed submit)". Nothing implements that. Milestone
4 knowingly punted it — its own observable check confirms the author sees
the undifferentiated failure — and this is the change that pays it back.

Now, because milestone 4a is next and rewrites this exact sequence from one
file action into an actions array. Fixing the sequence first means 4a
inherits a recoverable path; landing 4a first widens the same dead end to
strand attachments in it too.

## What Changes

- A submit that was interrupted partway through can be completed by
  submitting again. The author presses the same button, and it works. There
  is no new control, no recovery mode, and nothing they must understand
  about why the first attempt failed.
- Before submitting, the plugin checks whether this document's target
  already exists on the remote and whether anything is under review there.
  An unfinished attempt is cleared and replaced with the author's current
  content; a submission genuinely awaiting review is never touched.
- Renaming the file stops being the advice given for an interrupted submit.
  The existing failure message stays for the case it was written for — an
  attempt that reached nothing — but it is no longer shown where the real
  remedy is to submit again.
- The content that reaches the remote is always what the note holds at the
  moment of the successful submit, never what a failed earlier attempt
  left there. An author who edits the note between attempts gets the
  edited version.
- `git-publishing` gains its first destructive call: deleting the abandoned
  target of an unfinished attempt. Deleting a non-protected branch is
  within Developer (30), which submit already requires, so no access gate
  changes.

### Deferred, deliberately

- **The duplicate-`doc_id` check stays with milestones 6 and 7.** This
  change must not delete something that is under review, so it necessarily
  notices that state and needs one message for it. That message is the
  whole of what lands here. The real check — with reconciliation behind it,
  ordered ahead of the path-mismatch check — remains 6's and 7's, per
  `openspec/config.yaml`.
- **`last_commit_id` handling stays with milestone 6.** This change never
  updates a file that exists in `main`; it replaces an unfinished attempt
  that never merged.
- **Attachments stay with milestone 4a.** The sequence fixed here still
  commits exactly one file.
- **Resubmitting after "Not accepted" stays with milestone 7a**, and
  revising a published document with milestone 7. Both reuse the delete
  method this change introduces, which is the only thing they take from it.
- **No retry-on-behalf, no queue, no automatic second attempt.** Submit
  stays a deliberate click that fails loudly, per the no-offline-queue
  decision. This makes the author's *own* next click work; it does not
  click for them.

## Capabilities

### New Capabilities

None. This changes how two existing capabilities behave, and introduces no
subject that either does not already own.

### Modified Capabilities

- `doc-authoring`: submitting becomes idempotent. A submit that finds an
  unfinished previous attempt completes rather than failing; one that finds
  a submission awaiting review refuses with its own message. The
  undifferentiated-failure requirement narrows to the cases where it is
  still the truth, and the advice to rename the file is removed from the
  interrupted case.
- `git-publishing`: gains the ability to read whether a document's target
  exists on the remote, to read whether anything is open for it, and to
  delete it. The delete is the capability's first destructive operation and
  classifies through the write path.

## Impact

- `plugin/src/doc-authoring/submit-document.ts` — `performSubmit`'s
  sequence gains a pre-flight step ahead of its first write, and
  `SUBMIT_FAILED_MESSAGE`'s rename advice moves off the interrupted path.
- `plugin/src/git-publishing/gitlab-client.ts` — three additions: a branch
  lookup, an open-merge-request lookup for a branch, and a branch delete.
- `plugin/src/submission-tracking/` — unchanged. A record is still written
  only after a submission is genuinely open, and still only ever `pending`.
- No change to front matter, to the front matter contract, to `doc_id`
  derivation, or to when `doc_id` freezes. `doc_id` still comes from the
  filename at confirm time and still freezes only on success.
- No new dependency, no new setting, no new gate, no data migration.
  Existing `data.json` records are read and written unchanged.

### Documentation correction this change forces

`openspec/config.yaml`'s milestone 7a entry and `docs/document-identity.md`
§5 both say milestone 7a introduces `git-publishing`'s first destructive
call. If this change lands first, that becomes wrong in two places. Both
must be corrected to say this change introduces it and 7a reuses it —
`openspec/config.yaml`'s own rule is that a milestone handing work off must
be checked against the milestone that claims it, and a stale pointer is
exactly what that rule exists to prevent.
