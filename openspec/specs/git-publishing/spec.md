# Git Publishing Specification

## Purpose

This capability defines the plugin's sole boundary for talking to a remote
git hosting platform (starting with GitLab). It owns every outbound HTTP
request, translates platform responses into information callers can use,
and classifies failures so the rest of the plugin never has to interpret a
raw HTTP status or response body.

## Requirements

### Requirement: All remote access goes through this capability
Remote calls SHALL be made only from this capability. No other part of the
plugin SHALL perform an HTTP request, construct a remote address, or reference
a platform's endpoint shape. Callers SHALL pass the connection details they
hold and receive a result they can act on without knowing how it was obtained.

#### Scenario: Another capability needs remote data
- **WHEN** any capability outside this one needs information from the remote platform
- **THEN** it calls a method on this capability rather than issuing a request itself

#### Scenario: Checking the boundary holds
- **WHEN** the plugin's source is inspected for the HTTP request helper it uses
- **THEN** that helper appears only within this capability's files

### Requirement: Remote calls use Obsidian's request helper
This capability SHALL make requests using Obsidian's own `requestUrl` and SHALL
NOT use the browser `fetch` API, so that requests succeed against self-managed
servers that do not permit browser cross-origin requests.

#### Scenario: A request against a self-managed server
- **WHEN** the plugin makes a request to a self-managed GitLab address that does not send permissive cross-origin headers
- **THEN** the request is performed through Obsidian's request helper and is not blocked

### Requirement: The identity of the current account can be read
This capability SHALL provide a way to read the account the supplied token
belongs to, returning at least that account's identifier, display name, and
username.

#### Scenario: Reading identity with a valid token
- **WHEN** the identity read is performed with a valid token
- **THEN** it returns the identifier, display name, and username of the account that token belongs to

### Requirement: The current account's access on a project can be read
This capability SHALL provide a way to read the access level the current
account holds on a named project, given that account's identifier.

#### Scenario: Reading access on a reachable project
- **WHEN** the access read is performed for an account that is a member of the named project
- **THEN** it returns that account's access level on that project

#### Scenario: Reading access on a project the account cannot reach
- **WHEN** the access read is performed for a project that does not exist or that the account's access does not cover
- **THEN** it reports the not-reachable outcome rather than returning an access level

### Requirement: Whether a branch exists can be read, as a three-way answer
This capability SHALL provide a way to read whether a named branch exists on
the target project. The answer SHALL distinguish three outcomes: the branch
exists, the branch is absent, or the lookup itself did not succeed. Only a
response explicitly reporting the branch as not found SHALL be returned as
absent; every other failure SHALL be returned as a lookup failure carrying
the usual classification, and SHALL NOT be reported as absence.

The distinction is normative rather than stylistic. Callers use this answer
to decide whether to destroy the named branch, and a failure reported as
absence would license both a destructive act and a write that cannot
succeed.

#### Scenario: The branch exists
- **WHEN** the lookup is performed for a branch name that exists on the target project
- **THEN** the caller receives the exists answer

#### Scenario: The branch is absent
- **WHEN** the lookup is performed for a branch name that does not exist on the target project, and the server explicitly reports it as not found
- **THEN** the caller receives the absent answer

#### Scenario: The credential cannot read the branch
- **WHEN** the lookup fails because the credential's access does not cover reading the project's branches
- **THEN** the caller receives the insufficient-permission classification, preserving any permission name the response reported, and does NOT receive the absent answer

#### Scenario: The server cannot be reached during the lookup
- **WHEN** the lookup fails because the network is unavailable or the server does not respond
- **THEN** the caller receives a lookup failure with the server-unreachable classification, and does NOT receive the absent answer

### Requirement: Whether an open merge request exists for a branch can be read
This capability SHALL provide a way to read whether an open merge request
exists with a given branch as its source. The answer SHALL reflect open
merge requests only; a merge request that was merged or closed SHALL NOT be
reported as open.

#### Scenario: An open merge request exists for the branch
- **WHEN** the lookup is performed for a source branch that has an open merge request
- **THEN** the caller receives the answer that one exists, together with its identifier

#### Scenario: No open merge request exists for the branch
- **WHEN** the lookup is performed for a source branch that has no merge request at all
- **THEN** the caller receives the answer that none exists

#### Scenario: Only a closed or merged merge request exists for the branch
- **WHEN** the lookup is performed for a source branch whose only merge requests were merged or closed without merging
- **THEN** the caller receives the answer that none exists

#### Scenario: The lookup does not succeed
- **WHEN** the lookup fails for any reason
- **THEN** the caller receives the failure with its classification, and does NOT receive the answer that none exists

#### Scenario: The credential lacks permission to read merge requests
- **WHEN** the lookup is refused because the credential's fine-grained permissions do not cover reading the project's merge requests
- **THEN** the caller receives the insufficient-permission classification, preserving any permission name the response reported

### Requirement: The project's merge requests can be listed across all states
This capability SHALL provide a way to list the target project's merge
requests across every state — open, merged, and closed — ordered most
recently updated first. It SHALL NOT restrict the listing to open merge
requests, and SHALL return for each entry at least its identifier, its
state, its source branch, and a link to it on the platform.

Filtering to open merge requests only would report a document whose review
was closed without merging as never submitted, which is wrong in a way that
sends the author to submit it again.

#### Scenario: Listing merge requests
- **WHEN** the listing is performed for the target project
- **THEN** the caller receives entries covering open, merged and closed merge requests, most recently updated first

#### Scenario: A closed merge request is included
- **WHEN** the listing is performed and the project contains a merge request that was closed without merging
- **THEN** that merge request appears in the result with its closed state

#### Scenario: The listing spans more entries than one page
- **WHEN** the project contains more merge requests than a single page returns
- **THEN** the caller receives entries from across the pages, up to a bounded maximum, and is told when that maximum was reached rather than receiving a silently truncated result

#### Scenario: The listing is refused for a missing permission
- **WHEN** the listing is refused because the credential's fine-grained permissions do not cover reading the project's merge requests
- **THEN** the caller receives the insufficient-permission classification, preserving any permission name the response reported

#### Scenario: The listing does not succeed
- **WHEN** the listing fails for any other reason
- **THEN** the caller receives the failure with its classification, and no partial result is presented as complete

### Requirement: Whether a merge request has unresolved review threads can be read
This capability SHALL provide a way to determine whether a given merge
request carries review threads that are not yet resolved. It SHALL report
only that fact and SHALL NOT interpret what an unresolved thread means for a
document's state.

#### Scenario: A merge request with an unresolved thread
- **WHEN** the check is performed for a merge request carrying at least one unresolved review thread
- **THEN** the caller is told threads are unresolved

#### Scenario: A merge request whose threads are all resolved
- **WHEN** the check is performed for a merge request whose review threads have all been resolved
- **THEN** the caller is told no threads are unresolved

#### Scenario: A merge request with no discussion at all
- **WHEN** the check is performed for a merge request that carries no review comments
- **THEN** the caller is told no threads are unresolved, without a further request being required to establish it

#### Scenario: The check does not succeed
- **WHEN** the check fails for any reason
- **THEN** the caller receives the failure with its classification, and does NOT receive the answer that no threads are unresolved

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

### Requirement: A branch and its first commit can be created together
This capability SHALL provide a way to create a new branch and commit one
file to it in a single call, given the target branch name, the file's path,
and its content. The branch SHALL be created from the target project's
default branch.

#### Scenario: Creating a branch and committing a new file
- **WHEN** the write is performed for a branch name that does not yet exist on the remote, a file path, and file content
- **THEN** the branch is created from the project's default branch and the file is committed to it in one call, and the caller receives the resulting commit's identifier

### Requirement: A branch can be deleted
This capability SHALL provide a way to delete a named branch on the target
project. It SHALL classify a failure through the write path, since a
credential's fine-grained permissions can be the reason a delete is refused.
It SHALL NOT decide whether deleting is appropriate; that judgement belongs
to the caller.

This is this capability's first destructive operation.

#### Scenario: Deleting a branch
- **WHEN** the delete is performed for a branch name that exists on the target project and is not protected
- **THEN** the branch no longer exists on the remote and the caller receives a successful result

#### Scenario: The credential lacks permission to delete
- **WHEN** the delete fails because the credential's fine-grained permissions do not cover it
- **THEN** the caller receives the insufficient-permission classification, preserving any permission name the response reported

#### Scenario: The delete does not succeed
- **WHEN** the delete fails for any other reason
- **THEN** the caller receives the failure with its classification, and the caller is responsible for not proceeding as though the branch were gone

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

### Requirement: A refusal for a missing permission is classified as one, on reads as well as writes
Where a call is refused because the credential's fine-grained permissions do
not cover it, this capability SHALL return the insufficient-permission
classification and SHALL preserve any permission name the response reported,
whether the call reads or writes. It SHALL NOT report such a refusal as the
resource being unreachable.

This applies to the calls a fine-grained credential gates per-resource. It
does NOT apply to the connection check, where a refusal means the project is
not visible to the account rather than that a permission was withheld, and
which SHALL keep its existing classification unchanged.

#### Scenario: A read is refused for a missing permission
- **WHEN** a lookup of a branch or of a branch's merge requests is refused because the credential lacks the required permission
- **THEN** the caller receives the insufficient-permission classification rather than the not-reachable one

#### Scenario: The response names the permission it wanted
- **WHEN** a refusal's body names the missing permission in the form the platform's credential screen uses
- **THEN** that name is preserved and passed to the caller, so the author can be told which permission to ask for

#### Scenario: The connection check is unaffected
- **WHEN** the connection check's own reads are refused
- **THEN** their classification is unchanged, and a refusal there is still reported as the project not being reachable
