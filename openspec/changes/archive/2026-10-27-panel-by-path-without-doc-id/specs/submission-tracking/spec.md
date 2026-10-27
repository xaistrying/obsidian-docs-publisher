## ADDED Requirements

### Requirement: A note is matched to its document by path and exact content, with doc_id as an alias
The plugin SHALL find the document a note belongs to without requiring a `doc_id` in the
note, in this order: (1) the document at the note's own path on the project, from the
fetched default branch or the last synced version; (2) the document whose send record
from this vault touched the note's path; (3) a document whose version known to this
vault (last synced, default branch, last sent, or its review branch) has the same content
identifier as the note and sits at a path that no longer exists in the vault. A match in
(3) SHALL require exact equality of content identifiers and SHALL NOT use similarity. A
`doc_id` in the note's front matter, valid as a ref part, SHALL take precedence as the
identity and SHALL NOT be rewritten or removed. When two documents match at the same
step, the note SHALL match none and SHALL NOT be listed as either.

#### Scenario: Matched by path
- **WHEN** a note with no `doc_id` sits at a path the fetched default branch holds
- **THEN** its state is derived for that document

#### Scenario: Matched after a move by content
- **WHEN** a note sits at a new path and its content identifier equals the last-sent version of a document whose old path no longer exists in the vault
- **THEN** it resolves to that document, and its state is unchanged by the move

#### Scenario: Ambiguous
- **WHEN** two absent paths hold the same bytes and one note matches both
- **THEN** the note resolves to neither

#### Scenario: A legacy doc_id
- **WHEN** a note carries a valid `doc_id`
- **THEN** it resolves by that identity, and the property is left in the note

### Requirement: The send record remembers the path the review started from
This vault's record of the last send for a document (`sent/<id>`) SHALL identify the
path the note had in that send, readable from the recorded commit itself, so no new
stored state is needed. A note whose path differs from that recorded path while its
bytes equal that send's note SHALL be reported as moved.

#### Scenario: Rename during review
- **WHEN** the author renames a note whose review is open
- **THEN** the panel shows "Waiting for review" and the moved marker, from the recorded commit's path

#### Scenario: Another vault
- **WHEN** a second vault has no send record for the document
- **THEN** it derives state from paths on the project only, and shows no moved marker for a document it never sent
