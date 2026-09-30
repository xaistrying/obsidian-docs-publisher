# Platform Config Specification

## Purpose

This capability defines how the author supplies and verifies the connection
details (address, project path, access token) the plugin needs to reach a
remote git hosting platform, and how the plugin guards other actions that
depend on those details.

## Requirements

### Requirement: The plugin has a settings tab with three connection fields
The plugin SHALL register a settings tab containing three separate text
inputs — the GitLab address, the project path, and an access token — and the
token input SHALL mask its contents so a pasted token is not left readable on
screen.

The tab SHALL name the permissions a token actually needs, rather than
deferring the question. It previously said only that the exact permissions
were assigned by an admin, because nobody knew what they were: GitLab exposes
no endpoint reporting which permissions a fine-grained token holds, so they
could only be learned by attempting each call and reading what a refusal
named. Once established, withholding them would leave every author asking an
admin for an unspecified grant, and every admin guessing.

#### Scenario: Opening the settings tab for the first time
- **WHEN** the author opens the plugin's settings tab after enabling the plugin
- **THEN** three empty inputs are shown, labelled for the GitLab address, the project path, and the access token, with the token input masked

#### Scenario: Settings tab explains where to get a token
- **WHEN** the author views the settings tab
- **THEN** it names the fine-grained access token flow as the place to create a token

#### Scenario: Settings tab names the permissions the token needs
- **WHEN** the author views the settings tab
- **THEN** it lists the permissions a token needs for this plugin's operations, so the author can tick them or send the list to whoever creates the token for them

#### Scenario: The list covers what the plugin actually calls, and no more
- **WHEN** the listed permissions are compared against the operations the plugin performs
- **THEN** every listed permission is one some operation requires, and no permission is listed for an operation the plugin does not perform

### Requirement: The access token is kept for the session only
The plugin SHALL hold the access token in memory for the running session and
SHALL NOT write it to plugin data or any file. Reopening the settings tab
within the same session SHALL show it still filled in. Restarting Obsidian or
reloading the plugin SHALL discard it.

No structure the plugin persists SHALL have a field that can hold the token.
"Not saved" is meant structurally, not by convention: an absent field cannot
be written by a later change that forgets the rule, and a field that only
happens to be left empty can.

#### Scenario: Closing and reopening the settings tab in one session
- **WHEN** the author fills in all three fields, closes the settings tab, and opens it again without restarting Obsidian
- **THEN** the three fields are still filled in with the values they entered

#### Scenario: Restarting Obsidian
- **WHEN** the author fills in all three fields, selects "Test connection", then quits and reopens Obsidian
- **THEN** the access token field is empty and the author pastes the token again

#### Scenario: No credential is written to disk
- **WHEN** the author fills in all three fields and uses the connection check
- **THEN** no file in the vault contains the access token, including the plugin's own data file

### Requirement: The GitLab address and project ID are remembered once tested
When the author selects "Test connection" with all three fields filled in, the
plugin SHALL save the GitLab address and the project ID to its own data file
as they were entered, whatever the outcome of the check. When Obsidian starts
or the plugin loads, the plugin SHALL fill both values back into the settings
tab.

They are saved on "Test connection" rather than on every edit, because that
is the moment the author commits to the values. Saving on every keystroke
would rewrite the data file, and every tracking record in it, once per
character. They are saved regardless of the outcome because a check most
often fails for a reason that has nothing to do with these two values, such
as an expired token or no network. Discarding a correct address because the
token had lapsed would cost the author the very step this saving exists to
spare them.

Filling in saved values at start-up SHALL NOT start a connection check and
SHALL NOT count as a successful one. The plugin SHALL start in its
not-checked state, exactly as it would with nothing saved, because no token
is present to check with.

The settings tab SHALL tell the author which values are remembered and which
are not, with the text "Your GitLab address and project ID are remembered
after you test the connection. Your access token is kept for this Obsidian
session only and never written to disk, so you paste it again after a
restart."

#### Scenario: The address and project ID survive a restart
- **WHEN** the author fills in all three fields, selects "Test connection", then quits and reopens Obsidian and opens the settings tab
- **THEN** the GitLab address and project ID fields show the values they tested with, and the access token field is empty

#### Scenario: Values that were never tested are not remembered
- **WHEN** the author types an address and a project ID, does not select "Test connection", and restarts Obsidian
- **THEN** the settings tab shows whatever was last saved, or nothing if nothing was ever saved

#### Scenario: A failed check still remembers the values
- **WHEN** the author selects "Test connection" with all three fields filled in and the check fails
- **THEN** the address and project ID are still saved, and appear in the settings tab after a restart

#### Scenario: Testing different values replaces the saved ones
- **WHEN** saved values exist and the author changes the address or project ID and selects "Test connection"
- **THEN** the newly tested values replace the saved ones

#### Scenario: A check with an empty field saves nothing
- **WHEN** the author selects "Test connection" with any of the three fields empty
- **THEN** the settings tab shows "Fill in all three fields before testing the connection." and nothing is saved

#### Scenario: Start-up with saved values is not a connection
- **WHEN** Obsidian starts with a saved address and project ID
- **THEN** no connection check runs, the plugin reports that it is not connected, and every action that needs the connection behaves as it does before any check in a session

#### Scenario: The settings tab says what is remembered
- **WHEN** the author views the settings tab
- **THEN** it shows "Your GitLab address and project ID are remembered after you test the connection. Your access token is kept for this Obsidian session only and never written to disk, so you paste it again after a restart."

#### Scenario: A data file from before this change
- **WHEN** the plugin loads a data file that holds tracking records and no saved address or project ID
- **THEN** every tracking record loads unchanged and the address and project ID fields are empty

### Requirement: A connection check reports who the plugin connected as
The settings tab SHALL provide a "Test connection" control that verifies the
entered values, records the outcome as the retained session result, and
reports that outcome in the settings tab. On success it SHALL name the person
the plugin connected as and the access they hold on the configured project.
The settings tab SHALL display the retained result rather than an outcome it
keeps privately, so that it and every other surface always agree.

#### Scenario: Valid details for a project the author can reach
- **WHEN** the author enters a valid address, project path, and token, and selects "Test connection"
- **THEN** the settings tab shows "Connected as <name> — <access> access" naming that person and their access level on that project

#### Scenario: Check runs only when asked
- **WHEN** the author opens the settings tab, opens the plugin's panel, or Obsidian starts with the plugin enabled
- **THEN** no connection check is performed until the author selects "Test connection"

#### Scenario: Details entered but never checked
- **WHEN** the author fills in all three values and opens the plugin's panel without selecting "Test connection"
- **THEN** the panel reports that it is not connected, and no check is started on its behalf

#### Scenario: Result while the check is in progress
- **WHEN** the author selects "Test connection" and the result has not come back yet
- **THEN** the settings tab shows "Checking…" and the control cannot be triggered a second time until the check finishes

#### Scenario: A check in progress is visible on every surface
- **WHEN** the author selects "Test connection" while the plugin's panel is open and the result has not come back yet
- **THEN** the panel also shows "Checking…" for as long as the check is running

### Requirement: The connection check states exactly why it failed
Every failure of the connection check SHALL be reported in the settings tab
with a message naming what to do next. The plugin SHALL distinguish a rejected
token, an unreachable project, and a failure to reach the server at all, and
SHALL NOT report a raw status code or an unexplained failure.

#### Scenario: One or more fields are empty
- **WHEN** the author selects "Test connection" with any of the three fields empty
- **THEN** the settings tab shows "Fill in all three fields before testing the connection." and no request is made

#### Scenario: The token is rejected or has expired
- **WHEN** the author selects "Test connection" and the server rejects the token
- **THEN** the settings tab shows "Your access has expired — ask your admin to set it up again."

#### Scenario: The project cannot be reached with this token
- **WHEN** the author selects "Test connection" with a valid token but a project path that does not exist or that their access does not cover
- **THEN** the settings tab shows "That project could not be found, or your access does not include it. Check the project path above."

#### Scenario: The server cannot be reached
- **WHEN** the author selects "Test connection" and the address is wrong or the network is unavailable
- **THEN** the settings tab shows "Could not reach GitLab at that address. Check the address above and your connection, then try again."

#### Scenario: An unexpected failure
- **WHEN** the author selects "Test connection" and the attempt fails for any reason other than those above
- **THEN** the settings tab shows "The connection check did not succeed. Check the details above and try again." and does not display a status code or raw error text

### Requirement: Connection details are required before any action that needs them
Any action elsewhere in the plugin that requires the connection details SHALL
check that all three are present before attempting anything, and SHALL direct
the author to the settings tab when they are not.

#### Scenario: An action is attempted with no details entered
- **WHEN** the author triggers an action needing the connection details in a session where they have not entered them
- **THEN** the action does not run and the author is told "Add your GitLab details in the plugin's settings first."

### Requirement: The result of the connection check is kept for the session
The plugin SHALL retain the outcome of the most recent connection check for
the running session, holding at minimum whether a check has been run, whether
one is in progress, the name of the person connected as when known, and the
access held on the configured project when known. This outcome SHALL be
readable by any part of the plugin, SHALL NOT be written to plugin data or
any file, and SHALL be discarded when Obsidian restarts or the plugin
reloads. Any part of the plugin displaying this outcome SHALL be notified
when it changes, so that a check started on one surface is reflected on every
other surface without either referring to the other.

#### Scenario: A check started in the settings tab reaches an open panel
- **WHEN** the author has the plugin's panel open, enters all three details in the settings tab, selects "Test connection", and closes the settings screen
- **THEN** the panel shows the outcome of that check without the author reopening or refreshing it

#### Scenario: The outcome survives closing the settings tab
- **WHEN** the author runs a successful check, closes the settings tab, and opens it again in the same session
- **THEN** the settings tab still shows the outcome of that check rather than a blank result

#### Scenario: The outcome does not survive a restart
- **WHEN** the author runs a successful check, then quits and reopens Obsidian
- **THEN** no outcome is retained, and the plugin reports that it is not connected until a new check is run

#### Scenario: No part of the outcome is written to disk
- **WHEN** the author runs a connection check
- **THEN** no file in the vault records the outcome, including the plugin's own data file

### Requirement: Changing a connection detail discards the previous result
Editing any of the three connection values SHALL discard the retained
outcome and return the plugin to its not-checked state, so that a previously
verified person is never reported alongside details that person was not
verified against. Editing a value SHALL NOT start a new check.

#### Scenario: Editing the address after a successful check
- **WHEN** the author runs a successful check and then changes any character of the GitLab address
- **THEN** the plugin reports that it is not connected, and no new check is started until the author selects "Test connection" again

#### Scenario: An open panel follows the reset
- **WHEN** the author has the panel open showing a successful result and then edits any of the three values in the settings tab
- **THEN** the panel stops showing that result and returns to its not-connected state

### Requirement: Access is reported using the platform's own role names
Wherever the plugin reports the access a person holds, it SHALL use the role
name the platform itself uses — Guest, Planner, Reporter, Developer,
Maintainer, or Owner — and SHALL NOT substitute a description of what that
role can do. Copy shown alongside a role SHALL state what the author should
do next, because the role name alone does not tell them what it means.

#### Scenario: Reporting a role
- **WHEN** a check succeeds for a person holding the Developer role on the configured project
- **THEN** the access is reported as "Developer access", and not as a description such as "Can submit"

#### Scenario: A role that grants nothing is still named
- **WHEN** a check succeeds for a person whose role on the configured project grants them no access to its documents
- **THEN** the role is still named, and the accompanying message tells the author to ask their admin for access

### Requirement: The settings tab can be opened from elsewhere in the plugin
The plugin SHALL provide a way for other surfaces to send the author to its
settings tab. When the plugin cannot open the settings tab itself, it SHALL
tell the author how to reach it by hand rather than appearing to do nothing.

#### Scenario: Opening the settings tab from the panel
- **WHEN** the author selects the control that opens settings from the plugin's panel
- **THEN** Obsidian's settings screen opens with this plugin's tab already selected

#### Scenario: The settings tab cannot be opened automatically
- **WHEN** the author selects that control and the plugin is unable to open the settings screen
- **THEN** the author is shown "Open Settings, then choose Docs Publisher under Community plugins." and the control does not silently do nothing
