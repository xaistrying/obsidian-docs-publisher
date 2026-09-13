## ADDED Requirements

### Requirement: A document under review can have its remote content read from its own branch
This capability SHALL provide a way to read the content a document
currently carries on its own tracked branch, answering three ways: the
content was found, the path is absent on that branch, or the read did not
succeed. It SHALL NOT fall back to the project's default branch on an
absent answer.

The recovery read this mirrors does fall back, because a recovered
document may have been published and had its branch deleted. A document
being reset has an open review cycle by definition, so its branch exists;
an absent answer there means the caller's understanding of the state is
stale, not that the content lives somewhere else. Falling back would
substitute content from a different cycle that the author never asked for.

#### Scenario: The document's content is read from its tracked branch
- **WHEN** the read is performed for a document whose tracked branch holds its file
- **THEN** the caller receives that file's content as it stands on that branch

#### Scenario: The path is absent on the tracked branch
- **WHEN** the read is performed and the document's path does not exist on its tracked branch
- **THEN** the caller receives the absent answer, and no read is attempted against the project's default branch

#### Scenario: The read does not succeed
- **WHEN** the read fails for any reason other than the path being explicitly reported absent
- **THEN** the caller receives a read failure, and does NOT receive the absent answer

### Requirement: Only a document with an open review cycle can be reset
This capability SHALL report a document as resettable only when its
resolved state is pending or changes-requested. A document resolved as
published, not accepted, or never submitted SHALL NOT be reported as
resettable, and a document whose state has not been resolved SHALL NOT be
either.

#### Scenario: A document awaiting review
- **WHEN** a document's resolved state is pending or changes-requested
- **THEN** it is reported as resettable

#### Scenario: A document whose cycle is over
- **WHEN** a document's resolved state is published or not accepted
- **THEN** it is not reported as resettable

#### Scenario: A document whose state is unknown
- **WHEN** a document's state has not been resolved in this session
- **THEN** it is not reported as resettable, rather than assumed to be in an open cycle
