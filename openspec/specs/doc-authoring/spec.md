# Doc Authoring Specification

## Purpose

This capability defines how an author creates a new document from the plugin:
where the note is placed, what front matter is written at creation, and the
access and connection checks that gate the action. TBD: the fuller authoring
lifecycle (editing, submission, review) beyond document creation.

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
