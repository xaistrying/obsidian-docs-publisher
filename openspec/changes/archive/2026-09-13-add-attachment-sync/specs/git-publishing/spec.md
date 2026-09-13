## ADDED Requirements

### Requirement: Binary file content can be committed
A commit action SHALL be able to carry binary content, declaring its
encoding, so that a file which is not text arrives intact rather than
corrupted by being sent as text.

#### Scenario: Committing an image
- **WHEN** a commit includes an action for an image file
- **THEN** that action carries the file's bytes in an encoding the platform is told about, and the file on the remote afterwards is byte-identical to the local one

#### Scenario: Text and binary in one commit
- **WHEN** a commit includes both a markdown file and an image
- **THEN** the markdown action carries plain text and the image action declares its encoding, in the same call

## MODIFIED Requirements

### Requirement: A branch and its first commit can be created together
This capability SHALL provide a way to create a new branch and commit ONE
OR MORE files to it in a single call, given the target branch name and, for
each file, its path, its content, whether the write should create or update
it, and — when updating — that file's current commit identifier. The branch
SHALL be created from the target project's default branch. A file being
updated SHALL carry its own commit identifier, so the write fails if that
file has changed since it was last read, rather than silently overwriting
it.

Every file in the call SHALL be committed together or not at all: a
rejected action SHALL NOT leave some of the files written.

#### Scenario: Creating a branch and committing a new file
- **WHEN** the write is performed for a branch name that does not yet exist on the remote, one file path that does not exist on the project's default branch, and that file's content
- **THEN** the branch is created from the project's default branch and the file is committed to it as a new file in one call, and the caller receives the resulting commit's identifier

#### Scenario: Creating a branch and committing an update to a file that already exists
- **WHEN** the write is performed for a branch name that does not yet exist on the remote, one file path that already exists on the project's default branch, that file's content, and its current commit identifier
- **THEN** the branch is created from the project's default branch and the file is updated on it in one call, and the caller receives the resulting commit's identifier

#### Scenario: Committing a document and the files it embeds together
- **WHEN** the write is performed for a branch name that does not yet exist, a markdown file, and two image files it embeds, each with its own verb and — where updating — its own commit identifier
- **THEN** all three are committed to the new branch in one call, and the caller receives the resulting commit's identifier

#### Scenario: Mixed verbs in one commit
- **WHEN** the write includes one file that does not exist on the ref being committed to and one that does
- **THEN** the first is created, the second is updated carrying its own commit identifier, and both land in the same commit

#### Scenario: The update fails for a stale commit identifier
- **WHEN** any file in the write has a commit identifier that no longer matches its actual current state on the default branch
- **THEN** the write is rejected, the caller receives a failure, no file in the call is written, and no branch is left half-created with a rejected commit

### Requirement: A commit can be made to an existing branch without creating one
This capability SHALL provide a way to commit ONE OR MORE files to an
existing branch, given the branch name and, for each file, its path, its
content, its verb, and — when updating — that file's current commit
identifier. It SHALL NOT create or rename any branch to perform this write,
and SHALL commit every file together or not at all.

#### Scenario: Committing an update to an existing branch
- **WHEN** the write is performed for a branch that already exists, one file path already present on it, its content, and that file's current commit identifier
- **THEN** the file is updated on that branch in place, no new branch is created, and the caller receives the resulting commit's identifier

#### Scenario: Adding a newly embedded image to a document under review
- **WHEN** the write is performed for an existing branch, an updated markdown file already present on it, and an image not yet present on it
- **THEN** the markdown file is updated and the image is created, in one commit on that branch

#### Scenario: The write is refused for a stale commit identifier
- **WHEN** the write is performed with a commit identifier that no longer matches that file's actual current state on the branch
- **THEN** the write is rejected and the caller receives a failure rather than a silent overwrite, and no file in the call is written

### Requirement: A merge request's own document path can be read
This capability SHALL provide a way to read which path a merge request's
own commit changed for the DOCUMENT itself, distinguishing it from any
other files that commit carried. It SHALL report "could not be determined"
as a successful answer distinct from a failed lookup, rather than guessing
among several.

The document is identified as the single markdown file the merge request
changed. Zero markdown files, or more than one, SHALL report "could not be
determined". Files that are not markdown SHALL be ignored for this purpose,
so that a document committed together with the images it embeds still
resolves to its own path.

#### Scenario: A merge request carrying only the document
- **WHEN** the read is performed for a merge request whose commit changed one markdown file
- **THEN** that file's path is returned

#### Scenario: A merge request carrying the document and its images
- **WHEN** the read is performed for a merge request whose commit changed one markdown file and three image files
- **THEN** the markdown file's path is returned, and the images do not prevent it being determined

#### Scenario: A merge request carrying no markdown file
- **WHEN** the read is performed for a merge request whose commit changed no markdown file
- **THEN** "could not be determined" is returned, as a successful answer rather than a failure

#### Scenario: A merge request carrying several markdown files
- **WHEN** the read is performed for a merge request whose commit changed more than one markdown file
- **THEN** "could not be determined" is returned rather than one of them being guessed at
