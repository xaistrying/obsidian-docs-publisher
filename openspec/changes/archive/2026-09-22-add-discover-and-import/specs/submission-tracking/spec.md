## ADDED Requirements

### Requirement: Documents the remote has and the vault does not can be resolved
This capability SHALL resolve which documents exist on the remote's default
branch that this vault holds no note for, by comparing remote paths against
the paths of notes in the vault. The comparison SHALL be case-sensitive.

The answer SHALL be built from the vault's own files, never from stored
records. A stored record is not evidence that a file exists, and the question
being asked is precisely which files do not.

#### Scenario: A document only the remote has
- **WHEN** the remote's default branch holds a markdown document at a path no note in the vault occupies
- **THEN** that document is resolved as discoverable

#### Scenario: A document the vault already holds
- **WHEN** the remote's default branch holds a markdown document at a path a note in the vault already occupies
- **THEN** that document is NOT resolved as discoverable

#### Scenario: A document the vault holds at a different path
- **WHEN** the vault holds a note carrying a document's `doc_id` but at a different path from the remote's
- **THEN** the remote document is resolved as discoverable, and the collision is left to the import-time checks rather than being silently hidden

#### Scenario: A document this vault has a record for but no note
- **WHEN** the remote's default branch holds a document whose identity matches a submission this vault recorded, and no note for it remains
- **THEN** it is NOT resolved as discoverable, because it is a document this vault already knows about and has its own way to restore

#### Scenario: The listing was truncated
- **WHEN** the remote listing this resolution is built from reports that it was truncated
- **THEN** the resolution reports that it is incomplete rather than presenting its result as the full set of discoverable documents

### Requirement: A remote file with no front matter is not a discoverable document
This capability SHALL exclude from the discoverable set any markdown file
that carries no YAML front matter block at all.

It SHALL NOT exclude by filename, and SHALL NOT require the full front-matter
contract. Requiring the contract would empty the list against a real corpus,
whose documents carry what their authors wrote rather than what this plugin
writes at creation and first submit.

#### Scenario: A repository README
- **WHEN** the remote holds a `README.md` with no front matter
- **THEN** it is not offered as a discoverable document

#### Scenario: A document carrying partial front matter
- **WHEN** the remote holds a document whose front matter carries `title` and `owner` but neither `doc_id` nor `category` nor `lifecycle`
- **THEN** it IS offered as a discoverable document, since the fields it lacks are the ones this plugin itself writes

#### Scenario: A document named like a placeholder
- **WHEN** the remote holds a file named `_placeholder.md` that carries a front matter block
- **THEN** it is offered, because exclusion is decided by the absence of front matter and never by the filename

## MODIFIED Requirements

### Requirement: A recorded submission whose note is gone can be located wherever its content still is
This capability SHALL resolve a stored submission whose note has left the
vault to the place its content can still be read from, trying in turn: the
path the record itself captured, the path its still-open review reports, and
— when neither answers — the document's own file on the default branch,
identified by matching the record's identity against the files the repository
holds.

A document SHALL be reported as unlocatable only when none of those three
answers it. Reporting one unlocatable while its file sits on the default
branch tells the author something false, and told it for every document whose
review had been merged — which is the ordinary end state of a published
document.

The match against the repository SHALL be by the document's identity derived
from each file's name, by the same derivation used when a document is
imported, and SHALL NOT construct a path. Where more than one file derives
the same identity, the capability SHALL decline rather than choose.

A repository listing that reports itself incomplete SHALL NOT be resolved
from: a document missing from a partial listing is indistinguishable from one
that is not there.

#### Scenario: A published document whose review was merged
- **WHEN** a recorded submission's note is gone, its review has been merged, and its file is on the default branch
- **THEN** it is resolved as recoverable from that file

#### Scenario: A record whose document is nowhere
- **WHEN** a recorded submission's note is gone and no file on the default branch is that document
- **THEN** it is reported as unlocatable

#### Scenario: Two files claim the same identity
- **WHEN** more than one file on the default branch derives the identity a recorded submission carries
- **THEN** it is reported as unlocatable rather than resolved to either of them

#### Scenario: Every record carries its own path
- **WHEN** every recorded submission already captured the path it was submitted from
- **THEN** the repository listing is never read
