## MODIFIED Requirements

### Requirement: Reset replaces a note's content with the version under review
The plugin SHALL, on the author's explicit request for a document whose
resolved state is pending or changes-requested, replace the open note's
entire content with the content that document currently carries on its own
tracked branch. It SHALL write the remote's content verbatim, including
front matter, so the note afterwards matches what reviewers are looking at
byte for byte.

It SHALL NOT change the document's state, its branch, or its remote path,
and SHALL NOT re-assert any front matter field of its own. Resetting local
content changes nothing about where the review stands.

It SHALL record the edit baseline for the note it has just written, so a
document reset to the version under review is not afterwards reported as
edited. That baseline describes the note rather than the review, so writing
it is consistent with the paragraph above rather than an exception to it —
leaving it stale would assert that the note differs from a version it is
byte-identical to.

#### Scenario: A note with local edits is reset
- **WHEN** the author resets a document whose note has been edited since it was last submitted
- **THEN** the note's content is replaced by the content on that document's tracked branch, front matter included, and the note matches that version exactly

#### Scenario: The document's state is untouched
- **WHEN** a document whose state is changes-requested is reset
- **THEN** its state is still changes-requested afterwards, and neither its branch nor its remote path was changed

#### Scenario: The reset note is not reported as edited
- **WHEN** a document is reset and its note is not edited afterwards
- **THEN** the panel does not report that document as edited, because its note matches what the plugin last wrote

#### Scenario: Editing after a reset
- **WHEN** the author edits a note after resetting it
- **THEN** the panel reports that document as edited again
