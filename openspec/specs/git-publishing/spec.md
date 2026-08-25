# Git Publishing Specification

## Purpose

This capability defines the plugin's sole boundary for talking to a remote
git hosting platform (starting with GitLab). It owns every outbound HTTP
request, translates platform responses into information callers can use,
and classifies failures so the rest of the plugin never has to interpret a
raw HTTP status or response body.

## Requirements

### Requirement: All remote access goes through this capability
Remote calls SHALL be made only from this capability. No other part of the
plugin SHALL perform an HTTP request, construct a remote address, or reference
a platform's endpoint shape. Callers SHALL pass the connection details they
hold and receive a result they can act on without knowing how it was obtained.

#### Scenario: Another capability needs remote data
- **WHEN** any capability outside this one needs information from the remote platform
- **THEN** it calls a method on this capability rather than issuing a request itself

#### Scenario: Checking the boundary holds
- **WHEN** the plugin's source is inspected for the HTTP request helper it uses
- **THEN** that helper appears only within this capability's files

### Requirement: Remote calls use Obsidian's request helper
This capability SHALL make requests using Obsidian's own `requestUrl` and SHALL
NOT use the browser `fetch` API, so that requests succeed against self-managed
servers that do not permit browser cross-origin requests.

#### Scenario: A request against a self-managed server
- **WHEN** the plugin makes a request to a self-managed GitLab address that does not send permissive cross-origin headers
- **THEN** the request is performed through Obsidian's request helper and is not blocked

### Requirement: The identity of the current account can be read
This capability SHALL provide a way to read the account the supplied token
belongs to, returning at least that account's identifier, display name, and
username.

#### Scenario: Reading identity with a valid token
- **WHEN** the identity read is performed with a valid token
- **THEN** it returns the identifier, display name, and username of the account that token belongs to

### Requirement: The current account's access on a project can be read
This capability SHALL provide a way to read the access level the current
account holds on a named project, given that account's identifier.

#### Scenario: Reading access on a reachable project
- **WHEN** the access read is performed for an account that is a member of the named project
- **THEN** it returns that account's access level on that project

#### Scenario: Reading access on a project the account cannot reach
- **WHEN** the access read is performed for a project that does not exist or that the account's access does not cover
- **THEN** it reports the not-reachable outcome rather than returning an access level

### Requirement: Failures are classified, not passed through raw
This capability SHALL classify every failed call into one of: rejected
credential, target not reachable with this credential, server unreachable, or
unexpected failure. It SHALL return that classification to its caller and SHALL
NOT decide what the author is told.

#### Scenario: The credential is rejected
- **WHEN** a call fails because the server rejected the supplied token
- **THEN** the caller receives the rejected-credential classification

#### Scenario: The target cannot be reached with this credential
- **WHEN** a call fails because the named project does not exist or is not covered by the token's access
- **THEN** the caller receives the not-reachable classification

#### Scenario: The server cannot be reached
- **WHEN** a call fails because the address does not resolve, the connection times out, or the network is unavailable
- **THEN** the caller receives the server-unreachable classification

#### Scenario: Anything else
- **WHEN** a call fails for any other reason, including an unexpected response
- **THEN** the caller receives the unexpected-failure classification, and no raw response text is surfaced to the author by the caller
