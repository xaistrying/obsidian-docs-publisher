## ADDED Requirements

### Requirement: Resubmitting a pending or changes-requested document pushes an update
When the author resubmits a document whose resolved state is pending or
changes-requested, the plugin SHALL commit the note's current content to
that document's existing tracked branch. It SHALL NOT create a new branch
and SHALL NOT open a new submission.

Pushing the update SHALL NOT itself change the document's displayed state.
A document that was changes-requested because of an unresolved review
thread MAY still display as changes-requested immediately afterward — only
resolving the thread, or the remote otherwise agreeing the review moved on,
changes what the next refresh shows.

#### Scenario: Resubmitting a pending document
- **WHEN** the author edits and resubmits a document whose resolved state is pending
- **THEN** the note's current content is committed to the document's existing tracked branch, no new branch is created, and no new submission is opened

#### Scenario: Resubmitting a changes-requested document
- **WHEN** the author edits and resubmits a document whose resolved state is changes-requested
- **THEN** the note's current content is committed to the document's existing tracked branch the same way, and the document's displayed state is left to the next refresh rather than optimistically changed

### Requirement: Resubmitting a published document opens a new review cycle
When the author resubmits a document whose resolved state is published, the
plugin SHALL cut a fresh branch from the project's current default branch
under that document's frozen identity, commit the note's current content to
it as an update to the file already there, and open a new submission. The
author SHALL be shown the same confirmation as a first submission.

#### Scenario: Resubmitting a published document
- **WHEN** the author edits and resubmits a document whose resolved state is published
- **THEN** a fresh branch is cut from the current default branch, the note's content is committed to it as an update, a new submission is opened, and the author is told "Waiting for review"

#### Scenario: The update commit carries the file's current identifier
- **WHEN** a published document is resubmitted
- **THEN** the commit is made against the file's current commit identifier on the default branch, so it fails rather than silently overwriting if that file changed after the resolved state was read

### Requirement: Resubmitting a document that was not accepted opens a new review cycle
When the author resubmits a document whose resolved state is not accepted,
the plugin SHALL clear the abandoned branch from the prior cycle, cut a
fresh branch from the project's current default branch under that
document's frozen identity, commit the note's current content to it as a
new file, and open a new submission. This clearing SHALL NOT be surfaced to
the author as a distinct step or choice.

#### Scenario: Resubmitting a document that was not accepted
- **WHEN** the author edits and resubmits a document whose resolved state is not accepted
- **THEN** the prior cycle's abandoned branch is cleared, a fresh branch is cut from the current default branch, the note's content is committed as a new file, a new submission is opened, and the author is told "Waiting for review"

### Requirement: A duplicate `doc_id` across two local notes blocks a resubmit
Before any write, the plugin SHALL refuse a resubmit if another note in the
vault carries the same `doc_id` as the note being submitted, and SHALL
write nothing anywhere. This check SHALL run before the path-mismatch
check below.

#### Scenario: Two local notes share a `doc_id`
- **WHEN** the author resubmits a note whose `doc_id` another note in the vault also carries
- **THEN** the resubmit is refused before any remote call, and nothing is written anywhere

### Requirement: A local path drifted from the remote path blocks a resubmit
Before any write, and after the duplicate-`doc_id` check above finds nothing,
the plugin SHALL refuse a resubmit if the note's current vault path does not
exactly match the path this document occupies on the remote, comparing
case-sensitively, and SHALL name the path to restore rather than following
the move.

#### Scenario: The note has been moved since its last submission
- **WHEN** the author resubmits a note whose current vault path does not match the path this document occupies on the remote
- **THEN** the resubmit is refused before any remote call, the author is told the path to restore, and nothing is written anywhere

#### Scenario: A path differing only in case is treated as a mismatch
- **WHEN** the note's current path differs from the remote path only in letter case
- **THEN** the resubmit is refused, the same as any other path mismatch

## MODIFIED Requirements

### Requirement: A document already awaiting review is never overwritten
When a FIRST-TIME submission's derived identity already has an open
submission on the remote that this vault holds no local record for, the
plugin SHALL write nothing — not to the remote, not to the note's front
matter, and not to the tracking record — and SHALL NOT clear or replace
anything on the remote.

This requirement SHALL NOT apply to a document already tracked locally.
Resubmitting a document whose resolved state is pending or
changes-requested pushes an update instead of refusing, per the
requirement above.

#### Scenario: A first submission's derived identity collides with a stranger's open submission
- **WHEN** a note with no `doc_id` yet is submitted, and its derived identity already has an open submission on the remote that this vault holds no record for
- **THEN** nothing is written or deleted anywhere, and the author is told "A document with this file name is already waiting for review. If that's this document, there's nothing more to do. If it's a different one, rename the file and submit again."

#### Scenario: A tracked document's own resubmit is not refused
- **WHEN** a document already tracked locally, whose resolved state is pending or changes-requested, is resubmitted
- **THEN** this requirement does not apply, and the resubmit proceeds as an update per the requirement above
