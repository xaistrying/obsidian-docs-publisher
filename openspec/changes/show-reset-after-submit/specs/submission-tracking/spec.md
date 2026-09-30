## ADDED Requirements

### Requirement: A review this session's own submit opened is resolved as pending
When a submit succeeds by opening a new review for a document, this capability
SHALL record that document's state as resolved for the running session, as
pending, with the new review's number and no link. This applies on a first
submit, when a tracked document has no review on the remote, and when a
published or not-accepted document is submitted again. The state SHALL be
recorded only after the remote has accepted both the write and the new review,
and it SHALL be recorded as it would be after a successful refresh, so every
surface that reads resolved states treats it the same way.

This SHALL be the only write of a resolved state outside a refresh. It is
certain rather than optimistic: the review was opened a moment ago, by this
session, from a branch that had no open review, so the remote holds exactly
one open review for the document and that review has no threads on it yet.
Whether the review is a draft does not enter state resolution, so a
draft makes no difference here.

A submit that sends an update to a document already under review SHALL NOT
change its resolved state in any way. Pushing a revision resolves no review
thread, so recording pending there would show a state the remote may not hold.
A state that was resolved before the update SHALL stay exactly as it was. A
state that was not resolved SHALL stay unresolved until a refresh.

A submit that fails at any point SHALL record no resolved state. The recorded
state SHALL be held in memory only. Nothing SHALL be added to plugin data,
because the submit already stores its record there. The next successful
refresh SHALL replace the recorded state along with every other resolved
state, and clearing the resolved states when the connection details change
SHALL clear it too.

#### Scenario: A first submit
- **WHEN** the author submits a document for the first time and the submit succeeds
- **THEN** the document's resolved state for this session is pending, carrying the new review's number, without a refresh

#### Scenario: A new version of a published document
- **WHEN** a document whose resolved state is published is submitted again and the submit succeeds
- **THEN** its resolved state for this session becomes pending, carrying the new review's number, without a refresh

#### Scenario: Submitting again after not accepted
- **WHEN** a document whose resolved state is not accepted is submitted again and the submit succeeds
- **THEN** its resolved state for this session becomes pending, carrying the new review's number, without a refresh

#### Scenario: An update to a document already under review, state resolved
- **WHEN** an update is sent for a document whose resolved state is pending or changes-requested
- **THEN** its resolved state is unchanged, and a changes-requested document is still changes-requested

#### Scenario: An update to a document already under review, state not resolved
- **WHEN** an update is sent for a document nothing in this session has resolved
- **THEN** the document stays unresolved until the next successful refresh

#### Scenario: A submit that fails
- **WHEN** a submit fails at any point, including after the write when the new review could not be opened
- **THEN** no resolved state is recorded for the document, and its resolved state is whatever it was before

#### Scenario: The next refresh decides
- **WHEN** a refresh succeeds after a submit recorded a document as pending
- **THEN** the document's resolved state is whatever that refresh resolved, and the recorded one is discarded

#### Scenario: Nothing is carried across a reload
- **WHEN** the plugin is reloaded after a submit recorded a document as pending
- **THEN** the document is unresolved until a refresh succeeds, and plugin data holds nothing it did not hold before this change
