## ADDED Requirements

### Requirement: A record says which project it belongs to
A persisted record SHALL carry the project it was written against, identified
by the platform's address together with that project's canonical numeric
identifier. The address is part of the identity because the same namespace path
on two instances is two unrelated projects. The canonical identifier is used
rather than whatever the author typed, because the connection details accept
either a numeric identifier or a namespace path, and the same project configured
both ways SHALL NOT read as two.

A record whose project is NOT KNOWN SHALL NOT be treated as belonging to the
configured project. Absence means nothing has been established, and assuming
otherwise is the error this requirement exists to prevent.

A record SHALL be stamped with a project only when the remote has CONFIRMED the
document lives there — that is, when reconciliation matches its `doc_id` to a
merge request on the configured project. It SHALL NOT be stamped on the grounds
that a project happens to be configured.

#### Scenario: A submission records where it was submitted
- **WHEN** a document is submitted successfully
- **THEN** its record carries the address and canonical identifier of the project it was submitted to

#### Scenario: A record is stamped when the remote confirms it
- **WHEN** reconciliation matches a record's `doc_id` to a merge request on the configured project, and that record carries no project yet
- **THEN** the record is stamped with that project, because the match establishes that the document lives there

#### Scenario: A record is not stamped merely because a project is configured
- **WHEN** a record carries no project and reconciliation finds no merge request for its `doc_id` on the configured project
- **THEN** the record is left unstamped, rather than being assumed to belong to the project currently configured

#### Scenario: The same project configured two ways
- **WHEN** the connection details are changed from a project's numeric identifier to its namespace path, or the reverse, without changing which project is meant
- **THEN** records stamped with that project still match, because both forms resolve to the same canonical identifier

#### Scenario: The same path on a different platform
- **WHEN** records were written against a project path on one platform address, and the plugin is pointed at the same path on a different address
- **THEN** those records do not match the configured project

### Requirement: A record that does not belong to the configured project resolves to no state
A document whose record carries a different project than the configured one, or
carries none, SHALL resolve to no state rather than to the state that record
holds. The stored state describes a review on a platform or project this plugin
is not looking at, and presenting it would assert something about the configured
project that nothing established.

Where a document's state cannot be resolved from the remote, the stored record
SHALL be consulted only if it belongs to the configured project. That fallback
exists so an imported document reads as published — it has no merge request, so
the record is the only thing that knows — and it SHALL NOT be extended to a
record whose project is foreign or unknown, because those are the same
observation for a different reason.

#### Scenario: An imported document with no merge request
- **WHEN** a document's record belongs to the configured project and the remote reports no merge request for it, because it was imported rather than submitted
- **THEN** it resolves to the state its record holds, as it does today

#### Scenario: A document whose record belongs to another project
- **WHEN** a document's record carries a project other than the configured one
- **THEN** it resolves to no state, and no stored state is shown for it

#### Scenario: A document whose record carries no project yet
- **WHEN** a document's record carries no project and the remote reports no merge request for it on the configured project
- **THEN** it resolves to no state, rather than to the state the record holds
