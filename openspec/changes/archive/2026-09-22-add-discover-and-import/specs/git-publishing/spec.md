## ADDED Requirements

### Requirement: The repository's file listing can be read, bounded and honest about its bound
This capability SHALL provide a way to list the files present on a given ref
of the target project, recursively. It SHALL follow pagination to a fixed
cap, and SHALL report whether the listing was truncated as part of a
successful answer.

A truncated listing SHALL NOT be presented as a complete one. A file missing
from a partial listing is indistinguishable from a file that does not exist,
and a caller resolving from that would tell the author the corpus lacks
something it has.

#### Scenario: Listing a repository that fits within the cap
- **WHEN** the listing is read for a project whose file count is below the cap
- **THEN** every file's path is returned, and the answer reports that it was not truncated

#### Scenario: Listing a repository larger than the cap
- **WHEN** the listing is read for a project with more files than the cap allows
- **THEN** the answer reports that it was truncated, and the caller is able to tell that what it received is incomplete

#### Scenario: The listing does not succeed
- **WHEN** the listing fails for any reason
- **THEN** the caller receives the failure with its classification, and does NOT receive an empty listing that would read as "the project has no files"

#### Scenario: The credential lacks permission to read the repository
- **WHEN** the listing is refused because the credential's fine-grained permissions do not cover reading the project's repository
- **THEN** the caller receives the insufficient-permission classification, preserving any permission name the response reported
