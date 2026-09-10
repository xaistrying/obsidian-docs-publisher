## ADDED Requirements

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
