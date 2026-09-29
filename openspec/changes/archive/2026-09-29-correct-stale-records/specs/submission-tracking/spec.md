## MODIFIED Requirements

### Requirement: A document's state is resolved from the remote, not from what was last stored
This capability SHALL determine a document's current state by matching its
frozen `doc_id` against the remote's merge requests, and SHALL treat its own
persisted records as a cache of that answer rather than as the answer. Where
a stored record disagrees with the remote, the remote SHALL win.

Reconciliation SHALL cover every document this capability holds a record for,
whether or not a note for it exists in the vault. A record whose note has been
deleted is the case that most needs correcting — nothing else in the vault
describes that document — and it is the case a vault-driven scope silently
omits.

A record SHALL NOT be able to hold a state the remote has moved past
indefinitely. Any surface that decides what to offer an author from a stored
state depends on this: a state that is never re-asked is not a cache, and
treating it as one offers actions against a situation that has ended.

#### Scenario: A stored state that the remote has moved past
- **WHEN** a document's stored record says it is awaiting review and the remote shows its merge request has been merged
- **THEN** the document resolves as published, and the stored record is updated to match

#### Scenario: A note with no stored record at all
- **WHEN** a note carrying `doc_id` in its front matter is resolved on a machine whose plugin data holds no record for it
- **THEN** the document's state is resolved from the remote exactly as it would be with a record present, and a record is created from that answer

#### Scenario: A stored record whose note is no longer in the vault
- **WHEN** a refresh runs and a stored record's `doc_id` matches no note in the vault
- **THEN** that document is reconciled against the remote like any other, and its stored state is corrected if the remote has moved past it

#### Scenario: A document whose review ended while its note was absent
- **WHEN** a document's note was deleted while it was awaiting review, and its merge request is afterwards merged
- **THEN** the next refresh resolves it as published, so no surface continues to offer it as a document still under review

#### Scenario: An orphaned record for a document the remote no longer has
- **WHEN** a stored record's `doc_id` matches no merge request on the remote
- **THEN** it resolves to no state, exactly as a note in the same position would, and is not presented as though its state were known

### Requirement: Reconciliation reads the remote once for all documents
This capability SHALL reconcile every known document against a single
listing of the remote's merge requests, matching locally. It SHALL NOT make
one request per document.

Widening reconciliation's scope to include records without notes SHALL NOT
change this: those documents are matched against the same single listing, so
the cost of covering them is bounded by what is already being read.

#### Scenario: Reconciling many documents
- **WHEN** reconciliation runs for a vault holding twenty submitted documents
- **THEN** the remote is listed once and all twenty are matched against that one result

#### Scenario: Reconciling documents with and without notes together
- **WHEN** reconciliation runs for a vault holding some documents with notes and some stored records without them
- **THEN** all of them are matched against one listing of the remote, not one request per record

#### Scenario: A reconciliation that cannot complete
- **WHEN** the listing does not succeed
- **THEN** no document's stored state is changed, and the caller is told the reconciliation failed rather than receiving states resolved from partial data

## ADDED Requirements

### Requirement: Correcting a record's state never discards what only a submit establishes
When reconciliation updates a stored record, it SHALL correct the fields the
remote is authoritative for — the document's state, its merge request and its
branch — and SHALL carry forward the fields only a successful submit or import
establishes, specifically the document's remote path and its edit baseline.

This holds for a record whose note is absent exactly as for one whose note is
present. The remote path is what a later restore uses to put the note back, so
discarding it while correcting a state would break recovery in the course of
fixing a listing.

#### Scenario: A record's state is corrected
- **WHEN** reconciliation finds a stored record's state is out of date
- **THEN** the state, merge request and branch are updated, and the stored remote path and edit baseline are left as they were

#### Scenario: An orphaned record is corrected
- **WHEN** reconciliation corrects a record whose note is no longer in the vault
- **THEN** its remote path survives the correction, so the document can still be restored to where it came from
