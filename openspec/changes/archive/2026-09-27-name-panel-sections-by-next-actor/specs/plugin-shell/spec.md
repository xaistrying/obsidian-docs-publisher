## RENAMED Requirements

- FROM: `### Requirement: The panel separates documents with an open review cycle from the rest`
- TO: `### Requirement: The panel separates documents by who acts next`

## MODIFIED Requirements

### Requirement: The panel lists the author's documents with their current state
The sidebar view SHALL list every note in the vault whose front matter
carries a `doc_id` and that has a next action, showing each one's name and
its current state's author-facing label. A document has a next action when
the author or a reviewer is expected to act on it. A document that is
published, and whose note has not been edited since the plugin last wrote it,
has none, and SHALL NOT be listed: a list of settled documents is reference
rather than work, and the panel deliberately does not carry one. Notes
carrying no `doc_id` SHALL NOT appear in any list.

A document's state label SHALL be shown whenever that document has a resolved
state. No marker a row also carries SHALL be displayed in place of that
label. Markers describing the note — that it has been edited since it was
last sent, for instance — SHALL be shown alongside the state, not instead of
it: the state is where the document stands with its reviewers and the marker
is what is true of the local note, and an author acting on one needs the
other.

#### Scenario: Documents are listed with their states
- **WHEN** the author opens the sidebar view in a vault holding one note that carries `doc_id` but was never submitted, one document awaiting review, one with changes requested, one not accepted and one published, none of them edited since they were last sent
- **THEN** the first four are listed, each showing its own state's label, and the published one is not listed

#### Scenario: A published document that has been edited
- **WHEN** a published document's note has been edited since it was last sent
- **THEN** it is listed, showing the "Published" label and the edited marker

#### Scenario: Notes that have never been submitted are not listed
- **WHEN** the author opens the sidebar view in a vault holding many notes, only some of which carry `doc_id`
- **THEN** only notes carrying `doc_id` appear

#### Scenario: The list is empty before anything has been submitted
- **WHEN** the author opens the sidebar view in a vault where no note carries `doc_id`
- **THEN** the "Needs you" section reads "Nothing submitted yet. Documents you submit will be listed here.", rather than showing an error, and the view's existing controls are unaffected

#### Scenario: A document that is both under review and locally edited
- **WHEN** a document whose state is changes-requested has been edited since it was last sent
- **THEN** its row shows the changes-requested label AND the edited marker, so the author can see both where the review stands and that local work has not reached it

#### Scenario: An edited document whose state is unresolved
- **WHEN** a document has been edited since it was last sent and no refresh has resolved its state
- **THEN** its row shows the edited marker and no state label, since no state has been established to show

### Requirement: The panel separates documents by who acts next
The sidebar view SHALL present listed documents in two sections, each named
for who acts next, and every listed document SHALL be in exactly one of them:

- **"Needs you"** SHALL hold every document waiting on the author: never
  submitted, changes requested, not accepted, any document edited since it was
  last sent, and any document whose state has not been resolved.
- **"Waiting on reviewers"** SHALL hold every document waiting for review
  whose note has not been edited since it was last sent.

A document whose state has not been resolved SHALL NOT be placed in "Waiting
on reviewers", since that would assert a review nothing has established.

"Needs you" SHALL come first and hold the Refresh control. "Waiting on
reviewers" SHALL be collapsible, SHALL be collapsed when the view opens, and
SHALL be present whether or not it holds anything. Its heading SHALL report
its count while collapsed, or that the last check failed, so that collapsing
it hides the list and never the count.

Each section SHALL carry a one-line description of what it holds, shown
whether or not it has rows. "Needs you" SHALL read "Documents waiting on you:
not sent yet, sent back by a reviewer, or changed since you last sent them."
"Waiting on reviewers", when expanded, SHALL read "Sent and unchanged. Nothing
to do until a reviewer responds." A heading names the rule only to someone
who already knows it.

When "Needs you" holds nothing but some note carries `doc_id`, it SHALL read
"Nothing needs you right now." When "Waiting on reviewers" is expanded and
holds nothing, it SHALL read "Nothing is waiting for review right now."

#### Scenario: A vault holding documents in several states
- **WHEN** the author opens the sidebar view in a vault holding one document awaiting review, one with changes requested, one published, and one not accepted, none of them edited since they were last sent
- **THEN** the changes-requested and not-accepted ones are in "Needs you", the awaiting-review one is in "Waiting on reviewers", and the published one is in neither

#### Scenario: A never-submitted note stays where it was
- **WHEN** the author opens the sidebar view in a vault holding a note that carries `doc_id` but resolves as never submitted
- **THEN** it appears in "Needs you"

#### Scenario: A submitted document moves rather than disappears
- **WHEN** the author submits a document and does not edit it afterwards
- **THEN** it is no longer in "Needs you", it is in "Waiting on reviewers", and that section's heading count has gone up by one

#### Scenario: Editing a document under review
- **WHEN** the author edits a document that is in "Waiting on reviewers"
- **THEN** it moves to "Needs you", showing "Waiting for review" and the edited marker

#### Scenario: Sending an update
- **WHEN** the author sends an update for a document that is waiting for review and has been edited
- **THEN** it moves back to "Waiting on reviewers"

#### Scenario: A reviewer requests changes
- **WHEN** a document in "Waiting on reviewers" is refreshed and resolves as changes requested
- **THEN** it moves to "Needs you", showing "Changes requested"

#### Scenario: A document whose state has not been resolved yet
- **WHEN** a tracked document's state has not been resolved, because no refresh has succeeded and nothing is stored for it
- **THEN** it appears in "Needs you", and not in "Waiting on reviewers"

#### Scenario: The section opens collapsed
- **WHEN** the author opens the sidebar view while two documents are waiting for review and untouched
- **THEN** "Waiting on reviewers" shows its heading and a count of 2, and no rows until the author expands it

#### Scenario: Expanded, the section shows full rows
- **WHEN** the author expands "Waiting on reviewers"
- **THEN** each document in it is shown with its name, its state's label and its way to open it on the platform, as in "Needs you"

#### Scenario: Nothing needs the author, but something is under review
- **WHEN** every tracked document is either waiting for review and untouched, or published and untouched
- **THEN** "Needs you" reads "Nothing needs you right now."

#### Scenario: Nothing is under review
- **WHEN** no document is waiting for review untouched and the author expands "Waiting on reviewers"
- **THEN** it reads "Nothing is waiting for review right now.", and its collapsed heading shows a count of 0

#### Scenario: Each section says what it holds
- **WHEN** the author opens the sidebar view and expands "Waiting on reviewers", before any refresh has run
- **THEN** "Needs you" shows its description and "Waiting on reviewers" shows its own, whatever rows either section has

#### Scenario: A refresh fails
- **WHEN** the last refresh failed and "Waiting on reviewers" is collapsed
- **THEN** its heading reports that the check failed, rather than a count that might be stale
