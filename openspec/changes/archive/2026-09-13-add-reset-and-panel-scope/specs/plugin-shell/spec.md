## ADDED Requirements

### Requirement: The panel separates documents with an open review cycle from the rest
The sidebar view SHALL present tracked documents in two sections: a primary
section for documents with an open review cycle, and a secondary,
lower-prominence section for documents whose cycle is over. A document
whose state has not been resolved SHALL appear in the primary section, and
SHALL NOT be placed in the secondary one, since placing it there would
assert a settled state nothing has established.

The secondary section SHALL be absent entirely when it holds nothing,
rather than shown with an empty-state message.

#### Scenario: A vault holding documents in several states
- **WHEN** the author opens the sidebar view in a vault holding one document awaiting review, one with changes requested, one published, and one not accepted
- **THEN** the first two appear in the primary section and the last two appear in the secondary section

#### Scenario: A document whose state has not been resolved yet
- **WHEN** a tracked document's state has not been resolved, because no refresh has succeeded in this session
- **THEN** it appears in the primary section, and is not placed in the secondary section

#### Scenario: Nothing has finished its cycle yet
- **WHEN** the author opens the sidebar view in a vault where no document is published or not accepted
- **THEN** the secondary section does not appear at all

#### Scenario: A never-submitted note stays where it was
- **WHEN** the author opens the sidebar view in a vault holding a note that carries `doc_id` but resolves as never submitted
- **THEN** it appears in the primary section, as it does today

### Requirement: The panel offers Reset for a document with an open review cycle
The sidebar view SHALL offer a Reset action for the currently open note
when that note's resolved state is pending or changes-requested, alongside
the resubmit action already offered for it. It SHALL NOT offer Reset for a
document in any other state, and SHALL NOT offer it as a per-row control in
either document list.

#### Scenario: The open note is awaiting review
- **WHEN** the author has open a note whose resolved state is pending or changes-requested
- **THEN** the view offers a Reset action for it alongside the resubmit action

#### Scenario: The open note is published or not accepted
- **WHEN** the author has open a note whose resolved state is published or not accepted
- **THEN** no Reset action is offered

#### Scenario: Reset is never a row control
- **WHEN** either document list is rendered
- **THEN** no row carries a Reset control, whatever that document's state

## MODIFIED Requirements

### Requirement: The panel lists the author's documents with their current state
The sidebar view SHALL list every note in the vault whose front matter
carries a `doc_id`, showing each one's name and its current state's
author-facing label, across its two sections taken together. Notes carrying
no `doc_id` SHALL NOT appear in either list.

Narrowing the primary section SHALL NOT remove any document from view: a
document that leaves the primary section appears in the secondary one, so
what the author can see is unchanged by the split.

#### Scenario: Documents are listed with their states
- **WHEN** the author opens the sidebar view in a vault holding one published document, one awaiting review and one that was not accepted
- **THEN** all three are listed, each showing its own state's label, the awaiting-review one in the primary section and the other two in the secondary section

#### Scenario: Notes that have never been submitted are not listed
- **WHEN** the author opens the sidebar view in a vault holding many notes, only some of which carry `doc_id`
- **THEN** only the notes carrying `doc_id` appear, in either section

#### Scenario: The list is empty before anything has been submitted
- **WHEN** the author opens the sidebar view in a vault where no document has been submitted
- **THEN** the primary section shows nothing rather than an error, the secondary section does not appear, and the view's existing controls are unaffected
