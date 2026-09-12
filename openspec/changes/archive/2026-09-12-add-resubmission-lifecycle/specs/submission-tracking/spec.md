## ADDED Requirements

### Requirement: A single document's state can be resolved without a full reconciliation pass
This capability SHALL provide a way to resolve one document's current state
against the remote, filtered to that document's own tracked branch, without
listing every merge request in the project. It SHALL apply the same state
precedence a full reconciliation pass applies: an open merge request wins if
one exists; otherwise the most recent merge request decides; no merge
request at all resolves as never submitted.

#### Scenario: Resolving one document queries only its own branch
- **WHEN** a single document's state is resolved
- **THEN** the remote is queried filtered to that document's own tracked branch, not listed unfiltered across the whole project

#### Scenario: Single-document resolution agrees with a full reconciliation pass
- **WHEN** a document's state is resolved individually and also resolved as part of a full reconciliation pass in the same moment
- **THEN** both report the same state

#### Scenario: A failed single-document resolution is not read as never-submitted
- **WHEN** the filtered query does not succeed
- **THEN** the caller receives a failure, and the document is not treated as though it had never been submitted
