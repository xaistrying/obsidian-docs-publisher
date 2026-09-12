## ADDED Requirements

### Requirement: A commit can be made to an existing branch without creating one
This capability SHALL provide a way to commit an update to one file already
on an existing branch, given the branch name, the file's path, its content,
and the file's current commit identifier. It SHALL NOT create or rename any
branch to perform this write.

#### Scenario: Committing an update to an existing branch
- **WHEN** the write is performed for a branch that already exists, a file path already present on it, its content, and that file's current commit identifier
- **THEN** the file is updated on that branch in place, no new branch is created, and the caller receives the resulting commit's identifier

#### Scenario: The write is refused for a stale commit identifier
- **WHEN** the write is performed with a commit identifier that no longer matches the file's actual current state on the branch
- **THEN** the write is rejected and the caller receives a failure rather than a silent overwrite

### Requirement: A file's current commit identifier can be read, as a three-way answer
This capability SHALL provide a way to read the commit identifier a file
currently carries at a given path and ref. The answer SHALL distinguish
three outcomes: the file exists and its commit identifier is returned, the
file is absent, or the read itself did not succeed. Only an explicit report
of the file being absent SHALL be returned as absent; every other failure
SHALL be returned as a read failure, and SHALL NOT be reported as absence.

#### Scenario: Reading the commit identifier of a file that exists
- **WHEN** the read is performed for a path and ref where the file exists
- **THEN** the caller receives that file's current commit identifier

#### Scenario: Reading a path that does not exist
- **WHEN** the read is performed for a path that does not exist at the given ref, and the server explicitly reports it as not found
- **THEN** the caller receives the absent answer

#### Scenario: The read does not succeed
- **WHEN** the read fails for any reason other than the file being explicitly reported absent
- **THEN** the caller receives a read failure, and does NOT receive the absent answer

## MODIFIED Requirements

### Requirement: A branch and its first commit can be created together
This capability SHALL provide a way to create a new branch and commit one
file to it in a single call, given the target branch name, the file's path,
its content, and whether the write should create the file or update it. The
branch SHALL be created from the target project's default branch. When the
write updates a file that already exists on the default branch it is cut
from, it SHALL carry that file's current commit identifier, so the write
fails if the file has changed since it was last read, rather than silently
overwriting it.

#### Scenario: Creating a branch and committing a new file
- **WHEN** the write is performed for a branch name that does not yet exist on the remote, a file path that does not exist on the project's default branch, and file content
- **THEN** the branch is created from the project's default branch and the file is committed to it as a new file in one call, and the caller receives the resulting commit's identifier

#### Scenario: Creating a branch and committing an update to a file that already exists
- **WHEN** the write is performed for a branch name that does not yet exist on the remote, a file path that already exists on the project's default branch, file content, and that file's current commit identifier
- **THEN** the branch is created from the project's default branch and the file is updated on it in one call, and the caller receives the resulting commit's identifier

#### Scenario: The update fails for a stale commit identifier
- **WHEN** the write updates a file whose commit identifier no longer matches its actual current state on the default branch
- **THEN** the write is rejected and the caller receives a failure, and no branch is left half-created with a rejected commit
