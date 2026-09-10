## ADDED Requirements

### Requirement: Submitting again after an interrupted submit completes the submission
When a previous submit attempt left the document's target on the remote
without an open submission against it, pressing "Submit for review" again
SHALL complete the submission rather than fail. The author SHALL NOT be
offered a separate recovery action, SHALL NOT be asked what happened, and
SHALL NOT be required to rename the file.

The plugin SHALL establish the state of the document's target before making
any write, and SHALL clear an unfinished previous attempt before submitting
the note's current content in its place.

#### Scenario: The submission was interrupted after the content reached the remote
- **WHEN** a previous submit left the document's target on the remote with no submission open against it, and the author selects "Submit for review" again and confirms the modal
- **THEN** the previous attempt is cleared, the note's current content is submitted in its place, and the author is shown "Waiting for review"

#### Scenario: The note was edited between the failed attempt and the retry
- **WHEN** the author edits the note after an interrupted submit and then submits again successfully
- **THEN** what reaches the remote is the note's content as of the successful submit, and no content left by the interrupted attempt survives

#### Scenario: An ordinary first submission is unaffected
- **WHEN** the author submits a document whose target does not exist on the remote
- **THEN** the submission proceeds exactly as before, with nothing cleared, and the author is shown "Waiting for review"

### Requirement: A document already awaiting review is never overwritten
When an open submission already exists for the document's target, the plugin
SHALL write nothing — not to the remote, not to the note's front matter, and
not to the tracking record — and SHALL NOT clear or replace anything on the
remote.

#### Scenario: The target already has a submission awaiting review
- **WHEN** the author confirms the submit modal and an open submission already exists for the document's target
- **THEN** nothing is written or deleted anywhere, and the author is told "A document with this file name is already waiting for review. If that's this document, there's nothing more to do. If it's a different one, rename the file and submit again."

#### Scenario: A submission awaiting review is not treated as an unfinished attempt
- **WHEN** the document's target exists on the remote and carries an open submission
- **THEN** the target is not deleted under any circumstances

### Requirement: A failed check of the target's state stops the submission
When the plugin cannot establish whether the document's target exists, it
SHALL abort the submission before any write and SHALL NOT proceed as though
the target were absent.

Where the check was refused because the credential lacks a permission, the
plugin SHALL report that as a permission failure and SHALL name the missing
permission when the platform reported one. It SHALL NOT describe such a
failure as a connection problem: a retry cannot resolve a permission the
credential was never granted, so advising one sends the author to do
something that can never work.

#### Scenario: The target's state cannot be read
- **WHEN** the check of the document's target fails for any reason other than the target being explicitly reported absent, and the cause is not an insufficient permission
- **THEN** no write and no deletion is attempted, the note's front matter is unchanged, no tracking record is created, and the author is told "Submit didn't go through. Check your connection and submit again."

#### Scenario: The credential lacks permission to check the target's state
- **WHEN** the check of the document's target, or of whether anything is open against it, is refused because the credential lacks a required permission
- **THEN** no write and no deletion is attempted, the note's front matter is unchanged, no tracking record is created, and the author is told their access is missing a permission, naming it when the platform reported one

### Requirement: A failure while clearing a previous attempt is reported as its own outcome
When clearing an unfinished previous attempt does not succeed, the plugin
SHALL abort the submission before writing anything and SHALL tell the author
that the clearing step is what failed, so that the failure is distinguished
from a submission that reached nothing at all.

Where the clearing was refused for a missing permission, naming that
permission SHALL take precedence over naming the step. Which step failed is
of no use to an author who cannot act on it, whereas the permission's name is
the one thing that gets it fixed.

#### Scenario: The previous attempt cannot be cleared
- **WHEN** an unfinished previous attempt is found and clearing it does not succeed, and the cause is not an insufficient permission
- **THEN** no content is submitted, the note's front matter is unchanged, no tracking record is created, and the author is told "Submit didn't go through while clearing up an earlier attempt. Check your connection and submit again."

#### Scenario: The credential lacks permission to clear the previous attempt
- **WHEN** clearing an unfinished previous attempt is refused because the credential lacks a required permission
- **THEN** no content is submitted, the note's front matter is unchanged, no tracking record is created, and the author is told their access is missing a permission, naming it when the platform reported one

## MODIFIED Requirements

### Requirement: `doc_id` is derived from the filename at confirm time and validated as ref-legal
When the author confirms the submit modal and the note's front matter does
NOT already carry a `doc_id`, the plugin SHALL derive a candidate `doc_id`
from the note's filename at that moment, ASCII-folding Vietnamese diacritics
and rejecting a filename containing a space, any of `~^:?*[\`, a leading
dot, or a trailing `.lock`. A note whose filename fails this validation
SHALL NOT be submitted.

When the note's front matter DOES already carry a `doc_id`, the plugin SHALL
use that value and SHALL NOT re-derive one from the current filename. A
frozen `doc_id` is the document's identity for the remainder of its life,
and the filename is permitted to drift away from it.

#### Scenario: A ref-legal filename is accepted
- **WHEN** the author confirms the submit modal for a note named `SBT-KE-004_New-Terminal-Setup.md` whose front matter carries no `doc_id`
- **THEN** the candidate `doc_id` is derived from that filename and validation passes

#### Scenario: A filename that is not ref-legal is refused
- **WHEN** the author confirms the submit modal for a note whose filename contains a space and whose front matter carries no `doc_id`
- **THEN** no remote call is made, and the author is told to rename the file before submitting

#### Scenario: A note that already carries a frozen `doc_id`
- **WHEN** the author confirms the submit modal for a note whose front matter carries `doc_id: SBT-KE-001_EG95-mTLS-Socket-Reopen-Error200` and whose filename has since been changed to something else
- **THEN** the submission uses the frozen `doc_id` from front matter, the current filename is not used to derive one, and the frozen value is not overwritten

### Requirement: Front matter is completed only after the document reaches the remote
The plugin SHALL NOT write `title`, `category`, or `doc_id` into the note's
front matter until both the remote commit and the merge request have
succeeded. On any failure at any point in the submit sequence — including a
failed check of the target's state, a failed clearing of a previous attempt,
and a refusal because a submission is already awaiting review — the note's
front matter SHALL remain exactly as it was before the submit attempt.

#### Scenario: Front matter after a successful submission
- **WHEN** a document's first submission completes successfully with title "CEPAS 3 Payments Fail with Error 200" and category "Diagnostic Reference"
- **THEN** the note's front matter now contains `title: CEPAS 3 Payments Fail with Error 200`, `category: Diagnostic Reference`, and `doc_id` set to the filename that was current at confirm time

#### Scenario: Front matter after a failed submission
- **WHEN** a document's first submission attempt fails, for any reason
- **THEN** the note's front matter contains none of `title`, `category`, or `doc_id`

#### Scenario: Front matter after a refusal because something is already awaiting review
- **WHEN** the submit is refused because an open submission already exists for the document's target
- **THEN** the note's front matter is unchanged, and in particular no `doc_id` is written

### Requirement: A submit failure is reported as one undifferentiated outcome
The plugin SHALL NOT distinguish, in what it tells the author, between the
remaining causes of a submit failure — a failure of unknown outcome such as a
dropped connection, a rejected write, or an unexpected response. All SHALL
produce the same message, naming the same recovery action: submitting again.

The message SHALL NOT name a cause and SHALL NOT advise renaming the file.
Renaming re-derives a different permanent `doc_id` for the same document, so
advising it as a general remedy makes an interrupted submit unrecoverable.
Renaming remains the correct advice in exactly two narrower places, each with
its own message: a filename that is not ref-legal, and a target that already
has a submission awaiting review.

The branch-already-exists cause that this requirement previously covered no
longer reaches the author: the target's state is established before any
write, and that case is handled by completing the submission instead.

#### Scenario: The connection drops mid-submission
- **WHEN** the network becomes unavailable after a write has been sent but before its outcome is known
- **THEN** the author is told "Submit didn't go through. Check your connection and submit again."

#### Scenario: A write is rejected for an unexpected reason
- **WHEN** a write fails with an unexpected response, and the cause is not an insufficient permission
- **THEN** the author is told the same message as the dropped-connection case, with no attempt to name which occurred

#### Scenario: The target already existed
- **WHEN** the document's target already exists on the remote with no open submission against it
- **THEN** the author is not shown a failure at all, and the submission completes
