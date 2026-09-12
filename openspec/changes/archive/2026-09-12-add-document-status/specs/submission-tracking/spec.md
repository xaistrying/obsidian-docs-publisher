## ADDED Requirements

### Requirement: A document's state is resolved from the remote, not from what was last stored
This capability SHALL determine a document's current state by matching its
frozen `doc_id` against the remote's merge requests, and SHALL treat its own
persisted records as a cache of that answer rather than as the answer. Where
a stored record disagrees with the remote, the remote SHALL win.

#### Scenario: A stored state that the remote has moved past
- **WHEN** a document's stored record says it is awaiting review and the remote shows its merge request has been merged
- **THEN** the document resolves as published, and the stored record is updated to match

#### Scenario: A note with no stored record at all
- **WHEN** a note carrying `doc_id` in its front matter is resolved on a machine whose plugin data holds no record for it
- **THEN** the document's state is resolved from the remote exactly as it would be with a record present, and a record is created from that answer

### Requirement: Reconciliation matches a document by its frozen identity, in a fixed precedence
This capability SHALL reconcile a document by matching `doc/<doc_id>` against
the source branch of the remote's merge requests, considering all states,
most recent first, and SHALL resolve the result in this order:

1. An open merge request wins if one exists.
2. Otherwise the most recent merge request decides: merged resolves as
   published, closed without merging resolves as not accepted.
3. No merge request at all resolves as never submitted.

It SHALL match by `doc_id` read from the note's own front matter, never by
the note's file path and never by a stored record.

#### Scenario: An open merge request takes precedence over older ones
- **WHEN** a document has one open merge request and two older merged ones
- **THEN** it resolves from the open merge request, not from the most recent merged one

#### Scenario: A document whose review was closed without merging
- **WHEN** a document's only merge requests were closed without merging
- **THEN** it resolves as not accepted, and not as never submitted

#### Scenario: A document that has been published and not since revised
- **WHEN** a document's most recent merge request was merged and no open one exists
- **THEN** it resolves as published

#### Scenario: A note whose file has been renamed since it was submitted
- **WHEN** a note carrying `doc_id` is reconciled after its filename has been changed
- **THEN** it resolves through the `doc_id` in its front matter, and the current filename is not used for matching

#### Scenario: A note with no matching merge request
- **WHEN** a note carrying `doc_id` is reconciled and the remote holds no merge request for it
- **THEN** it resolves as never submitted

### Requirement: Reconciliation reads the remote once for all documents
This capability SHALL reconcile every known document against a single
listing of the remote's merge requests, matching locally. It SHALL NOT make
one request per document.

#### Scenario: Reconciling many documents
- **WHEN** reconciliation runs for a vault holding twenty submitted documents
- **THEN** the remote is listed once and all twenty are matched against that one result

#### Scenario: A reconciliation that cannot complete
- **WHEN** the listing does not succeed
- **THEN** no document's stored state is changed, and the caller is told the reconciliation failed rather than receiving states resolved from partial data

### Requirement: An open document with unresolved review threads is in changes-requested
This capability SHALL resolve a document with an open merge request as
changes-requested when that merge request carries unresolved review threads,
and as awaiting review when it does not. Resolving threads SHALL return the
document to awaiting review.

#### Scenario: A reviewer has left an unresolved thread
- **WHEN** a document's open merge request carries at least one unresolved review thread
- **THEN** the document resolves as changes-requested rather than awaiting review

#### Scenario: The reviewer resolves their threads
- **WHEN** every thread on a document's open merge request has been resolved and the merge request is still open
- **THEN** the document resolves as awaiting review again

#### Scenario: An open merge request nobody has commented on
- **WHEN** a document's open merge request carries no review comments
- **THEN** the document resolves as awaiting review

## MODIFIED Requirements

### Requirement: Each submission state has a fixed author-facing label
This capability SHALL define an author-facing label for each submission
state it recognizes. The labels SHALL be: pending is "Waiting for review",
changes-requested is "Changes requested", published is "Published", and
closed is "Not accepted". No label SHALL use a git-vocabulary term or an
internal state name.

The closed state's label was previously "Closed", a placeholder recorded as
provisional while that state was unreachable. It is now reachable and takes
the author vocabulary the project settled on.

#### Scenario: Displaying a pending document's state
- **WHEN** a surface displays the state of a document whose tracking record is pending
- **THEN** it displays the label "Waiting for review", not the internal state name and not any git-vocabulary term

#### Scenario: Displaying a document whose review asked for changes
- **WHEN** a surface displays the state of a document resolved as changes-requested
- **THEN** it displays the label "Changes requested"

#### Scenario: Displaying a published document
- **WHEN** a surface displays the state of a document resolved as published
- **THEN** it displays the label "Published"

#### Scenario: Displaying a document whose review was closed without publishing
- **WHEN** a surface displays the state of a document resolved as closed
- **THEN** it displays the label "Not accepted", and never "Closed"
