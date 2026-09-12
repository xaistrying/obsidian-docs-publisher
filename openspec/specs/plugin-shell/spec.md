# Plugin Shell Specification

## Purpose

This capability defines the foundational plugin shell: the core infrastructure that allows the Obsidian plugin to load, register a sidebar view, and expose entry points for opening that view. This is the baseline all future plugin capabilities are built upon.

## Requirements

### Requirement: Plugin loads without error
The plugin SHALL load successfully when enabled in Obsidian, registering
its sidebar view type without throwing an error or preventing other
plugins from loading.

#### Scenario: Plugin enabled in a vault
- **WHEN** a user enables the plugin in Obsidian's Community Plugins settings
- **THEN** the plugin loads without error and no error notice appears

### Requirement: Sidebar view opens from the ribbon icon
The plugin SHALL add a ribbon icon that opens the plugin's sidebar view
in the right sidebar when clicked.

#### Scenario: Clicking the ribbon icon with the view closed
- **WHEN** the user clicks the plugin's ribbon icon and the sidebar view is not currently open
- **THEN** the sidebar view opens in the right sidebar and becomes the active leaf

### Requirement: Sidebar view opens from the command palette
The plugin SHALL register a command, discoverable in the command
palette, that opens the same sidebar view as the ribbon icon.

#### Scenario: Running the command with the view closed
- **WHEN** the user runs the plugin's command from the command palette and the sidebar view is not currently open
- **THEN** the sidebar view opens in the right sidebar, identical to clicking the ribbon icon

### Requirement: Opening the view never creates a duplicate panel
The plugin SHALL reveal the existing instance of the sidebar view rather
than opening a second one, regardless of which entry point is used or
how many times it is triggered.

#### Scenario: Triggering either entry point while the view is already open
- **WHEN** the sidebar view is already open and the user clicks the ribbon icon or runs the command again
- **THEN** the existing view is revealed and no additional panel is created

#### Scenario: Alternating entry points
- **WHEN** the user opens the view via the ribbon icon, then triggers the command palette entry
- **THEN** the same single view instance is revealed, not a second one

#### Scenario: Two triggers in rapid succession from a closed state
- **WHEN** the view is closed and the user triggers either entry point twice in immediate succession, faster than the first open completes
- **THEN** exactly one panel exists afterwards

### Requirement: The sidebar view shows the current connection state
The plugin's sidebar view SHALL render the plugin's current connection state
whenever it is open, and SHALL update itself when that state changes without
the author reopening it. It SHALL distinguish five situations: no check has
been run, a check is in progress, a check succeeded and the author can create
documents, a check succeeded and the author can only read, and the author
cannot work. The view SHALL always show enough for the author to know what to
do next, and SHALL NOT render an empty container or fixed text that is the
same whether or not the plugin is connected.

#### Scenario: Opening the view before any connection has been checked
- **WHEN** the author opens the sidebar view in a session where no connection check has succeeded
- **THEN** the view shows "Not connected yet", the message "Add your GitLab details to start publishing documents.", a control labelled "Open settings", and the note "You enter these once each time you start Obsidian."

#### Scenario: A check is running
- **WHEN** a connection check is in progress while the sidebar view is open
- **THEN** the view shows "Checking…"

#### Scenario: Connected with access to create documents
- **WHEN** a connection check has succeeded and the author's role on the configured project is Developer, Maintainer, or Owner
- **THEN** the view names the person connected as, names their role as "<role> access", shows "Ready to publish your documentation.", and offers a control labelled "New Document"

#### Scenario: Connected with read-only access
- **WHEN** a connection check has succeeded and the author's role on the configured project is Planner or Reporter
- **THEN** the view names the person connected as, names their role as "<role> access", shows "Your <role> access lets you read this project's documents but not add to them. Ask your admin for Developer access.", offers a control labelled "Open settings", and does not offer "New Document"

#### Scenario: The view updates without being reopened
- **WHEN** the sidebar view is open and the retained connection result changes for any reason
- **THEN** the view reflects the new state without the author closing and reopening it

#### Scenario: The view is closed while a check is running
- **WHEN** the author closes the sidebar view while a connection check is in progress and the check then finishes
- **THEN** no error occurs, and opening the view again shows the finished outcome

### Requirement: The sidebar view explains what blocks the author and offers a way on
When the author cannot work, the sidebar view SHALL say why in a sentence
naming what to do next, and SHALL offer a control labelled "Open settings".
It SHALL distinguish a role that grants no access from a role that grants
reading only, and both from a failure to connect, because the author's next
action differs in each. Where the person connected as is known, the view
SHALL still name them, so the author can see that their details were accepted
and their role is the obstacle.

#### Scenario: The role grants no access to the project's documents
- **WHEN** a connection check has succeeded but the author's role on the configured project grants them no access to its documents
- **THEN** the view names the person connected as, names their role, and shows "Your GitLab account does not have access to this project's documents. Ask your admin for access." with a control labelled "Open settings"

#### Scenario: The project could not be reached
- **WHEN** a connection check identified the author but could not reach the configured project
- **THEN** the view names the person connected as and shows "That project could not be found, or your access does not include it. Check your details in settings." with a control labelled "Open settings"

#### Scenario: The access token was rejected
- **WHEN** a connection check failed because the server rejected the token
- **THEN** the view shows "Your access has expired or is incorrect. Ask your admin to set it up again." with a control labelled "Open settings", and names nobody

#### Scenario: The server could not be reached
- **WHEN** a connection check failed because the address was wrong or the network was unavailable
- **THEN** the view shows "Could not reach GitLab at that address. Check the address and your connection, then try again." with a control labelled "Open settings"

#### Scenario: The check failed for any other reason
- **WHEN** a connection check failed for any reason other than those above
- **THEN** the view shows "The connection check did not succeed. Check your details in settings and try again." with a control labelled "Open settings", and displays no status code or raw error text

#### Scenario: Selecting the control from a blocked state
- **WHEN** the author selects "Open settings" from any state in which the view offers it
- **THEN** the plugin's settings tab is opened, or the author is told how to reach it by hand

### Requirement: The panel offers document creation only where it can succeed
The sidebar view SHALL offer the "New Document" control only in the state where
creating a document would succeed, and SHALL NOT show it disabled, greyed, or
otherwise present in any other state. Selecting it SHALL create a document
through the same path as the command palette entry.

#### Scenario: The control is absent before a check has run
- **WHEN** the author opens the sidebar view in a session where no connection check has succeeded
- **THEN** no "New Document" control appears anywhere in the view

#### Scenario: The control appears when the author gains access
- **WHEN** the sidebar view is open showing a read-only or blocked state, and a later connection check succeeds with Developer access or above
- **THEN** the "New Document" control appears without the author reopening the view

#### Scenario: The control disappears when a connection detail is edited
- **WHEN** the sidebar view is open offering "New Document" and the author edits any connection detail in the settings tab
- **THEN** the view returns to its not-connected state and the "New Document" control is no longer offered

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

### Requirement: The panel offers recovery for tracked documents with no matching note
The sidebar view SHALL list every persisted tracking record whose `doc_id`
matches no note currently in the vault, separately from the list of
documents built from the vault. For each, it SHALL offer a way to recover
the document when its content can be located, and SHALL otherwise state
plainly that automatic recovery is not available and offer the existing way
to open it on the platform instead.

#### Scenario: A recoverable orphaned record is listed
- **WHEN** the vault holds no note for a persisted record, and that document's content can be located
- **THEN** the record is listed with a way to recover it

#### Scenario: A non-recoverable orphaned record is listed with an explanation
- **WHEN** the vault holds no note for a persisted record, and that document's content cannot be located
- **THEN** the record is listed stating recovery is not available, with a way to open it on the platform instead

#### Scenario: Nothing to recover
- **WHEN** every persisted record matches a note in the vault
- **THEN** this list shows nothing rather than an empty-state message competing with the main document list

### Requirement: Recovery fetches content only when the author asks for it
Listing which orphaned records exist SHALL make no remote request. A remote
request to read a document's content SHALL be made only when the author
selects that document's recovery action.

#### Scenario: Listing orphaned records makes no request
- **WHEN** the panel renders the list of documents with no matching note
- **THEN** no request is made to determine which are listed

#### Scenario: Recovering one document requests only that document's content
- **WHEN** the author selects the recovery action for one listed document
- **THEN** a request is made for that document's content, and no request is made for any other listed document
