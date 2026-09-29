## ADDED Requirements

### Requirement: The edit baseline describes what the plugin last wrote
Every operation that writes a tracked note's content on the author's behalf
SHALL record, against that document, a baseline describing the note as it
stands after that write. A document whose note has not changed since the
plugin last wrote it SHALL NOT be reported as edited.

The baseline SHALL be captured from a source that reflects the completed
write rather than from a cached view of the file, since a baseline sampled
before the write lands is indistinguishable from a note the author has since
edited.

The baseline is a fact about the NOTE and not about the review. Recording it
SHALL NOT change a document's state, its branch, or its remote path.

A document with no baseline SHALL be reported as not edited. Absence means
nothing has been established, and reporting an unestablished difference would
raise every previously published document at once.

#### Scenario: A note is submitted and not touched afterwards
- **WHEN** a document is submitted and its note is not edited afterwards
- **THEN** the document is not reported as edited

#### Scenario: A note is edited after being submitted
- **WHEN** the author edits a note after its document was submitted
- **THEN** the document is reported as edited

#### Scenario: A note is reset to the version under review
- **WHEN** a document under review is reset, so its note is replaced with the content that document carries on its own tracked branch
- **THEN** the document is not reported as edited, because the note now matches what the plugin last wrote

#### Scenario: A note is edited after being reset
- **WHEN** the author edits a note after resetting it
- **THEN** the document is reported as edited again

#### Scenario: A document imported from the platform
- **WHEN** a document is imported and its note is not edited afterwards
- **THEN** the document is not reported as edited

#### Scenario: A record written before baselines existed
- **WHEN** a document's stored record carries no baseline
- **THEN** the document is reported as not edited, rather than edited
