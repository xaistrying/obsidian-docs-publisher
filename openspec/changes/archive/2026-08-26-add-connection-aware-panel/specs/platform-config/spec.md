## ADDED Requirements

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

## MODIFIED Requirements

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
