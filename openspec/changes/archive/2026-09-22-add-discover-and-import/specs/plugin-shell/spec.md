## ADDED Requirements

### Requirement: The panel lists documents available to import
The sidebar view SHALL present a third section listing documents the remote
holds that this vault has no note for, each identified by its remote path.

The section SHALL be present whether or not it has anything to list, and when
it has nothing SHALL say WHICH of the three empty cases it is in: nothing to
import, not yet checked, or the check did not succeed. An absent section says
all three at once, and only the first of them means the author has nothing to
do.

#### Scenario: Documents exist only on the remote
- **WHEN** the author opens the panel in a vault missing three documents the remote holds
- **THEN** a section lists those three, each showing its remote path

#### Scenario: The vault already has everything
- **WHEN** every document on the remote already has a note in the vault
- **THEN** the section is still shown, saying there is nothing to import

#### Scenario: Nothing has been checked yet
- **WHEN** the panel is showing before any check of the remote has answered
- **THEN** the section says so, rather than saying there is nothing to import

#### Scenario: The author collapses the section
- **WHEN** the author collapses the section
- **THEN** its contents are hidden and its heading still reports how many documents it holds, or that its last check failed, so collapsing cannot hide which of the empty cases applies

#### Scenario: The list could not be built
- **WHEN** the remote could not be asked which documents are available, and nothing was resolved on an earlier attempt
- **THEN** the section appears carrying that failure, naming the missing permission where the platform reported one, rather than being absent as though the vault already had everything

The two are different answers and SHALL NOT look alike. "There is nothing to
import" and "the question could not be asked" differ by whether the author
needs to do something, and this section's own failure is not covered by any
other section's: the documents list and this one read different resources,
which a fine-grained credential can grant separately.

#### Scenario: The listing was incomplete
- **WHEN** the remote listing the section is built from was truncated
- **THEN** the author is told the list is incomplete, rather than being shown a partial list presented as everything available

### Requirement: The panel offers import per document and for all of them
The sidebar view SHALL offer an action to import one listed document, and an
action to import every listed document. Each SHALL report its outcome per
document, including which imports were refused and why.

#### Scenario: Importing one document
- **WHEN** the author selects the import action on one listed document
- **THEN** only that document is imported, and it leaves the list

#### Scenario: Importing everything
- **WHEN** the author selects the import-all action
- **THEN** every listed document is imported, and the author is told the outcome for each

#### Scenario: One import in a batch is refused
- **WHEN** the author imports all documents and one of them collides with a note the vault already has
- **THEN** the others are still imported and the refused one is reported with its reason, rather than the batch stopping at the first refusal

### Requirement: Discovery reaches the remote only when asked
The sidebar view SHALL NOT read the remote to build this section while
rendering. It SHALL populate it on the same explicit triggers the panel's
other remote-backed lists already use, and SHALL render from what was last
resolved.

#### Scenario: Rendering does not reach the remote
- **WHEN** the panel re-renders because the author switched notes or edited front matter
- **THEN** no request is made to list the remote's files

#### Scenario: Refreshing populates the section
- **WHEN** the author triggers the panel's refresh
- **THEN** the discoverable documents are resolved from the remote along with the panel's other remote-backed state

## MODIFIED Requirements

### Requirement: The panel lists documents whose tracking record has no note
The sidebar view SHALL list every persisted tracking record whose `doc_id`
matches no note currently in the vault, separately from the list of
documents built from the vault. For each, it SHALL offer a way to recover
the document when its content can be located, and SHALL otherwise state
plainly that automatic recovery is not available and offer the existing way
to open it on the platform instead.

This section SHALL be present whether or not it has anything to list, and
when it has nothing SHALL say which of the three empty cases it is in:
nothing to recover, not yet checked, or the check did not succeed. It SHALL
be collapsible, and a collapsed heading SHALL still report its count or that
its last check failed — collapsing hides a list, never which case applies. It
previously disappeared when empty, on the reasoning that an empty-state
message would compete with the main list; that made three different answers
look identical, and only one of them means the author has nothing to do.

Where recovery is unavailable for several records at once, the explanation
SHALL be given once for the section rather than repeated on every row.

#### Scenario: A recoverable orphaned record is listed
- **WHEN** the vault holds no note for a persisted record, and that document's content can be located
- **THEN** the record is listed with a way to recover it

#### Scenario: A non-recoverable orphaned record is listed with an explanation
- **WHEN** the vault holds no note for a persisted record, and that document's content cannot be located
- **THEN** the record is listed stating recovery is not available, with a way to open it on the platform instead

#### Scenario: Nothing to recover
- **WHEN** every persisted record matches a note in the vault
- **THEN** this list is still shown, saying there is nothing to recover

#### Scenario: The check did not succeed
- **WHEN** resolving which records can be recovered failed, and nothing was resolved on an earlier attempt
- **THEN** the section is shown carrying that failure, naming the missing permission where the platform reported one
