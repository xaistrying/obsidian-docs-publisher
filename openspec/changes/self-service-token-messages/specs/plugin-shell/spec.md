## MODIFIED Requirements

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
- **THEN** the view shows "Your access token has expired or is incorrect. Check you pasted all of it, or create a new one in GitLab." with a control labelled "Open settings", and names nobody

#### Scenario: The server could not be reached
- **WHEN** a connection check failed because the address was wrong or the network was unavailable
- **THEN** the view shows "Could not reach GitLab at that address. Check the address and your connection, then try again." with a control labelled "Open settings"

#### Scenario: The check failed for any other reason
- **WHEN** a connection check failed for any reason other than those above
- **THEN** the view shows "The connection check did not succeed. Check your details in settings and try again." with a control labelled "Open settings", and displays no status code or raw error text

#### Scenario: Selecting the control from a blocked state
- **WHEN** the author selects "Open settings" from any state in which the view offers it
- **THEN** the plugin's settings tab is opened, or the author is told how to reach it by hand

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
- **THEN** the author is told "Your access token doesn't have permission to check your documents' status (missing: Merge Request: Read). Create a new access token that includes it."

#### Scenario: The very first refresh fails with nothing to fall back on
- **WHEN** a refresh fails and the view has never resolved any state
- **THEN** the author is told the refresh did not succeed and no document is shown with a state that was never established

