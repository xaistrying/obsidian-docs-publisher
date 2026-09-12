## ADDED Requirements

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
