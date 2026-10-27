## RENAMED Requirements

- FROM: `### Requirement: The sidebar view shows the current connection state`
- TO: `### Requirement: The sidebar view shows setup progress, then the ready screen`

## MODIFIED Requirements

### Requirement: The sidebar view shows setup progress, then the ready screen
The plugin's sidebar view SHALL render the plugin's current setup progress
whenever it is open, and SHALL update itself when that progress changes without
the author reopening it. While any of the five setup steps is incomplete, the
view SHALL show only the first incomplete step, headed "Set up Docs Publisher"
with "Step <n> of 5", the step's heading and text, and the step's controls. When
all five are complete it SHALL show the ready screen. The view SHALL always show
enough for the author to know what to do next, and SHALL NOT render an empty
container.

The steps and what each shows:

1. Git installed. Heading "Git isn't installed on this computer." Text "Docs Publisher needs Git to send and get documents. Install it, then check again." Controls "Get Git" and "Check again".
2. Project address. Heading "Add your project's address." Text "Paste the SSH address from GitLab's Clone button." Control "Open settings".
3. Key. With no key: heading "Connect this computer to GitLab.", text "A key lets GitLab recognise this computer. It stays on this computer.", control "Create key". With a key not yet tested: heading "Connect this computer to GitLab.", text "Add your key to GitLab, then test it.", controls "Copy key", "Open GitLab" and "Test". With a key that passed the test but no username known: heading "Connect this computer to GitLab.", text "Type your GitLab username so new documents can name you as their owner.", control "Open settings".
4. Vault connected. Heading "Connect this vault to the project." Text "Docs Publisher will download the project's documents. Your own notes are never replaced without asking." Control "Connect this vault".
5. Name and email. Heading "Tell us who you are." Text "Your name and email appear on the documents you send." Control "Open settings". This step does not show for an author whose machine-wide settings already hold a name and email.

The ready screen SHALL name the person connected as ("Connected as <username>"
when the username is known), show "Ready to publish your documentation.", and
offer "New Document".

#### Scenario: Opening the view on a fresh machine
- **WHEN** the author opens the sidebar view with git installed and nothing else set up
- **THEN** the view shows "Set up Docs Publisher", "Step 2 of 5", "Add your project's address." and a control labelled "Open settings", and no document controls

#### Scenario: Each step shows only itself
- **WHEN** steps 1 and 2 are complete and step 3 is not
- **THEN** only step 3's heading, text and controls are shown

#### Scenario: The identity step is the last
- **WHEN** steps 1 to 4 are complete and no name or email exists in any scope
- **THEN** the view shows "Step 5 of 5", "Tell us who you are." and a control labelled "Open settings"

#### Scenario: Git is missing
- **WHEN** git cannot be found
- **THEN** the view shows "Git isn't installed on this computer." with "Get Git" and "Check again"

#### Scenario: A step is completed elsewhere
- **WHEN** the sidebar view is open and the author completes a step in the settings tab
- **THEN** the view moves to the next incomplete step without being reopened

#### Scenario: Setup is complete
- **WHEN** all five steps are complete
- **THEN** the view shows "Ready to publish your documentation." and offers "New Document"

#### Scenario: The view is closed while a setup action is running
- **WHEN** the author closes the sidebar view while the key test is running and it then finishes
- **THEN** no error occurs, and opening the view again shows the finished outcome

### Requirement: The sidebar view explains what blocks the author and offers a way on
When a setup action fails or a later action reports a setup-type failure, the
sidebar view SHALL say why with the message for that failure (platform-config,
"Setup problems are reported with a message that names what to do next"), in a
sentence naming what to do next, and SHALL show the controls of the step it
belongs to. A step that needs typing SHALL offer a control labelled "Open
settings". It SHALL NOT show a status, an exit code or raw output.

#### Scenario: The key was rejected
- **WHEN** the key test fails because GitLab does not recognise the key
- **THEN** the view shows "GitLab doesn't recognise this key yet. Add it on GitLab's SSH keys page, then test again." with "Copy key", "Open GitLab" and "Test"

#### Scenario: The server could not be reached
- **WHEN** a setup action fails because the address is wrong or the network is unavailable
- **THEN** the view shows "Could not reach GitLab at that address. Check the address and your connection, then try again." with the step's controls

#### Scenario: The project could not be reached
- **WHEN** the key works but the project cannot be read
- **THEN** the view shows "That project could not be found, or your access does not include it. Check the address in settings." with a control labelled "Open settings", and returns to the project address step

#### Scenario: Selecting the control from a blocked state
- **WHEN** the author selects "Open settings" from any state in which the view offers it
- **THEN** the plugin's settings tab is opened, or the author is told how to reach it by hand

### Requirement: The panel offers document creation only where it can succeed
The sidebar view SHALL offer the "New Document" control only when setup is
complete, and SHALL NOT show it disabled, greyed, or otherwise present in any
other state. Selecting it SHALL create a document through the same path as the
command palette entry.

#### Scenario: The control is absent during setup
- **WHEN** the author opens the sidebar view while any setup step is incomplete
- **THEN** no "New Document" control appears anywhere in the view

#### Scenario: The control appears when setup completes
- **WHEN** the sidebar view is open showing a setup step and the author completes the last step
- **THEN** the "New Document" control appears without the author reopening the view

#### Scenario: The control disappears when a step becomes incomplete
- **WHEN** the sidebar view is open offering "New Document" and a later action reports that the key is no longer accepted
- **THEN** the view returns to the key step and the "New Document" control is no longer offered

### Requirement: The panel lists the author's documents with their current state
The sidebar view SHALL list every note in the vault whose front matter carries
a `doc_id` and that has a next action, showing each one's name and its current
state's author-facing label. A document has a next action when the author or a
reviewer is expected to act on it. A document that is published, and whose note
has not been edited since it was last sent, has none, and SHALL NOT be listed: a
list of settled documents is reference rather than work. Notes carrying no
`doc_id` SHALL NOT appear in any list.

A document's state label SHALL be shown whenever that document has a derived
state. No marker a row also carries SHALL be displayed in place of that label.
Markers describing the note — that it has been edited since it was last sent —
SHALL be shown alongside the state, not instead of it.

#### Scenario: Documents are listed with their states
- **WHEN** the author opens the sidebar view in a vault holding one document waiting for review, one not accepted and one published, none of them edited since they were last sent
- **THEN** the first two are listed, each showing its own state's label, and the published one is not listed

#### Scenario: A published document that has been edited
- **WHEN** a published document's note has been edited since it was last sent
- **THEN** it is listed, showing the "Published" label and the edited marker

#### Scenario: Notes without a `doc_id` are not listed
- **WHEN** the author opens the sidebar view in a vault holding many notes (received documents, READMEs, new notes), only some of which carry `doc_id`
- **THEN** only notes carrying `doc_id` appear; a new note is submitted from its own "Submit for review" control

#### Scenario: A received document with no identity yet
- **WHEN** a document received by Get updates carries no `doc_id` and the author has edited it
- **THEN** it is not listed, and its "Submit for review" control still works on the open note

#### Scenario: The list is empty before anything has been submitted
- **WHEN** the author opens the sidebar view in a vault where no note carries `doc_id`
- **THEN** the "Needs you" section reads "Nothing submitted yet. Documents you submit will be listed here.", rather than showing an error

#### Scenario: A document that is both under review and locally edited
- **WHEN** a document waiting for review has been edited since it was last sent
- **THEN** its row shows "Waiting for review" AND the edited marker

#### Scenario: A document whose state has not been derived
- **WHEN** a document has been edited and no fetch has completed
- **THEN** its row shows the edited marker and no state label

### Requirement: The panel separates documents by who acts next
The sidebar view SHALL present listed documents in two sections, each named for
who acts next, and every listed document SHALL be in exactly one of them:

- **"Needs you"** SHALL hold every document waiting on the author: not accepted, any document edited since it was last sent, and any document whose state has not been derived.
- **"Waiting on reviewers"** SHALL hold every document waiting for review whose note has not been edited since it was last sent.

A document whose state has not been derived SHALL NOT be placed in "Waiting on
reviewers", since that would assert a review nothing has established.

"Needs you" SHALL come first and hold the Refresh control. "Waiting on
reviewers" SHALL be collapsible, SHALL be collapsed when the view opens, and
SHALL be present whether or not it holds anything. Its heading SHALL report its
count while collapsed, or that the last check failed, so that collapsing it hides
the list and never the count.

Each section SHALL carry a one-line description of what it holds, shown whether
or not it has rows. "Needs you" SHALL read "Documents waiting on you: not
accepted, or changed since you last sent them." "Waiting on reviewers",
when expanded, SHALL read "Sent and unchanged. Nothing to do until a reviewer
responds."

When "Needs you" holds nothing but some note carries `doc_id`, it SHALL read
"Nothing needs you right now." When "Waiting on reviewers" is expanded and holds
nothing, it SHALL read "Nothing is waiting for review right now."

#### Scenario: A vault holding documents in several states
- **WHEN** the author opens the sidebar view in a vault holding one document waiting for review, one not accepted and one published, none of them edited since they were last sent
- **THEN** the not-accepted one is in "Needs you", the waiting one is in "Waiting on reviewers", and the published one is in neither

#### Scenario: A submitted document moves rather than disappears
- **WHEN** the author submits a document and does not edit it afterwards
- **THEN** it is no longer in "Needs you", it is in "Waiting on reviewers", and that section's heading count has gone up by one, without a fetch

#### Scenario: Editing a document under review
- **WHEN** the author edits a document that is in "Waiting on reviewers"
- **THEN** it moves to "Needs you", showing "Waiting for review" and the edited marker

#### Scenario: Sending an update
- **WHEN** the author sends an update for a document that is waiting for review and has been edited
- **THEN** it moves back to "Waiting on reviewers"

#### Scenario: A document whose state has not been derived yet
- **WHEN** a tracked document's state has not been derived because no fetch has completed
- **THEN** it appears in "Needs you", and not in "Waiting on reviewers"

#### Scenario: The section opens collapsed
- **WHEN** the author opens the sidebar view while two documents are waiting for review and untouched
- **THEN** "Waiting on reviewers" shows its heading and a count of 2, and no rows until the author expands it

#### Scenario: A refresh fails
- **WHEN** the last refresh failed and "Waiting on reviewers" is collapsed
- **THEN** its heading reports that the check failed, rather than a count that might be stale

### Requirement: The panel offers Reset for a document with an open review cycle
The sidebar view SHALL offer a Reset action for the currently open note when
that note's derived state is pending, alongside the resubmit action already
offered for it. It SHALL NOT offer Reset for a document in any other state, and
SHALL NOT offer it as a per-row control in either document list.

Because a successful send records the branch in the fetched copy, Reset SHALL be
offered as soon as a send that opened or advanced a review succeeds, with no
fetch in between.

#### Scenario: The open note is awaiting review
- **WHEN** the author has open a note whose derived state is pending
- **THEN** the view offers a Reset action for it alongside the resubmit action

#### Scenario: The open note is published or not accepted
- **WHEN** the author has open a note whose derived state is published or closed
- **THEN** no Reset action is offered

#### Scenario: Reset is never a row control
- **WHEN** either document list is rendered
- **THEN** no row carries a Reset control, whatever that document's state

#### Scenario: Straight after a send
- **WHEN** the author submits the open note and the notice "Waiting for review" appears
- **THEN** without a fetch, the view shows "Waiting for review" for it, the resubmit action reads "Send update", and Reset is offered beside it

#### Scenario: The review ended between the send and Reset
- **WHEN** the author presses Reset on a note derived as pending, and a fetch since has shown its review published and its branch removed
- **THEN** nothing is written to the note and the author is shown "This document's review has already finished, so nothing was reset. Get updates to see where it stands now."

### Requirement: States are refreshed on opening the panel and on request, never on editing
The sidebar view SHALL fetch from the remote when the view is opened and when
the author selects a refresh control, and SHALL NOT start a process or make any
remote request in response to the note being changed, the active note changing,
or the note's metadata changing.

This is normative rather than incidental: the view already re-renders on all
three of those events, so rendering and refreshing must stay separate or every
keystroke touching front matter becomes a process.

#### Scenario: Opening the panel refreshes
- **WHEN** the author opens the sidebar view and setup is complete
- **THEN** one fetch is made and states and the updates count are derived from it

#### Scenario: The author refreshes on request
- **WHEN** the author selects the refresh control
- **THEN** a fetch is made and the list redraws with the result

#### Scenario: Editing a note does not refresh
- **WHEN** the author types in a note, switches to a different note, or edits a note's front matter while the sidebar view is open
- **THEN** the view redraws from the states it already has, and no process is started and no remote request is made

#### Scenario: The edited marker costs no process
- **WHEN** the author edits a note and the view redraws its row
- **THEN** the edited marker is decided by comparing the note's content identifier with the listing already read, and no process is started

### Requirement: A refresh that fails keeps the last known states and says so
When a refresh does not succeed, the sidebar view SHALL continue showing the
states it last derived, SHALL say that the refresh did not succeed, and SHALL
NOT present the states shown as freshly confirmed. It SHALL NOT clear the list.

#### Scenario: A refresh fails while states are already on screen
- **WHEN** a refresh fails and the view is already showing derived states
- **THEN** those states remain on screen and the author is told "Could not check your documents' status just now. They may have changed since this was last updated."

#### Scenario: The key is no longer accepted
- **WHEN** a refresh fails because GitLab no longer recognises the key
- **THEN** the view returns to the key step with "GitLab doesn't recognise this key yet. Add it on GitLab's SSH keys page, then test again."

#### Scenario: The very first refresh fails with nothing to fall back on
- **WHEN** a refresh fails and the view has never derived any state
- **THEN** the author is told the refresh did not succeed and no document is shown with a state that was never established

### Requirement: Each listed document offers a way to open it on the platform
The sidebar view SHALL offer, for each listed document that has been
submitted, a link labelled "Open in GitLab" that opens, in the author's
browser, the project's review list filtered to that document's branch when the
document is waiting for review, or the document's file page on the default
branch when it is published. The link SHALL be derived from the project address
and SHALL cost no request.

#### Scenario: A document waiting for review
- **WHEN** the author selects the link beside a document waiting for review
- **THEN** the project's review list filtered to that document's branch opens in the browser

#### Scenario: A published document
- **WHEN** the author selects the link beside a published document that is listed because it was edited
- **THEN** the document's file page on the default branch opens

#### Scenario: A document with nothing to open
- **WHEN** a listed document's remote path and review cannot be found, so it is closed
- **THEN** no such link is offered for it

### Requirement: A tracked document offers a resubmit action in every state
The sidebar view SHALL offer an action for the currently open document whenever
it is already tracked, matching that document's DERIVED state, rather than
showing only its state label. Selecting the action SHALL resubmit through the
same path as the command palette's "Submit for review" command.

The action and the label SHALL be derived from the same answer.

#### Scenario: A pending document offers to send an update
- **WHEN** the currently open document's derived state is pending
- **THEN** the view shows the state label and an action that sends an update when selected

#### Scenario: A published document offers to open a new review cycle
- **WHEN** the currently open document's derived state is published
- **THEN** the view shows the state label and an action that starts a new review cycle when selected

#### Scenario: A not-accepted document offers to open a new review cycle
- **WHEN** the currently open document's derived state is closed
- **THEN** the view shows the state label and an action that starts a new review cycle when selected

#### Scenario: The command palette and the panel action agree
- **WHEN** the author resubmits the same document once through the panel's action and once through the command palette, in separate sessions with identical starting state
- **THEN** both produce the same outcome

### Requirement: The panel's write actions show when they are working and run one at a time
The plugin SHALL run at most one of its six actions that change the vault or
the remote or that wait on them — Submit (the sequence started by confirming
the submit dialog, under any of its labels), Reset, Get updates, Connect this
vault, Test, and Create key — at a time.

While one is running, the sidebar view SHALL show the control that started it
with a busy label and SHALL NOT let it be pressed:

- Submit: "Sending…", from the moment the author confirms the submit dialog until the outcome is reported. Opening the dialog alone does not start it.
- Reset: "Checking…", from the press until the author has answered the confirmation, or the reset has been refused before one was shown.
- Get updates: "Getting updates…", until the outcome is reported, including while the author answers the summary or a choice.
- Connect this vault: "Connecting…".
- Test: "Testing…".
- Create key: "Creating…".

The busy label SHALL appear only on the control for the action running. Every
other action control SHALL stay visible with its normal label and SHALL NOT be
pressable until the action ends.

An attempt to start any of the six while one is running — including from the
command palette — SHALL start nothing and SHALL show the notice "Still finishing
your last action. Try again in a moment."

A refresh, and the fetch made when the panel opens, SHALL NOT run while one of the
six is running. A refresh the author asked for SHALL show the same notice; the
fetch made on opening SHALL simply be skipped, and the panel SHALL redraw from
what it already has. This keeps the version an update compares against from
changing under it.

The action SHALL count as ended however it ends: success, a refusal, a failure
notice, the author dismissing a dialog, or an unexpected error. The controls
SHALL then return to their normal labels and be pressable again. Which action is
running SHALL be held in memory only.

#### Scenario: Reset shows it is working before its confirmation appears
- **WHEN** the author presses Reset on the open note
- **THEN** the control reads "Checking…" and cannot be pressed until the confirmation appears

#### Scenario: Cancelling the Reset confirmation restores the control
- **WHEN** the author dismisses the Reset confirmation without confirming
- **THEN** nothing is written and the control reads "Reset" and can be pressed again

#### Scenario: A double press on Reset asks once
- **WHEN** the author presses Reset twice in quick succession
- **THEN** exactly one confirmation is shown

#### Scenario: Submit shows it is working after the dialog is confirmed
- **WHEN** the author confirms the submit dialog
- **THEN** the panel's submit control reads "Sending…" and cannot be pressed until the submission's outcome notice appears

#### Scenario: Get updates shows it is working
- **WHEN** the author presses Get updates
- **THEN** the control reads "Getting updates…" and cannot be pressed until the outcome notice appears

#### Scenario: Test shows it is working
- **WHEN** the author presses Test
- **THEN** the control reads "Testing…" and cannot be pressed until the result is shown

#### Scenario: Other controls wait while one action runs
- **WHEN** any of the six actions is running
- **THEN** every other action control in the panel keeps its normal label and cannot be pressed

#### Scenario: The busy label stays with its document
- **WHEN** a submission of one note is running and the author opens a different note
- **THEN** that note's submit control keeps its normal label and cannot be pressed, and no control claims to be sending it

#### Scenario: Refreshing while an update runs
- **WHEN** the author presses Refresh while Get updates is running
- **THEN** no fetch starts and the notice "Still finishing your last action. Try again in a moment." is shown

#### Scenario: Opening the panel while an update runs
- **WHEN** the panel is opened while Get updates is running
- **THEN** no fetch starts, no notice is shown, and the panel draws from what it already has

#### Scenario: Starting a second action is refused with a message
- **WHEN** the author runs "Submit for review" from the command palette while any of the six actions is running
- **THEN** no dialog opens, nothing is sent, and the notice "Still finishing your last action. Try again in a moment." is shown

#### Scenario: A failed action releases the controls
- **WHEN** a running action ends with a failure notice or an unexpected error
- **THEN** every action control returns to its normal label and can be pressed again

#### Scenario: Busy state does not survive a reload
- **WHEN** the plugin is reloaded
- **THEN** no control starts out busy or unpressable

## ADDED Requirements

### Requirement: The panel offers Get updates and says when updates are waiting
When setup is complete, the sidebar view SHALL show a line saying whether
updates are waiting, and a "Get updates" control. The line SHALL distinguish
four cases: updates are waiting ("<n> updates available", or "1 update
available"), there are none ("You have the latest documents."), nothing has been
checked yet ("Not checked yet."), and the check did not succeed ("Could not
check for updates. Try Refresh."). The count SHALL come from the fetch made when
the view opened or when the author refreshed, and SHALL NOT start a fetch of its
own while rendering. Selecting "Get updates" SHALL start the update described by
vault-sync, through the same path as the command palette's "Get updates"
command.

#### Scenario: Updates are waiting
- **WHEN** the author opens the panel and the project holds three changed files the vault has not received
- **THEN** the view shows "3 updates available" and a "Get updates" control

#### Scenario: Nothing is waiting
- **WHEN** a fetch completed and the vault has everything
- **THEN** the view shows "You have the latest documents."

#### Scenario: Not checked yet
- **WHEN** the view is shown before the first fetch has answered
- **THEN** it shows "Not checked yet." and not "You have the latest documents."

#### Scenario: The check failed
- **WHEN** the last fetch failed
- **THEN** it shows "Could not check for updates. Try Refresh." and not "You have the latest documents."

#### Scenario: The command palette and the panel agree
- **WHEN** the author gets updates once from the panel and once from the command palette
- **THEN** both start the same update

## REMOVED Requirements

### Requirement: The panel lists documents available to import
**Reason**: Getting updates brings every document; there is no list to choose from.
**Migration**: "The panel offers Get updates and says when updates are waiting".

### Requirement: The panel offers import per document and for all of them
**Reason**: There is no per-document download; Get updates is the whole project.
**Migration**: "The panel offers Get updates and says when updates are waiting".

### Requirement: Discovery reaches the remote only when asked
**Reason**: There is no discovery list; the one remote read the panel makes is the fetch, governed by "States are refreshed on opening the panel and on request, never on editing".
**Migration**: That requirement.

### Requirement: The panel lists documents whose tracking record has no note
**Reason**: There are no tracking records; a note deleted from the vault is restored by Get updates.
**Migration**: vault-sync, "Getting updates applies the whole project, one direction".

### Requirement: Recovery fetches content only when the author asks for it
**Reason**: There is no recovery action.
**Migration**: vault-sync, "Updates are applied only when the author asks".
