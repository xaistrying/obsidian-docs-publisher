## MODIFIED Requirements

### Requirement: Failures are classified, not passed through raw
This capability SHALL classify every failed call into one of: rejected
credential, target not reachable with this credential, server unreachable,
insufficient permission, or unexpected failure. It SHALL return that
classification to its caller and SHALL NOT decide what the author is told.

#### Scenario: The credential is rejected
- **WHEN** a call fails because the server rejected the supplied token
- **THEN** the caller receives the rejected-credential classification

#### Scenario: The target cannot be reached with this credential
- **WHEN** a call fails because the named project does not exist or is not covered by the token's access
- **THEN** the caller receives the not-reachable classification

#### Scenario: The server cannot be reached
- **WHEN** a call fails because the address does not resolve, the connection times out, or the network is unavailable
- **THEN** the caller receives the server-unreachable classification

#### Scenario: The credential lacks a needed permission
- **WHEN** a write call fails because the credential's fine-grained permissions do not cover the operation attempted
- **THEN** the caller receives the insufficient-permission classification

#### Scenario: Anything else
- **WHEN** a call fails for any other reason, including an unexpected response
- **THEN** the caller receives the unexpected-failure classification, and no raw response text is surfaced to the author by the caller

## ADDED Requirements

### Requirement: A branch and its first commit can be created together
This capability SHALL provide a way to create a new branch and commit one
file to it in a single call, given the target branch name, the file's path,
and its content. The branch SHALL be created from the target project's
default branch.

#### Scenario: Creating a branch and committing a new file
- **WHEN** the write is performed for a branch name that does not yet exist on the remote, a file path, and file content
- **THEN** the branch is created from the project's default branch and the file is committed to it in one call, and the caller receives the resulting commit's identifier

### Requirement: A merge request can be opened for a branch
This capability SHALL provide a way to open a merge request from a given
source branch against the project's default branch, given a title.

#### Scenario: Opening a merge request
- **WHEN** the merge-request write is performed for a source branch that exists and carries at least one commit, and a title
- **THEN** a merge request is opened from that branch targeting the project's default branch, and the caller receives its identifier

### Requirement: An insufficient-permission failure preserves GitLab's reported detail
When a write fails with the insufficient-permission classification, this
capability SHALL preserve the permission name GitLab reported in its error
response and return it alongside the classification, rather than discarding
it during classification. When the response does not carry a recognizable
permission name, the capability SHALL still return the insufficient-permission
classification, with no detail attached, rather than falling back to a
different classification.

#### Scenario: A token missing a required permission attempts a write
- **WHEN** a write call fails because the credential's fine-grained permissions do not cover the operation, and GitLab's response names the missing permission
- **THEN** the caller receives the insufficient-permission classification together with the permission name GitLab reported

#### Scenario: An insufficient-permission response without a recognizable detail
- **WHEN** a write call fails in a way this capability classifies as insufficient-permission, but the response body does not carry a permission name in the expected shape
- **THEN** the caller receives the insufficient-permission classification with no detail attached
