## MODIFIED Requirements

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
action differs in each. Where the person connected as is known, the view SHALL
still name them, so the author can see that their details were accepted and
their role is the obstacle.

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

## ADDED Requirements

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
