## ADDED Requirements

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
