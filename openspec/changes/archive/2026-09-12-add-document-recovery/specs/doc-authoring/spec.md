## ADDED Requirements

### Requirement: A first submission is refused when its target path already holds a published document
This capability SHALL, before writing anything, refuse a submission for
which no `doc_id` yet exists in front matter if a file already exists at
that note's path on the project's default branch, regardless of whether any
branch or merge request for that path currently exists. It SHALL NOT perform
this check for a document that already carries a `doc_id`.

#### Scenario: A first submission collides with an already-published document
- **WHEN** a note with no `doc_id` is submitted and a file already exists at its path on the project's default branch
- **THEN** the submission is refused before any remote write, and nothing is created or deleted

#### Scenario: A document's own revision is never checked against itself
- **WHEN** a note that already carries a `doc_id` is submitted again
- **THEN** this check does not run, since that document's path is already its own

#### Scenario: A first submission proceeds when the path is free
- **WHEN** a note with no `doc_id` is submitted and no file exists at its path on the project's default branch
- **THEN** this check does not block the submission

#### Scenario: The check does not succeed
- **WHEN** the existence check fails for any reason
- **THEN** the submission is refused and nothing is written, rather than proceeding on an assumption that the path is free

### Requirement: A refused first submission offers to recover the document already there
When a submission is refused under the requirement above, this capability
SHALL offer the author a way to recover the already-existing document into
the vault, using the content already read while performing the check.

#### Scenario: The refusal offers recovery
- **WHEN** a first submission is refused because a document already exists at its path
- **THEN** the author is offered a way to recover that document rather than only being told the submission failed

### Requirement: A recovered document is restored only to its original remote path
This capability SHALL create a recovered document's note at exactly the
remote path its content was read from, and SHALL NOT place it at any other
local path.

#### Scenario: Recovery uses the exact remote path
- **WHEN** a document is recovered
- **THEN** the note is created at the same path, relative to the vault root, that its content was read from on the remote

### Requirement: Recovery never overwrites a note already at its target path
This capability SHALL refuse to recover a document whose target path is
already occupied by a note in the vault, and SHALL write nothing in that
case.

#### Scenario: The target path is already occupied
- **WHEN** recovery's target path already holds a note
- **THEN** recovery is refused and neither that note nor any other file is modified

#### Scenario: The target path is free
- **WHEN** recovery's target path holds no note
- **THEN** a new note is created there with the recovered content
