## ADDED Requirements

### Requirement: Resolving a document's remote path is unaffected by the files it embeds
Every place this capability resolves a document's remote path from its
merge request SHALL continue to resolve it once that merge request also
carries the images the document embeds. A merge request carrying a document
and its attachments SHALL NOT be treated as one whose path could not be
determined.

This binds three behaviours that already exist: the path-mismatch check
that refuses a resubmit whose note has moved, Reset's read of the content
under review, and recovery's fallback for a record with no stored path. All
three read the same answer, and before this change all three lost it the
moment a merge request carried more than one file.

#### Scenario: The path-mismatch check still binds for an illustrated document
- **WHEN** a document whose merge request carries its note and two images is resubmitted from a note that has been moved to a different folder
- **THEN** the resubmit is refused and the author is told the path to restore, rather than the check being skipped because the path could not be determined

#### Scenario: Reset still works for an illustrated document
- **WHEN** the author resets a document under review whose merge request carries its note and an image
- **THEN** the note's content is restored from the remote, rather than the reset failing because the path could not be determined

#### Scenario: Recovery's fallback still works for an illustrated document
- **WHEN** a record with no stored path is resolved for recovery, and its open merge request carries the document and an image
- **THEN** the document resolves as recoverable at its own path, rather than as unrecoverable
