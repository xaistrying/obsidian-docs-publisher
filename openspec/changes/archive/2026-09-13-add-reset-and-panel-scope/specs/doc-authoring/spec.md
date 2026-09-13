## ADDED Requirements

### Requirement: Reset replaces a note's content with the version under review
The plugin SHALL, on the author's explicit request for a document whose
resolved state is pending or changes-requested, replace the open note's
entire content with the content that document currently carries on its own
tracked branch. It SHALL write the remote's content verbatim, including
front matter, so the note afterwards matches what reviewers are looking at
byte for byte.

It SHALL NOT write a tracking record, SHALL NOT change the document's
state, and SHALL NOT re-assert any front matter field of its own.
Resetting local content changes nothing about the review.

#### Scenario: A note with local edits is reset
- **WHEN** the author resets a document whose note has been edited since it was last submitted
- **THEN** the note's content is replaced by the content on that document's tracked branch, front matter included, and the note matches that version exactly

#### Scenario: The document's state is untouched
- **WHEN** a document whose state is changes-requested is reset
- **THEN** its state is still changes-requested afterwards, and no tracking record was written

### Requirement: Reset always asks before overwriting, with no silent path
The plugin SHALL ask the author to confirm before every Reset, naming that
local changes to the note will be replaced by the version under review, and
SHALL provide no setting, option, or code path that performs the overwrite
without that confirmation. The prompt SHALL be dismissible without anything
being written.

This is the condition on which a deliberate, author-triggered Reset is
permitted at all while a document is awaiting review. The rule it is
exempted from exists to prevent silent loss of local edits, so an
unconfirmed Reset would be the exact case that rule forbids.

#### Scenario: The author confirms
- **WHEN** the author requests a Reset and confirms the prompt
- **THEN** the note's content is replaced

#### Scenario: The author dismisses the prompt
- **WHEN** the author requests a Reset and dismisses the prompt without confirming
- **THEN** nothing is written, and the note's content is exactly as it was

#### Scenario: There is no way to skip the prompt
- **WHEN** the plugin's Reset path is inspected
- **THEN** every route to the overwrite passes through the confirmation, and no setting disables it

### Requirement: Reset refuses rather than substituting content from elsewhere
The plugin SHALL refuse a Reset, writing nothing, when the document's
content cannot be read from its own tracked branch — whether the path is
absent there or the read did not succeed — and SHALL tell the author the
reset did not happen. It SHALL NOT fall back to any other source of
content.

#### Scenario: The tracked branch no longer holds the document
- **WHEN** a Reset is requested and the document's path is absent on its tracked branch, because the review ended since the panel last refreshed
- **THEN** the note is left untouched and the author is told the reset did not happen, rather than the note being replaced with content from anywhere else

#### Scenario: The read does not succeed
- **WHEN** a Reset is requested and the content read fails for any reason
- **THEN** the note is left untouched and the author is told the reset did not happen
