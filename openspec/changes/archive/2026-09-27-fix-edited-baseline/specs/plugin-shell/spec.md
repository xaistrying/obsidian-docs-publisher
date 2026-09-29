## MODIFIED Requirements

### Requirement: The panel lists the author's documents with their current state
The sidebar view SHALL list every note in the vault whose front matter
carries a `doc_id`, showing each one's name and its current state's
author-facing label, across its two sections taken together. Notes carrying
no `doc_id` SHALL NOT appear in either list.

Narrowing the primary section SHALL NOT remove any document from view: a
document that leaves the primary section appears in the secondary one, so
what the author can see is unchanged by the split.

A document's state label SHALL be shown whenever that document has a resolved
state. No marker a row also carries SHALL be displayed in place of that
label. Markers describing the note — that it has been edited since it was
last sent, for instance — SHALL be shown alongside the state, not instead of
it: the state is where the document stands with its reviewers and the marker
is what is true of the local note, and an author acting on one needs the
other.

#### Scenario: Documents are listed with their states
- **WHEN** the author opens the sidebar view in a vault holding one published document, one awaiting review and one that was not accepted
- **THEN** all three are listed, each showing its own state's label, the awaiting-review one in the primary section and the other two in the secondary section

#### Scenario: Notes that have never been submitted are not listed
- **WHEN** the author opens the sidebar view in a vault holding many notes, only some of which carry `doc_id`
- **THEN** only the notes carrying `doc_id` appear, in either section

#### Scenario: The list is empty before anything has been submitted
- **WHEN** the author opens the sidebar view in a vault where no document has been submitted
- **THEN** the primary section shows nothing rather than an error, the secondary section does not appear, and the view's existing controls are unaffected

#### Scenario: A document that is both under review and locally edited
- **WHEN** a document whose state is changes-requested has been edited since it was last sent
- **THEN** its row shows the changes-requested label AND the edited marker, so the author can see both where the review stands and that local work has not reached it

#### Scenario: An edited document whose state is unresolved
- **WHEN** a document has been edited since it was last sent and no refresh has resolved its state
- **THEN** its row shows the edited marker and no state label, since no state has been established to show
