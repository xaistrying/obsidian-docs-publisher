## ADDED Requirements

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

## REMOVED Requirements

### Requirement: Connection details are kept for the session only
**Reason**: This requirement treated all three values the same way, and only
the access token is a credential. The GitLab address and the project ID carry
no authority on their own. Re-entering them on every launch made the plugin's
not-connected state the author's daily first impression, and bought no
security in return.
**Migration**: The token's half of the rule carries forward, unchanged in
substance, as "The access token is kept for the session only". The address
and project ID are covered by "The GitLab address and project ID are
remembered once tested". Existing data files need no migration, because the
new saved values are optional and are absent until the first check after
upgrading.
