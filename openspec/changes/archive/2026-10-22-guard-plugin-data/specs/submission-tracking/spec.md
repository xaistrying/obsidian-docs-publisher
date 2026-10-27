## ADDED Requirements

### Requirement: Stored records are never overwritten when the stored file cannot be used
When the plugin starts, this capability SHALL tell a missing plugin data file
apart from one that exists but cannot be used. "Cannot be used" means the
file could not be read, it is not valid JSON, or it is valid JSON with no
`submissions` object. A missing file SHALL be treated as a first run: the
plugin starts with no records and shows nothing. For an unusable file, the
plugin SHALL keep a copy before anything overwrites it, then start with no
records, and tell the author once. If no copy can be kept, the plugin SHALL
write nothing to its data file for the rest of the session. A malformed
remembered connection on its own SHALL NOT make the file count as unusable.
Each notice SHALL stay on screen until the author dismisses it.

#### Scenario: First run with no data file
- **WHEN** the plugin starts and its data file does not exist
- **THEN** it starts with no records, shows no notice, and keeps no copy

#### Scenario: The data file is not valid JSON
- **WHEN** the plugin starts and its data file exists but is empty, truncated, or not valid JSON
- **THEN** the plugin copies it, byte for byte, to a new `data-unreadable-<timestamp>.json` in the plugin's folder, writes a fresh data file with no records, and shows exactly: "Docs Publisher couldn't read the information it saves about your documents, so it has started fresh. A copy of the old information was kept in the plugin's folder. Until it's put back, documents you imported may show as Not submitted yet, and you may need to enter your GitLab address and project ID again. Please tell whoever looks after Docs Publisher for your team."

#### Scenario: The data file is valid JSON in an unexpected shape
- **WHEN** the plugin starts and its data file is valid JSON with no `submissions` object
- **THEN** the plugin behaves exactly as when the file is not valid JSON: it keeps a copy, starts fresh, and shows the same message

#### Scenario: The notice is shown once
- **WHEN** a start-up has kept a copy and shown the message, and Obsidian is then restarted with no other change
- **THEN** the plugin loads the fresh data file normally, shows no notice, and keeps no second copy

#### Scenario: A copy cannot be kept
- **WHEN** the plugin starts, its data file exists but cannot be used, and copying it fails
- **THEN** the plugin starts with no records, the data file is left exactly as it was for the rest of the session whatever the author does, and the author sees exactly: "Docs Publisher couldn't read the information it saves about your documents, and couldn't keep a copy of it. To avoid losing it, Docs Publisher won't save anything new about your documents until Obsidian is restarted. Please tell whoever looks after Docs Publisher for your team."

#### Scenario: A malformed remembered connection does not trigger the guard
- **WHEN** the plugin starts and its data file has a valid `submissions` object but a malformed `connection`
- **THEN** every record loads, the connection is dropped, no copy is kept, and no notice is shown

#### Scenario: Every earlier copy survives a later incident
- **WHEN** a second unusable data file is found at a later start-up
- **THEN** a new copy is kept under a new name, and the earlier copy is not overwritten
