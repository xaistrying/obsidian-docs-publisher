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

### Requirement: A first submission is refused when its target path already holds a published document
This capability SHALL, before writing anything, refuse a submission for
which no `doc_id` yet exists in front matter if a file already exists at
that note's path on the project's default branch, regardless of whether any
branch or merge request for that path currently exists. It SHALL NOT perform
this check for a document that already carries a `doc_id`.

#### Scenario: A first submission collides with an already-published document
- **WHEN** a note with no `doc_id` is submitted and a file already exists at its path on the project's default branch
- **THEN** the submission is refused before any remote write, and nothing is created or deleted

#### Scenario: A document's own revision is never checked against itself
- **WHEN** a note that already carries a `doc_id` is submitted again
- **THEN** this check does not run, since that document's path is already its own

#### Scenario: A first submission proceeds when the path is free
- **WHEN** a note with no `doc_id` is submitted and no file exists at its path on the project's default branch
- **THEN** this check does not block the submission

#### Scenario: The check does not succeed
- **WHEN** the existence check fails for any reason
- **THEN** the submission is refused and nothing is written, rather than proceeding on an assumption that the path is free

### Requirement: A refused first submission offers to recover the document already there
When a submission is refused under the requirement above, this capability
SHALL offer the author a way to recover the already-existing document into
the vault, using the content already read while performing the check.

#### Scenario: The refusal offers recovery
- **WHEN** a first submission is refused because a document already exists at its path
- **THEN** the author is offered a way to recover that document rather than only being told the submission failed

### Requirement: A recovered document is restored only to its original remote path
This capability SHALL create a recovered document's note at exactly the
remote path its content was read from, and SHALL NOT place it at any other
local path.

#### Scenario: Recovery uses the exact remote path
- **WHEN** a document is recovered
- **THEN** the note is created at the same path, relative to the vault root, that its content was read from on the remote

### Requirement: Recovery never overwrites a note already at its target path
This capability SHALL refuse to recover a document whose target path is
already occupied by a note in the vault, and SHALL write nothing in that
case.

#### Scenario: The target path is already occupied
- **WHEN** recovery's target path already holds a note
- **THEN** recovery is refused and neither that note nor any other file is modified

#### Scenario: The target path is free
- **WHEN** recovery's target path holds no note
- **THEN** a new note is created there with the recovered content

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

### Requirement: Reset replaces a note's content with the version under review
The plugin SHALL, on the author's explicit request for a document whose
resolved state is pending or changes-requested, replace the open note's
entire content with the content that document currently carries on its own
tracked branch. It SHALL write the remote's content verbatim, including
front matter, so the note afterwards matches what reviewers are looking at
byte for byte.

It SHALL NOT write a tracking record, SHALL NOT change the document's
state, and SHALL NOT re-assert any front matter field of its own.
Resetting local content changes nothing about the review.

#### Scenario: A note with local edits is reset
- **WHEN** the author resets a document whose note has been edited since it was last submitted
- **THEN** the note's content is replaced by the content on that document's tracked branch, front matter included, and the note matches that version exactly

#### Scenario: The document's state is untouched
- **WHEN** a document whose state is changes-requested is reset
- **THEN** its state is still changes-requested afterwards, and no tracking record was written

### Requirement: Reset always asks before overwriting, with no silent path
The plugin SHALL ask the author to confirm before every Reset, naming that
local changes to the note will be replaced by the version under review, and
SHALL provide no setting, option, or code path that performs the overwrite
without that confirmation. The prompt SHALL be dismissible without anything
being written.

This is the condition on which a deliberate, author-triggered Reset is
permitted at all while a document is awaiting review. The rule it is
exempted from exists to prevent silent loss of local edits, so an
unconfirmed Reset would be the exact case that rule forbids.

#### Scenario: The author confirms
- **WHEN** the author requests a Reset and confirms the prompt
- **THEN** the note's content is replaced

#### Scenario: The author dismisses the prompt
- **WHEN** the author requests a Reset and dismisses the prompt without confirming
- **THEN** nothing is written, and the note's content is exactly as it was

#### Scenario: There is no way to skip the prompt
- **WHEN** the plugin's Reset path is inspected
- **THEN** every route to the overwrite passes through the confirmation, and no setting disables it

### Requirement: Reset refuses rather than substituting content from elsewhere
The plugin SHALL refuse a Reset, writing nothing, when the document's
content cannot be read from its own tracked branch — whether the path is
absent there or the read did not succeed — and SHALL tell the author the
reset did not happen. It SHALL NOT fall back to any other source of
content.

#### Scenario: The tracked branch no longer holds the document
- **WHEN** a Reset is requested and the document's path is absent on its tracked branch, because the review ended since the panel last refreshed
- **THEN** the note is left untouched and the author is told the reset did not happen, rather than the note being replaced with content from anywhere else

#### Scenario: The read does not succeed
- **WHEN** a Reset is requested and the content read fails for any reason
- **THEN** the note is left untouched and the author is told the reset did not happen

### Requirement: A submission carries the images the document embeds
The plugin SHALL commit, alongside the note, every image the note embeds,
each at the same path it occupies in the vault relative to the vault root.
This SHALL apply to every write path: a first submission, an update to a
document under review, and a new cycle for a published or not-accepted
document.

#### Scenario: A first submission of a document with images
- **WHEN** the author submits a document whose note embeds two images
- **THEN** the note and both images are committed together, each at its own vault-relative path

#### Scenario: An update to a document under review
- **WHEN** the author sends an update for a document under review whose note embeds an image added since the last submission
- **THEN** the note and the newly embedded image are committed together to that document's existing branch

#### Scenario: A document that embeds nothing
- **WHEN** the author submits a document whose note embeds no images
- **THEN** the note alone is committed, exactly as before

### Requirement: Embeds are resolved through the vault's own resolver
The plugin SHALL resolve an embed written as a wikilink through the vault's
own link resolution, and SHALL NOT determine its location by matching
filenames from the note's text. A wikilink embed names a file, not a
location, and two folders may hold files of the same name.

An embed written as a markdown link SHALL be resolved as a path relative to
the note, and confirmed to exist in the vault before being carried.

#### Scenario: Two images share a filename in different folders
- **WHEN** a note embeds `![[diagram.png]]` as a wikilink, and the vault holds a `diagram.png` in two different folders
- **THEN** the image the vault's own resolver selects for that note is the one committed, not whichever file matched the name first

#### Scenario: A markdown-style embed
- **WHEN** a note embeds an image written as a markdown link with a path
- **THEN** that path is resolved relative to the note and the file it names is committed

### Requirement: An embed that cannot be resolved does not block the submission
The plugin SHALL skip an embed it cannot resolve to a file in the vault,
and SHALL submit the document without it. It SHALL NOT refuse the
submission, and SHALL NOT fail after a partial write.

A broken link in the author's own note is not a reason to stop them
publishing, and refusing would make a typo block a document.

#### Scenario: A note embeds an image that does not exist
- **WHEN** the author submits a document whose note embeds a filename matching no file in the vault
- **THEN** the submission proceeds, carrying the note and any embeds that did resolve, and is not refused

#### Scenario: A note embeds a file outside the vault
- **WHEN** a note's embed resolves to a location outside the vault
- **THEN** that embed is skipped and the submission proceeds

### Requirement: An attachment already on the remote is updated, not recreated
For each file a submission carries, the plugin SHALL determine whether that
path already exists on the ref being committed to, and SHALL update it
carrying its current commit identifier where it does, or create it where it
does not. This SHALL apply to attachments exactly as it already applies to
the note.

#### Scenario: An image shared with other documents
- **WHEN** the author submits a document embedding an image whose path already exists on the remote, because other documents embed the same image
- **THEN** that image is committed as an update carrying its current commit identifier, not as a new file

#### Scenario: An image nobody has published before
- **WHEN** the author submits a document embedding an image whose path does not exist on the remote
- **THEN** that image is committed as a new file

#### Scenario: A shared image changed since it was read
- **WHEN** a submission carries an update to a shared image whose remote copy changed after its commit identifier was read
- **THEN** the write is refused rather than silently overwriting it, and the author is told the document changed since they last opened it

### Requirement: The plugin never deletes a remote attachment
The plugin SHALL NOT delete any attachment from the remote, under any
circumstance, including when a note stops embedding an image or embeds it
from a different path.

#### Scenario: An author removes an image from a note
- **WHEN** the author removes an embed from a note and submits the document again
- **THEN** the image remains on the remote, and the submission neither deletes it nor fails because of it
