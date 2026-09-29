## ADDED Requirements

### Requirement: A submission records the project it submitted to
A successful submission SHALL record the project it wrote to alongside the
branch and merge request it created, so that the record it leaves says where
that work lives and not merely that it exists.

A submission is the other moment, besides a confirmed reconciliation, at which
a document's project is established by evidence rather than assumption: the
branch and the merge request were just created there.

#### Scenario: A first submission records its project
- **WHEN** a document is submitted for the first time and its remote writes succeed
- **THEN** its record carries the project those writes went to, alongside the branch and merge request

#### Scenario: A revision records the project it pushed to
- **WHEN** a revision is pushed to an existing review
- **THEN** the record still carries the project that review lives on

#### Scenario: Submitting a document whose record belongs elsewhere
- **WHEN** the author submits a document whose existing record carries a different project than the configured one
- **THEN** it is submitted as a first submission into the configured project, and its record afterwards carries the configured project rather than the previous one
