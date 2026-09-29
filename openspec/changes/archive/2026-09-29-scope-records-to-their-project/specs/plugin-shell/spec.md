## MODIFIED Requirements

### Requirement: A tracked document offers a resubmit action in every state
The sidebar view SHALL offer an action for the currently open document
whenever it is already tracked, matching that document's RESOLVED state,
rather than showing only its state label. Selecting the action SHALL
resubmit through the same path as the command palette's "Submit for
review" command.

The action and the label SHALL be derived from the same answer. The view
SHALL NOT take its label from a stored record while taking its eligibility
from somewhere else: a record describes where a document stood on the project
it was written against, and offering an action from it while the resolved
state says otherwise acts on a claim the remote has not made.

No action SHALL be offered for a document whose record belongs to a project
other than the configured one, or whose project is not known. Such a document
has no resolved state, and an action built from its record would carry a branch
and a merge request belonging to a different project.

A document whose record names a DIFFERENT project, and for which the configured
project holds no review, SHALL be marked as being in another project. Without
the marker it reads exactly like work owed on this project, and its only offered
action submits into the configured one. A record whose project is not known
SHALL NOT be marked: that would assert the one thing not established.

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

#### Scenario: The open document's record belongs to another project
- **WHEN** the currently open document's record carries a project other than the configured one, and the configured project holds no review for it
- **THEN** no resubmit action is offered for it and no state label is shown, and it is marked as being in another project, so an author who configured the wrong project by mistake is warned before submitting into it

#### Scenario: A record whose project is not known is not marked
- **WHEN** a document's record carries no project, and the configured project holds no review for it
- **THEN** no state label and no marker are shown, since nothing established where it belongs and saying "another project" would assert it

#### Scenario: The plugin is pointed at a different project
- **WHEN** the connection details are changed to a different project, and the documents in the vault were submitted to the previous one
- **THEN** none of them is shown a state or offered an action, rather than continuing to show the states they held on the previous project

#### Scenario: Submitting into the new project is still offered
- **WHEN** the author opens a document whose record belongs to a different project, and that document has never been submitted to the configured one
- **THEN** the view offers a first submission, since submitting into the configured project is a thing the author can still do
