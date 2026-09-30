# Plugin Shell Specification

## Purpose

This capability defines the foundational plugin shell: the core infrastructure that allows the Obsidian plugin to load, register a sidebar view, and expose entry points for opening that view. This is the baseline all future plugin capabilities are built upon.

## Requirements

### Requirement: Plugin loads without error
The plugin SHALL load successfully when enabled in Obsidian, registering
its sidebar view type without throwing an error or preventing other
plugins from loading.

#### Scenario: Plugin enabled in a vault
- **WHEN** a user enables the plugin in Obsidian's Community Plugins settings
- **THEN** the plugin loads without error and no error notice appears

### Requirement: Sidebar view opens from the ribbon icon
The plugin SHALL add a ribbon icon that opens the plugin's sidebar view
in the right sidebar when clicked.

#### Scenario: Clicking the ribbon icon with the view closed
- **WHEN** the user clicks the plugin's ribbon icon and the sidebar view is not currently open
- **THEN** the sidebar view opens in the right sidebar and becomes the active leaf

### Requirement: Sidebar view opens from the command palette
The plugin SHALL register a command, discoverable in the command
palette, that opens the same sidebar view as the ribbon icon.

#### Scenario: Running the command with the view closed
- **WHEN** the user runs the plugin's command from the command palette and the sidebar view is not currently open
- **THEN** the sidebar view opens in the right sidebar, identical to clicking the ribbon icon

### Requirement: Opening the view never creates a duplicate panel
The plugin SHALL reveal the existing instance of the sidebar view rather
than opening a second one, regardless of which entry point is used or
how many times it is triggered.

#### Scenario: Triggering either entry point while the view is already open
- **WHEN** the sidebar view is already open and the user clicks the ribbon icon or runs the command again
- **THEN** the existing view is revealed and no additional panel is created

#### Scenario: Alternating entry points
- **WHEN** the user opens the view via the ribbon icon, then triggers the command palette entry
- **THEN** the same single view instance is revealed, not a second one

#### Scenario: Two triggers in rapid succession from a closed state
- **WHEN** the view is closed and the user triggers either entry point twice in immediate succession, faster than the first open completes
- **THEN** exactly one panel exists afterwards

### Requirement: The sidebar view shows the current connection state
The plugin's sidebar view SHALL render the plugin's current connection state
whenever it is open, and SHALL update itself when that state changes without
the author reopening it. It SHALL distinguish five situations: no check has
been run, a check is in progress, a check succeeded and the author can create
documents, a check succeeded and the author can only read, and the author
cannot work. The view SHALL always show enough for the author to know what to
do next, and SHALL NOT render an empty container or fixed text that is the
same whether or not the plugin is connected.

#### Scenario: Opening the view before any connection has been checked
- **WHEN** the author opens the sidebar view in a session where no connection check has succeeded
- **THEN** the view shows "Not connected yet", the message "Add your GitLab details to start publishing documents.", a control labelled "Open settings", and the note "You paste your access token once each time you start Obsidian."

#### Scenario: A check is running
- **WHEN** a connection check is in progress while the sidebar view is open
- **THEN** the view shows "Checking…"

#### Scenario: Connected with access to create documents
- **WHEN** a connection check has succeeded and the author's role on the configured project is Developer, Maintainer, or Owner
- **THEN** the view names the person connected as, names their role as "<role> access", shows "Ready to publish your documentation.", and offers a control labelled "New Document"

#### Scenario: Connected with read-only access
- **WHEN** a connection check has succeeded and the author's role on the configured project is Planner or Reporter
- **THEN** the view names the person connected as, names their role as "<role> access", shows "Your <role> access lets you read this project's documents but not add to them. Ask your admin for Developer access.", offers a control labelled "Open settings", and does not offer "New Document"

#### Scenario: The view updates without being reopened
- **WHEN** the sidebar view is open and the retained connection result changes for any reason
- **THEN** the view reflects the new state without the author closing and reopening it

#### Scenario: The view is closed while a check is running
- **WHEN** the author closes the sidebar view while a connection check is in progress and the check then finishes
- **THEN** no error occurs, and opening the view again shows the finished outcome

### Requirement: The sidebar view explains what blocks the author and offers a way on
When the author cannot work, the sidebar view SHALL say why in a sentence
naming what to do next, and SHALL offer a control labelled "Open settings".
It SHALL distinguish a role that grants no access from a role that grants
reading only, and both from a failure to connect, because the author's next
action differs in each. Where the person connected as is known, the view
SHALL still name them, so the author can see that their details were accepted
and their role is the obstacle.

#### Scenario: The role grants no access to the project's documents
- **WHEN** a connection check has succeeded but the author's role on the configured project grants them no access to its documents
- **THEN** the view names the person connected as, names their role, and shows "Your GitLab account does not have access to this project's documents. Ask your admin for access." with a control labelled "Open settings"

#### Scenario: The project could not be reached
- **WHEN** a connection check identified the author but could not reach the configured project
- **THEN** the view names the person connected as and shows "That project could not be found, or your access does not include it. Check your details in settings." with a control labelled "Open settings"

#### Scenario: The access token was rejected
- **WHEN** a connection check failed because the server rejected the token
- **THEN** the view shows "Your access has expired or is incorrect. Ask your admin to set it up again." with a control labelled "Open settings", and names nobody

#### Scenario: The server could not be reached
- **WHEN** a connection check failed because the address was wrong or the network was unavailable
- **THEN** the view shows "Could not reach GitLab at that address. Check the address and your connection, then try again." with a control labelled "Open settings"

#### Scenario: The check failed for any other reason
- **WHEN** a connection check failed for any reason other than those above
- **THEN** the view shows "The connection check did not succeed. Check your details in settings and try again." with a control labelled "Open settings", and displays no status code or raw error text

#### Scenario: Selecting the control from a blocked state
- **WHEN** the author selects "Open settings" from any state in which the view offers it
- **THEN** the plugin's settings tab is opened, or the author is told how to reach it by hand

### Requirement: The panel offers document creation only where it can succeed
The sidebar view SHALL offer the "New Document" control only in the state where
creating a document would succeed, and SHALL NOT show it disabled, greyed, or
otherwise present in any other state. Selecting it SHALL create a document
through the same path as the command palette entry.

#### Scenario: The control is absent before a check has run
- **WHEN** the author opens the sidebar view in a session where no connection check has succeeded
- **THEN** no "New Document" control appears anywhere in the view

#### Scenario: The control appears when the author gains access
- **WHEN** the sidebar view is open showing a read-only or blocked state, and a later connection check succeeds with Developer access or above
- **THEN** the "New Document" control appears without the author reopening the view

#### Scenario: The control disappears when a connection detail is edited
- **WHEN** the sidebar view is open offering "New Document" and the author edits any connection detail in the settings tab
- **THEN** the view returns to its not-connected state and the "New Document" control is no longer offered

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

### Requirement: The panel offers Reset for a document with an open review cycle
The sidebar view SHALL offer a Reset action for the currently open note
when that note's resolved state is pending or changes-requested, alongside
the resubmit action already offered for it. It SHALL NOT offer Reset for a
document in any other state, and SHALL NOT offer it as a per-row control in
either document list.

#### Scenario: The open note is awaiting review
- **WHEN** the author has open a note whose resolved state is pending or changes-requested
- **THEN** the view offers a Reset action for it alongside the resubmit action

#### Scenario: The open note is published or not accepted
- **WHEN** the author has open a note whose resolved state is published or not accepted
- **THEN** no Reset action is offered

#### Scenario: Reset is never a row control
- **WHEN** either document list is rendered
- **THEN** no row carries a Reset control, whatever that document's state

### Requirement: States are refreshed on opening the panel and on request, never on editing
The sidebar view SHALL refresh states from the remote when the view is
opened and when the author selects a refresh control, and SHALL NOT make any
remote request in response to the note being changed, the active note
changing, or the note's metadata changing.

This is normative rather than incidental: the view already re-renders on all
three of those events, so rendering and refreshing must stay separate or
every keystroke touching front matter becomes a request.

#### Scenario: Opening the panel refreshes
- **WHEN** the author opens the sidebar view
- **THEN** states are refreshed from the remote once

#### Scenario: The author refreshes on request
- **WHEN** the author selects the refresh control
- **THEN** states are refreshed from the remote and the list redraws with the result

#### Scenario: Editing a note does not refresh
- **WHEN** the author types in a note, switches to a different note, or edits a note's front matter while the sidebar view is open
- **THEN** the view redraws from the states it already has, and no remote request is made

### Requirement: The panel lists documents available to import
The sidebar view SHALL present a third section listing documents the remote
holds that this vault has no note for, each identified by its remote path.

The section SHALL be present whether or not it has anything to list, and when
it has nothing SHALL say WHICH of the three empty cases it is in: nothing to
import, not yet checked, or the check did not succeed. An absent section says
all three at once, and only the first of them means the author has nothing to
do.

#### Scenario: Documents exist only on the remote
- **WHEN** the author opens the panel in a vault missing three documents the remote holds
- **THEN** a section lists those three, each showing its remote path

#### Scenario: The vault already has everything
- **WHEN** every document on the remote already has a note in the vault
- **THEN** the section is still shown, saying there is nothing to import

#### Scenario: Nothing has been checked yet
- **WHEN** the panel is showing before any check of the remote has answered
- **THEN** the section says so, rather than saying there is nothing to import

#### Scenario: The author collapses the section
- **WHEN** the author collapses the section
- **THEN** its contents are hidden and its heading still reports how many documents it holds, or that its last check failed, so collapsing cannot hide which of the empty cases applies

#### Scenario: The list could not be built
- **WHEN** the remote could not be asked which documents are available, and nothing was resolved on an earlier attempt
- **THEN** the section appears carrying that failure, naming the missing permission where the platform reported one, rather than being absent as though the vault already had everything

The two are different answers and SHALL NOT look alike. "There is nothing to
import" and "the question could not be asked" differ by whether the author
needs to do something, and this section's own failure is not covered by any
other section's: the documents list and this one read different resources,
which a fine-grained credential can grant separately.

#### Scenario: The listing was incomplete
- **WHEN** the remote listing the section is built from was truncated
- **THEN** the author is told the list is incomplete, rather than being shown a partial list presented as everything available

### Requirement: The panel offers import per document and for all of them
The sidebar view SHALL offer an action to import one listed document, and an
action to import every listed document. Each SHALL report its outcome per
document, including which imports were refused and why.

#### Scenario: Importing one document
- **WHEN** the author selects the import action on one listed document
- **THEN** only that document is imported, and it leaves the list

#### Scenario: Importing everything
- **WHEN** the author selects the import-all action
- **THEN** every listed document is imported, and the author is told the outcome for each

#### Scenario: One import in a batch is refused
- **WHEN** the author imports all documents and one of them collides with a note the vault already has
- **THEN** the others are still imported and the refused one is reported with its reason, rather than the batch stopping at the first refusal

### Requirement: Discovery reaches the remote only when asked
The sidebar view SHALL NOT read the remote to build this section while
rendering. It SHALL populate it on the same explicit triggers the panel's
other remote-backed lists already use, and SHALL render from what was last
resolved.

#### Scenario: Rendering does not reach the remote
- **WHEN** the panel re-renders because the author switched notes or edited front matter
- **THEN** no request is made to list the remote's files

#### Scenario: Refreshing populates the section
- **WHEN** the author triggers the panel's refresh
- **THEN** the discoverable documents are resolved from the remote along with the panel's other remote-backed state

### Requirement: A refresh that fails keeps the last known states and says so
When a refresh does not succeed, the sidebar view SHALL continue showing the
states it last resolved, SHALL say that the refresh did not succeed, and
SHALL NOT present the states shown as freshly confirmed. It SHALL NOT clear
the list.

#### Scenario: A refresh fails while states are already on screen
- **WHEN** a refresh fails and the view is already showing resolved states
- **THEN** those states remain on screen and the author is told "Could not check your documents' status just now. They may have changed since this was last updated."

#### Scenario: A refresh is refused for a missing permission
- **WHEN** a refresh is refused because the access token lacks the permission needed to read the project's review queue, and the platform names that permission
- **THEN** the author is told "Your access token doesn't have permission to check your documents' status (missing: Merge Request: Read). Ask your admin to add it."

#### Scenario: The very first refresh fails with nothing to fall back on
- **WHEN** a refresh fails and the view has never resolved any state
- **THEN** the author is told the refresh did not succeed and no document is shown with a state that was never established

### Requirement: Each listed document offers a way to open it on the platform
The sidebar view SHALL offer, for each listed document that has been
submitted, a link that opens that document's review on the platform in the
author's browser.

#### Scenario: Opening a document's review
- **WHEN** the author selects the link beside a listed document that has been submitted
- **THEN** that document's review opens on the platform in the author's browser

#### Scenario: A document with nothing to open
- **WHEN** a listed document resolved as never submitted
- **THEN** no such link is offered for it

### Requirement: The panel lists documents whose tracking record has no note
The sidebar view SHALL list every persisted tracking record whose `doc_id`
matches no note currently in the vault, separately from the list of
documents built from the vault. For each, it SHALL offer a way to recover
the document when its content can be located, and SHALL otherwise state
plainly that automatic recovery is not available and offer the existing way
to open it on the platform instead.

This section SHALL be present whether or not it has anything to list, and
when it has nothing SHALL say which of the three empty cases it is in:
nothing to recover, not yet checked, or the check did not succeed. It SHALL
be collapsible, and a collapsed heading SHALL still report its count or that
its last check failed — collapsing hides a list, never which case applies. It
previously disappeared when empty, on the reasoning that an empty-state
message would compete with the main list; that made three different answers
look identical, and only one of them means the author has nothing to do.

Where recovery is unavailable for several records at once, the explanation
SHALL be given once for the section rather than repeated on every row.

#### Scenario: A recoverable orphaned record is listed
- **WHEN** the vault holds no note for a persisted record, and that document's content can be located
- **THEN** the record is listed with a way to recover it

#### Scenario: A non-recoverable orphaned record is listed with an explanation
- **WHEN** the vault holds no note for a persisted record, and that document's content cannot be located
- **THEN** the record is listed stating recovery is not available, with a way to open it on the platform instead

#### Scenario: Nothing to recover
- **WHEN** every persisted record matches a note in the vault
- **THEN** this list is still shown, saying there is nothing to recover

#### Scenario: The check did not succeed
- **WHEN** resolving which records can be recovered failed, and nothing was resolved on an earlier attempt
- **THEN** the section is shown carrying that failure, naming the missing permission where the platform reported one

### Requirement: Recovery fetches content only when the author asks for it
Listing which orphaned records exist SHALL make no remote request. A remote
request to read a document's content SHALL be made only when the author
selects that document's recovery action.

#### Scenario: Listing orphaned records makes no request
- **WHEN** the panel renders the list of documents with no matching note
- **THEN** no request is made to determine which are listed

#### Scenario: Recovering one document requests only that document's content
- **WHEN** the author selects the recovery action for one listed document
- **THEN** a request is made for that document's content, and no request is made for any other listed document

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
