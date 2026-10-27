## MODIFIED Requirements

### Requirement: The panel offers Reset for a document with an open review cycle
The sidebar view SHALL offer a Reset action for the currently open note
when that note's resolved state is pending or changes-requested, alongside
the resubmit action already offered for it. It SHALL NOT offer Reset for a
document in any other state, and SHALL NOT offer it as a per-row control in
either document list.

A state recorded by this session's own successful submit, per
submission-tracking, is a resolved state for this purpose. Reset SHALL
therefore be offered as soon as a submit that opened a new review succeeds,
with no refresh in between. A stored record alone SHALL NOT be enough, whatever
the state label beside the action says.

#### Scenario: The open note is awaiting review
- **WHEN** the author has open a note whose resolved state is pending or changes-requested
- **THEN** the view offers a Reset action for it alongside the resubmit action

#### Scenario: The open note is published or not accepted
- **WHEN** the author has open a note whose resolved state is published or not accepted
- **THEN** no Reset action is offered

#### Scenario: Reset is never a row control
- **WHEN** either document list is rendered
- **THEN** no row carries a Reset control, whatever that document's state

#### Scenario: Straight after a submit that opened a review
- **WHEN** the author submits the open note for the first time, or submits a published or not-accepted note again, and the notice "Waiting for review" appears
- **THEN** without a refresh, the view shows "Waiting for review" for it, the resubmit action reads "Send update", and Reset is offered beside it

#### Scenario: After sending an update to a note whose state was resolved
- **WHEN** the author sends an update for the open note while its resolved state is pending or changes-requested, and the notice "Your update was sent. Refresh to see where the review stands." appears
- **THEN** the view shows the same state as before the update, and Reset is still offered

#### Scenario: After sending an update to a note nothing has resolved
- **WHEN** the author sends an update for the open note while nothing in this session has resolved its state, and the notice "Your update was sent. Refresh to see where the review stands." appears
- **THEN** no Reset action is offered until a refresh succeeds and resolves the note as pending or changes-requested

#### Scenario: A restored note, after a refresh in this session
- **WHEN** a refresh has succeeded in this session and the author restores a note from "Documents you can restore" whose review is still open
- **THEN** Reset is offered for the restored note once it is open, without another refresh

#### Scenario: A restored note, before any refresh has succeeded
- **WHEN** the author restores a note while no refresh has succeeded in this session
- **THEN** no Reset action is offered until a refresh succeeds

#### Scenario: The review ended between the submit and Reset
- **WHEN** the author presses Reset on a note recorded as pending by its own submit, and the review has since been published and its tracked branch removed
- **THEN** nothing is written to the note and the author is shown "This document's review has already finished, so nothing was reset. Refresh to see where it stands now."
