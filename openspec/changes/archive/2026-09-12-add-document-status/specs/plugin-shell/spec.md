## ADDED Requirements

### Requirement: The panel lists the author's documents with their current state
The sidebar view SHALL list every note in the vault whose front matter
carries a `doc_id`, showing each one's name and its current state's
author-facing label. Notes carrying no `doc_id` SHALL NOT appear in the
list.

#### Scenario: Documents are listed with their states
- **WHEN** the author opens the sidebar view in a vault holding one published document, one awaiting review and one that was not accepted
- **THEN** all three are listed, each showing its own state's label

#### Scenario: Notes that have never been submitted are not listed
- **WHEN** the author opens the sidebar view in a vault holding many notes, only some of which carry `doc_id`
- **THEN** only the notes carrying `doc_id` appear in the list

#### Scenario: The list is empty before anything has been submitted
- **WHEN** the author opens the sidebar view in a vault where no document has been submitted
- **THEN** the list shows nothing rather than an error, and the view's existing controls are unaffected

### Requirement: States are refreshed on opening the panel and on request, never on editing
The sidebar view SHALL refresh states from the remote when the view is
opened and when the author selects a refresh control, and SHALL NOT make any
remote request in response to the note being changed, the active note
changing, or the note's metadata changing.

This is normative rather than incidental: the view already re-renders on all
three of those events, so rendering and refreshing must stay separate or
every keystroke touching front matter becomes a request.

#### Scenario: Opening the panel refreshes
- **WHEN** the author opens the sidebar view
- **THEN** states are refreshed from the remote once

#### Scenario: The author refreshes on request
- **WHEN** the author selects the refresh control
- **THEN** states are refreshed from the remote and the list redraws with the result

#### Scenario: Editing a note does not refresh
- **WHEN** the author types in a note, switches to a different note, or edits a note's front matter while the sidebar view is open
- **THEN** the view redraws from the states it already has, and no remote request is made

### Requirement: A refresh that fails keeps the last known states and says so
When a refresh does not succeed, the sidebar view SHALL continue showing the
states it last resolved, SHALL say that the refresh did not succeed, and
SHALL NOT present the states shown as freshly confirmed. It SHALL NOT clear
the list.

#### Scenario: A refresh fails while states are already on screen
- **WHEN** a refresh fails and the view is already showing resolved states
- **THEN** those states remain on screen and the author is told "Could not check your documents' status just now. They may have changed since this was last updated."

#### Scenario: A refresh is refused for a missing permission
- **WHEN** a refresh is refused because the access token lacks the permission needed to read the project's review queue, and the platform names that permission
- **THEN** the author is told "Your access token doesn't have permission to check your documents' status (missing: Merge Request: Read). Ask your admin to add it."

#### Scenario: The very first refresh fails with nothing to fall back on
- **WHEN** a refresh fails and the view has never resolved any state
- **THEN** the author is told the refresh did not succeed and no document is shown with a state that was never established

### Requirement: Each listed document offers a way to open it on the platform
The sidebar view SHALL offer, for each listed document that has been
submitted, a link that opens that document's review on the platform in the
author's browser.

#### Scenario: Opening a document's review
- **WHEN** the author selects the link beside a listed document that has been submitted
- **THEN** that document's review opens on the platform in the author's browser

#### Scenario: A document with nothing to open
- **WHEN** a listed document resolved as never submitted
- **THEN** no such link is offered for it
