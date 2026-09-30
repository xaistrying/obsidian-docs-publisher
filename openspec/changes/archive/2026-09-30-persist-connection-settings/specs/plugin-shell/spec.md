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
- **THEN** the view shows "Not connected yet", the message "Add your GitLab details to start publishing documents.", a control labelled "Open settings", and the note "You paste your access token once each time you start Obsidian."

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
