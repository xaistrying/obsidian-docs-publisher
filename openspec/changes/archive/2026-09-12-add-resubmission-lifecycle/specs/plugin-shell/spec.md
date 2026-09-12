## ADDED Requirements

### Requirement: A tracked document offers a resubmit action in every state
The sidebar view SHALL offer an action for the currently open document
whenever it is already tracked, matching that document's resolved state,
rather than showing only its state label. Selecting the action SHALL
resubmit through the same path as the command palette's "Submit for
review" command.

#### Scenario: A pending document offers to push an update
- **WHEN** the currently open document's resolved state is pending
- **THEN** the view shows the state label and an action that pushes an update when selected

#### Scenario: A changes-requested document offers to push an update
- **WHEN** the currently open document's resolved state is changes-requested
- **THEN** the view shows the state label and an action that pushes an update when selected

#### Scenario: A published document offers to open a new review cycle
- **WHEN** the currently open document's resolved state is published
- **THEN** the view shows the state label and an action that starts a new review cycle when selected

#### Scenario: A not-accepted document offers to open a new review cycle
- **WHEN** the currently open document's resolved state is not accepted
- **THEN** the view shows the state label and an action that starts a new review cycle when selected

#### Scenario: The command palette and the panel action agree
- **WHEN** the author resubmits the same document once through the panel's action and once through the command palette, in separate sessions with identical starting state
- **THEN** both produce the same outcome
