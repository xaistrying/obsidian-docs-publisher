## ADDED Requirements

### Requirement: The sidebar view shows the current connection state
The plugin's sidebar view SHALL render the plugin's current connection state
whenever it is open, and SHALL update itself when that state changes without
the author reopening it. It SHALL distinguish four situations: no check has
been run, a check is in progress, a check succeeded and the author can work,
and the author cannot work. The view SHALL always show enough for the author
to know what to do next, and SHALL NOT render an empty container or fixed
text that is the same whether or not the plugin is connected.

#### Scenario: Opening the view before any connection has been checked
- **WHEN** the author opens the sidebar view in a session where no connection check has succeeded
- **THEN** the view shows "Not connected yet", the message "Add your GitLab details to start publishing documents.", a control labelled "Open settings", and the note "You enter these once each time you start Obsidian."

#### Scenario: A check is running
- **WHEN** a connection check is in progress while the sidebar view is open
- **THEN** the view shows "Checking…"

#### Scenario: Connected with access to the project's documents
- **WHEN** a connection check has succeeded and the author's role on the configured project grants them access to its documents
- **THEN** the view names the person connected as, names their role as "<role> access", and shows "Ready to publish your documentation."

#### Scenario: The view updates without being reopened
- **WHEN** the sidebar view is open and the retained connection result changes for any reason
- **THEN** the view reflects the new state without the author closing and reopening it

#### Scenario: The view is closed while a check is running
- **WHEN** the author closes the sidebar view while a connection check is in progress and the check then finishes
- **THEN** no error occurs, and opening the view again shows the finished outcome

### Requirement: The sidebar view explains what blocks the author and offers a way on
When the author cannot work, the sidebar view SHALL say why in a sentence
naming what to do next, and SHALL offer a control labelled "Open settings".
It SHALL distinguish a role that grants no access from a failure to connect,
because the author's next action differs. Where the person connected as is
known, the view SHALL still name them, so the author can see that their
details were accepted and their role is the obstacle.

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

## REMOVED Requirements

### Requirement: The sidebar view shows placeholder content
**Reason**: The view now renders the plugin's current connection state, which
is identifiable content in every situation and is never the same twice over.
The placeholder requirement existed to keep the view from looking broken
before it had anything real to show; it has something real to show now, and
keeping the requirement would permit fixed text that is identical whether or
not the author is connected — the exact defect this change exists to remove.

**Migration**: Replaced by "The sidebar view shows the current connection
state" above, which is strictly stronger: it requires identifiable content in
all four situations, names the exact copy for each, and additionally requires
the view to update itself when the state changes. Nothing the removed
requirement guaranteed is lost.
