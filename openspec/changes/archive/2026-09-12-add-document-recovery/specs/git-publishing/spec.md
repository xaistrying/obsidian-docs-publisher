## ADDED Requirements

### Requirement: A file's content at a path and ref can be read, as a three-way answer
This capability SHALL provide a way to read a single file's raw content at a
given repository path and ref (a branch name or a commit reference), as a
THREE-WAY answer: the file exists and its content is returned, the file does
not exist at that path and ref, or the read did not succeed. It SHALL NOT
collapse "does not exist" and "the read failed" into one outcome.

The three-way shape is normative for the same reason `branchExists`'s is: a
caller uses this to decide whether to proceed with a write or to recreate a
note from what it returns, and a failed read reported as absence would
license both incorrectly.

#### Scenario: Reading a file that exists
- **WHEN** the read is performed for a path and ref where a file exists
- **THEN** the caller receives that file's content

#### Scenario: Reading a file that does not exist
- **WHEN** the read is performed for a path and ref where no file exists
- **THEN** the caller receives an explicit absence, not a failure

#### Scenario: The read does not succeed
- **WHEN** the read fails for any reason other than the file being absent
- **THEN** the caller receives the failure with its classification, and does NOT receive an absence or empty content in its place

#### Scenario: The read is refused for a missing permission
- **WHEN** the read is refused because the credential's fine-grained permissions do not cover reading the project's repository content
- **THEN** the caller receives the insufficient-permission classification, preserving any permission name the response reported

### Requirement: The single path a merge request's own commit touched can be read
This capability SHALL provide a way to read which file path a given merge
request's commit changed, when it changed exactly one. It SHALL NOT guess
among multiple changed paths and SHALL report that a single path could not
be determined when the merge request touched zero or more than one file.

#### Scenario: A merge request that changed exactly one file
- **WHEN** the check is performed for a merge request whose commit changed exactly one file
- **THEN** the caller receives that file's path

#### Scenario: A merge request that changed more than one file
- **WHEN** the check is performed for a merge request whose commit changed more than one file
- **THEN** the caller is told a single path could not be determined, and receives no path rather than a guessed one

#### Scenario: The check does not succeed
- **WHEN** the check fails for any reason
- **THEN** the caller receives the failure with its classification, and does NOT receive a path in its place
