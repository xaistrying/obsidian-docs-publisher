# Doc Authoring Specification

## Purpose

This capability defines how an author creates and submits a document from the
plugin: where the note is placed, what front matter is written at creation
and at submission, the access and connection checks that gate each action,
and how a document's identity (`doc_id`) is derived and frozen at first
submit. TBD: the fuller authoring lifecycle (editing, review) beyond creation
and first submission.

## Requirements

### Requirement: An author can create a document from the plugin
The plugin SHALL offer a "New Document" action from two places — a control in
the plugin's panel and an entry in the command palette — and both SHALL take
the same path, so neither can behave differently from the other. The action
SHALL create one note and open it for editing.

#### Scenario: Creating from the panel
- **WHEN** the author selects "New Document" in the plugin's panel
- **THEN** one note is created and opened for editing, with the cursor in the note

#### Scenario: Creating from the command palette
- **WHEN** the author runs the plugin's "New Document" command from the command palette
- **THEN** the same note is created and opened as when the panel control is used

#### Scenario: Creating a second document
- **WHEN** the author creates a document while a document created earlier already exists
- **THEN** a separate new note is created and no existing note is overwritten

### Requirement: A new document is placed where the vault places new notes
The plugin SHALL create the note in the location Obsidian is configured to use
for new notes, rather than imposing a folder of its own. The plugin SHALL NOT
create, require, or assume any particular folder structure.

#### Scenario: The vault places new notes beside the current one
- **WHEN** the vault is configured to create new notes in the same folder as the current file, and the author creates a document while a note in `Smart Buddy POS/Known-errors/` is open
- **THEN** the new note is created in `Smart Buddy POS/Known-errors/`

#### Scenario: The vault places new notes in a fixed folder
- **WHEN** the vault is configured to create new notes in a specific folder and the author creates a document
- **THEN** the new note is created in that folder

### Requirement: The author names the document, not the plugin
The plugin SHALL create the note under a default name and SHALL NOT ask the
author for a name before the note exists. Naming the document is the author's
to do afterwards, by renaming the note as they would any other.

#### Scenario: The note is created without asking for a name
- **WHEN** the author selects "New Document"
- **THEN** the note is created immediately under a default name, with no dialog asking for a name, title, or category first

#### Scenario: The author renames the document
- **WHEN** the author renames the newly created note
- **THEN** the plugin does not object, does not rewrite any front matter, and does not require the note to carry any particular name

### Requirement: The plugin writes only the front matter it can know at creation
The plugin SHALL write exactly four front matter fields into the new note:
`owner`, `created`, `last_reviewed`, and `lifecycle`. It SHALL write them once,
at creation, and SHALL NOT write any of them again for the life of the
document. It SHALL NOT write `title`, `category`, or `doc_id`, which are
completed when the document is first submitted.

#### Scenario: Front matter written at creation
- **WHEN** the author creates a document while connected as an account whose username is `ivan.nguyen`, on a day the vault's clock reports as 2026-08-26
- **THEN** the note's front matter contains `owner: ivan.nguyen`, `created: 2026-08-26`, `last_reviewed: 2026-08-26`, and `lifecycle: active`, and nothing else

#### Scenario: The three deferred fields are absent
- **WHEN** the author creates a document
- **THEN** the note's front matter contains no `title`, no `category`, and no `doc_id`, empty or otherwise

#### Scenario: The author edits a field the plugin wrote
- **WHEN** the author changes `owner` or `last_reviewed` by hand after the document is created
- **THEN** the plugin leaves the new value alone and never restores what it originally wrote

### Requirement: The owner is the connected account's username
The plugin SHALL write the username of the account the connection check
identified, exactly as the platform reports it. It SHALL NOT derive the value
from an email address, a display name, or any other field.

#### Scenario: An account whose username differs from its email
- **WHEN** the author creates a document while connected as an account with username `inguyen` and email `ivan.nguyen@example.com`
- **THEN** the note's front matter contains `owner: inguyen`

### Requirement: The dates are written in a fixed, sortable format
The plugin SHALL write `created` and `last_reviewed` as a calendar date in
`YYYY-MM-DD` form, taken from the author's own clock, and SHALL write the same
date into both.

#### Scenario: Both dates match at creation
- **WHEN** the author creates a document
- **THEN** `created` and `last_reviewed` hold the same value, in `YYYY-MM-DD` form

### Requirement: A document cannot be created without a verified connection
The plugin SHALL refuse to create a document unless a connection check has
succeeded in the running session, and SHALL name what the author does next.
It SHALL distinguish details that were never entered from details that were
entered but never checked, because the author's next action differs. No
document SHALL be created in either case.

#### Scenario: No connection details have been entered
- **WHEN** the author runs the "New Document" command in a session where the connection details have not been filled in
- **THEN** no note is created and the author is told "Add your GitLab details in the plugin's settings first."

#### Scenario: Details entered but never checked
- **WHEN** the author runs the "New Document" command with all three connection details filled in but no successful connection check in this session
- **THEN** no note is created and the author is told "Test your connection in the plugin's settings before creating a document."

#### Scenario: The connection check failed
- **WHEN** the author runs the "New Document" command in a session where the most recent connection check did not succeed
- **THEN** no note is created and the author is told "Test your connection in the plugin's settings before creating a document."

#### Scenario: The connection was checked at the start of the session
- **WHEN** the author runs a successful connection check and later creates a document without checking again
- **THEN** the document is created, and no new connection check is performed on its behalf

### Requirement: A document cannot be created without Developer access
The plugin SHALL refuse to create a document when the connected account's role
on the configured project is below Developer, and SHALL name the role the
author holds and what to do next. This SHALL be enforced wherever the action is
triggered, including the command palette, and not only by hiding the panel
control.

#### Scenario: A role that can read but not contribute
- **WHEN** the author runs the "New Document" command while connected as an account holding Reporter on the configured project
- **THEN** no note is created and the author is told "Your Reporter access lets you read this project's documents but not add to them. Ask your admin for Developer access."

#### Scenario: A role that grants nothing
- **WHEN** the author runs the "New Document" command while connected as an account whose role on the configured project grants no access to its documents
- **THEN** no note is created and the author is told "Your GitLab account does not have access to this project's documents. Ask your admin for access."

#### Scenario: Developer access
- **WHEN** the author runs the "New Document" command while connected as an account holding Developer, Maintainer, or Owner on the configured project
- **THEN** the document is created

### Requirement: Creating a document makes no request to the platform
The plugin SHALL create a document using only the connection result it already
retains from the session's connection check, and SHALL NOT make any request to
the platform while creating one.

#### Scenario: Creating a document while the network is unavailable
- **WHEN** the author has run a successful connection check earlier in the session, the network then becomes unavailable, and the author creates a document
- **THEN** the document is created with its front matter filled in, and no request is attempted

### Requirement: An author can submit a document for review
The plugin SHALL offer a "Submit for review" action for the currently open
document. Selecting it SHALL open a modal collecting `title` and `category`
and showing the document's target remote path, before any remote call is
made.

#### Scenario: Opening the submit modal
- **WHEN** the author selects "Submit for review" for the currently open document
- **THEN** a modal opens showing a title field, a category field, and the document's target remote path, and no remote call has yet been made

### Requirement: A document cannot be submitted without a verified connection
The plugin SHALL refuse to open the submit modal unless a connection check
has succeeded in the running session, and SHALL name what the author does
next, exactly as document creation already does.

#### Scenario: Details entered but never checked
- **WHEN** the author selects "Submit for review" with all three connection details filled in but no successful connection check in this session
- **THEN** the modal does not open and the author is told "Test your connection in the plugin's settings before creating a document."

### Requirement: A document cannot be submitted without Developer access
The plugin SHALL refuse to open the submit modal when the connected
account's role on the configured project is below Developer, and SHALL name
the role the author holds and what to do next, exactly as document creation
already does.

#### Scenario: A role that can read but not contribute
- **WHEN** the author selects "Submit for review" while connected as an account holding Reporter on the configured project
- **THEN** the modal does not open and the author is told "Your Reporter access lets you read this project's documents but not add to them. Ask your admin for Developer access."

### Requirement: Category is one of nine fixed values
The submit modal's category field SHALL offer exactly the nine values: User
Manual, Operational Manual, Release FAQ, SOP, Runbook, Configuration
Reference, Diagnostic Reference, Known Errors, Safe-Action Boundaries. It
SHALL NOT allow a free-text value or a tenth option.

#### Scenario: Choosing a category
- **WHEN** the author opens the category field in the submit modal
- **THEN** exactly the nine fixed values are offered and no free-text entry is accepted

### Requirement: Submission is blocked until title and category are both present
The plugin SHALL NOT proceed past the submit modal while `title` or
`category` is empty. This SHALL be enforced in the modal itself, not
discovered as a failure after the remote calls begin.

#### Scenario: Attempting to submit with a field empty
- **WHEN** the author has left `title` or `category` empty in the submit modal
- **THEN** the submit control is disabled and no remote call is made

### Requirement: The author sees the document's target remote path before its identity freezes
The submit modal SHALL show the document's resolved target remote path — the
note's current vault path — as a read-only line, visible before the author
confirms submission and before `doc_id` is derived.

#### Scenario: The target path reflects the note's current location
- **WHEN** the author opens the submit modal for a note at `Smart Buddy POS/Known-errors/CEPAS 3 Payments Fail with Error 200.md`
- **THEN** the modal shows that path as the document's target remote path

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

### Requirement: A successful submission confirms with the pending state's label
On a successful first submission, the plugin SHALL confirm to the author
using the pending state's author-facing label, as defined by
submission-tracking.

#### Scenario: Confirmation after a successful submission
- **WHEN** a document's first submission completes successfully
- **THEN** the author is shown "Waiting for review"
