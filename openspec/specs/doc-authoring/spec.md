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
When the author confirms the submit modal, the plugin SHALL derive a
candidate `doc_id` from the note's filename at that moment, ASCII-folding
Vietnamese diacritics and rejecting a filename containing a space, any of
`~^:?*[\`, a leading dot, or a trailing `.lock`. A note whose filename fails
this validation SHALL NOT be submitted.

#### Scenario: A ref-legal filename is accepted
- **WHEN** the author confirms the submit modal for a note named `SBT-KE-004_New-Terminal-Setup.md`
- **THEN** the candidate `doc_id` is derived from that filename and validation passes

#### Scenario: A filename that is not ref-legal is refused
- **WHEN** the author confirms the submit modal for a note whose filename contains a space
- **THEN** no remote call is made, and the author is told to rename the file before submitting

### Requirement: Front matter is completed only after the document reaches the remote
The plugin SHALL NOT write `title`, `category`, or `doc_id` into the note's
front matter until both the remote commit and the merge request have
succeeded. On any failure of either, the note's front matter SHALL remain
exactly as it was before the submit attempt.

#### Scenario: Front matter after a successful submission
- **WHEN** a document's first submission completes successfully with title "CEPAS 3 Payments Fail with Error 200" and category "Diagnostic Reference"
- **THEN** the note's front matter now contains `title: CEPAS 3 Payments Fail with Error 200`, `category: Diagnostic Reference`, and `doc_id` set to the filename that was current at confirm time

#### Scenario: Front matter after a failed submission
- **WHEN** a document's first submission attempt fails, for any reason
- **THEN** the note's front matter contains none of `title`, `category`, or `doc_id`

### Requirement: A submit failure is reported as one undifferentiated outcome
The plugin SHALL NOT distinguish, in what it tells the author, between a
remote rejection because the target branch already exists and a failure of
unknown outcome such as a dropped connection. Both SHALL produce the same
message, naming the same recovery action.

#### Scenario: The remote reports the branch already exists
- **WHEN** the commit call fails because a branch matching the candidate `doc_id` already exists on the remote
- **THEN** the author is told "Submit didn't go through. This can happen from a dropped connection, or because another document is already using this file name. Rename the file to get a new ID, then submit again."

#### Scenario: The connection drops mid-submission
- **WHEN** the network becomes unavailable after the commit call has been sent but before its outcome is known
- **THEN** the author is told the same message as the branch-already-exists case, with no attempt to determine which occurred

### Requirement: A successful submission confirms with the pending state's label
On a successful first submission, the plugin SHALL confirm to the author
using the pending state's author-facing label, as defined by
submission-tracking.

#### Scenario: Confirmation after a successful submission
- **WHEN** a document's first submission completes successfully
- **THEN** the author is shown "Waiting for review"
