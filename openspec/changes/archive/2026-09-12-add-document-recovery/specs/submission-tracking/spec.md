## ADDED Requirements

### Requirement: A document whose local note is gone can be recovered when its content is still reachable
This capability SHALL identify, for every persisted record whose `doc_id`
matches no note currently in the vault, whether that document's content can
be located on the remote — either from a path stored in the record itself or
from the single path its still-open merge request's commit touched — and
SHALL NOT report a document as recoverable when neither source yields a
single, unambiguous path.

#### Scenario: A record with a stored path
- **WHEN** an orphaned record carries a stored path
- **THEN** that document is reported as recoverable from that path

#### Scenario: A record with no stored path but an open merge request touching one file
- **WHEN** an orphaned record carries no stored path, and the remote's merge request for its branch is open and its commit changed exactly one file
- **THEN** that document is reported as recoverable from that file's path

#### Scenario: A record with no stored path and no open merge request
- **WHEN** an orphaned record carries no stored path and its branch has no open merge request
- **THEN** that document is reported as NOT recoverable, distinct from a document whose recovery has not yet been attempted

#### Scenario: A record whose merge request touched more than one file
- **WHEN** an orphaned record carries no stored path and its open merge request's commit changed more than one file
- **THEN** that document is reported as NOT recoverable rather than resolved to a guessed path

### Requirement: Recovery never guesses at a document's remote path
This capability SHALL treat a document's remote path as either known (from a
stored value or from an unambiguous single-file merge request) or unknown,
and SHALL NOT infer, construct, or approximate a path from a `doc_id` or
from any other value.

#### Scenario: No inference from `doc_id` alone
- **WHEN** a record's path is unknown by the rule above
- **THEN** this capability does not construct a path from that record's `doc_id` or offer one as a fallback

## MODIFIED Requirements

### Requirement: A submitted document's state is persisted locally, keyed by its frozen identity
This capability SHALL persist one record per submitted document in the
plugin's local data, keyed by that document's `doc_id`. It SHALL NOT key a
record by the document's file path, since a document's path may change after
its first submit while `doc_id` does not. A record created by a successful
submission SHALL also carry that document's remote path as it was at the
moment of that submission, captured going forward from this capability's
recovery support; a record created before this capability existed carries no
such path.

#### Scenario: A record is created on first successful submission
- **WHEN** a document is submitted for the first time and both the remote write and the merge request creation succeed
- **THEN** a record is persisted keyed by that document's `doc_id`, carrying the path the document was submitted at

#### Scenario: Resolving a note to its record after a rename
- **WHEN** the author opens a previously submitted note whose file has since been renamed
- **THEN** the plugin resolves the note's tracking record by reading `doc_id` from the note's own front matter, not by the note's current or original file path

#### Scenario: A record predating this capability carries no path
- **WHEN** a record was persisted before this capability existed
- **THEN** it carries no path, and this capability's recovery support falls back to the merge-request-based path lookup rather than treating the absence as an error
