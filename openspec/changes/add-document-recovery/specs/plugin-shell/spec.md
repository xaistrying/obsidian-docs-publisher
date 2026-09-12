## ADDED Requirements

### Requirement: The panel offers recovery for tracked documents with no matching note
The sidebar view SHALL list every persisted tracking record whose `doc_id`
matches no note currently in the vault, separately from the list of
documents built from the vault. For each, it SHALL offer a way to recover
the document when its content can be located, and SHALL otherwise state
plainly that automatic recovery is not available and offer the existing way
to open it on the platform instead.

#### Scenario: A recoverable orphaned record is listed
- **WHEN** the vault holds no note for a persisted record, and that document's content can be located
- **THEN** the record is listed with a way to recover it

#### Scenario: A non-recoverable orphaned record is listed with an explanation
- **WHEN** the vault holds no note for a persisted record, and that document's content cannot be located
- **THEN** the record is listed stating recovery is not available, with a way to open it on the platform instead

#### Scenario: Nothing to recover
- **WHEN** every persisted record matches a note in the vault
- **THEN** this list shows nothing rather than an empty-state message competing with the main document list

### Requirement: Recovery fetches content only when the author asks for it
Listing which orphaned records exist SHALL make no remote request. A remote
request to read a document's content SHALL be made only when the author
selects that document's recovery action.

#### Scenario: Listing orphaned records makes no request
- **WHEN** the panel renders the list of documents with no matching note
- **THEN** no request is made to determine which are listed

#### Scenario: Recovering one document requests only that document's content
- **WHEN** the author selects the recovery action for one listed document
- **THEN** a request is made for that document's content, and no request is made for any other listed document
