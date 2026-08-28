# Submission Tracking Specification

## Purpose

This capability defines how the plugin tracks a document's review state
locally once it has been submitted: what is persisted, how a record is keyed
so it survives a rename, and the author-facing label shown for each state. It
does not write into a document's front matter and does not talk to the
remote platform itself. TBD: states beyond pending (e.g. approved, changes
requested) and how they are reached.

## Requirements

### Requirement: A submitted document's state is persisted locally, keyed by its frozen identity
This capability SHALL persist one record per submitted document in the
plugin's local data, keyed by that document's `doc_id`. It SHALL NOT key a
record by the document's file path, since a document's path may change after
its first submit while `doc_id` does not.

#### Scenario: A record is created on first successful submission
- **WHEN** a document is submitted for the first time and both the remote write and the merge request creation succeed
- **THEN** a record is persisted keyed by that document's `doc_id`

#### Scenario: Resolving a note to its record after a rename
- **WHEN** the author opens a previously submitted note whose file has since been renamed
- **THEN** the plugin resolves the note's tracking record by reading `doc_id` from the note's own front matter, not by the note's current or original file path

### Requirement: Submission state lives only in plugin data, never in the note's front matter
This capability SHALL NOT write any submission-state value into a document's
front matter. Submission state SHALL be readable only from the plugin's own
persisted data.

#### Scenario: A note's front matter carries no submission state
- **WHEN** a document has been submitted and its tracking record shows a pending state
- **THEN** the note's front matter contains no field describing that state

### Requirement: A pending record reflects a document awaiting first review
A record created by a first successful submission SHALL carry the pending
state, and no other state SHALL be reachable through this capability's first
submission path.

#### Scenario: State immediately after a successful first submission
- **WHEN** a document's first submission completes successfully
- **THEN** its tracking record's state is pending

### Requirement: Each submission state has a fixed author-facing label
This capability SHALL define an author-facing label for each submission
state it recognizes. The pending state's label SHALL be "Waiting for review".

#### Scenario: Displaying a pending document's state
- **WHEN** a surface displays the state of a document whose tracking record is pending
- **THEN** it displays the label "Waiting for review", not the internal state name and not any git-vocabulary term
