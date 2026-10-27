# Doc Authoring Specification

## Purpose

This capability defines how an author creates and submits a document: where a new note is placed and what front matter it carries, how a note is sent for review (a first submission, an update to a review in progress, a new version of a published document, a move), the checks that stop a send before anything is written, how a note is reset to the version under review, and how a document's identity is derived from its file name and kept unique across the project.

## Requirements
### Requirement: An author can create a document from the plugin
The plugin SHALL offer a "New Document" action from two places — a control in
the plugin's panel and an entry in the command palette — and both SHALL take
the same path, so neither can behave differently from the other. The action
SHALL create one note and open it for editing.

#### Scenario: Creating from the panel
- **WHEN** the author selects "New Document" in the plugin's panel
- **THEN** one note is created and opened for editing, with the cursor in the note

#### Scenario: Creating from the command palette
- **WHEN** the author runs the plugin's "New Document" command from the command palette
- **THEN** the same note is created and opened as when the panel control is used

#### Scenario: Creating a second document
- **WHEN** the author creates a document while a document created earlier already exists
- **THEN** a separate new note is created and no existing note is overwritten

### Requirement: A new document is placed where the vault places new notes
The plugin SHALL create the note in the location Obsidian is configured to use
for new notes, rather than imposing a folder of its own. The plugin SHALL NOT
create, require, or assume any particular folder structure.

#### Scenario: The vault places new notes beside the current one
- **WHEN** the vault is configured to create new notes in the same folder as the current file, and the author creates a document while a note in `Smart Buddy POS/Known-errors/` is open
- **THEN** the new note is created in `Smart Buddy POS/Known-errors/`

#### Scenario: The vault places new notes in a fixed folder
- **WHEN** the vault is configured to create new notes in a specific folder and the author creates a document
- **THEN** the new note is created in that folder

### Requirement: The author names the document, not the plugin
The plugin SHALL create the note under a default name and SHALL NOT ask the
author for a name before the note exists. Naming the document is the author's
to do afterwards, by renaming the note as they would any other.

#### Scenario: The note is created without asking for a name
- **WHEN** the author selects "New Document"
- **THEN** the note is created immediately under a default name, with no dialog asking for a name, title, or category first

#### Scenario: The author renames the document
- **WHEN** the author renames the newly created note
- **THEN** the plugin does not object, does not rewrite any front matter, and does not require the note to carry any particular name

### Requirement: The plugin writes only the front matter it can know at creation
The plugin SHALL write exactly four front matter fields into the new note:
`owner`, `created`, `last_reviewed`, and `lifecycle`. It SHALL write them once,
at creation, and SHALL NOT write any of them again for the life of the
document. It SHALL NOT write `title`, `category`, or `doc_id`, which are
completed when the document is first submitted.

#### Scenario: Front matter written at creation
- **WHEN** the author creates a document while connected as an account whose username is `ivan.nguyen`, on a day the vault's clock reports as 2026-08-26
- **THEN** the note's front matter contains `owner: ivan.nguyen`, `created: 2026-08-26`, `last_reviewed: 2026-08-26`, and `lifecycle: active`, and nothing else

#### Scenario: The three deferred fields are absent
- **WHEN** the author creates a document
- **THEN** the note's front matter contains no `title`, no `category`, and no `doc_id`, empty or otherwise

#### Scenario: The author edits a field the plugin wrote
- **WHEN** the author changes `owner` or `last_reviewed` by hand after the document is created
- **THEN** the plugin leaves the new value alone and never restores what it originally wrote

### Requirement: The owner is the connected account's username
The plugin SHALL write the username the last successful key test reported,
exactly as the platform reports it, or the username the author typed when the
test could not read one. It SHALL NOT derive the value from an email address, a
display name, or any other field.

#### Scenario: An account whose username differs from its email
- **WHEN** the author creates a document after a key test that reported the username `inguyen`, for an account whose email is `ivan.nguyen@example.com`
- **THEN** the note's front matter contains `owner: inguyen`

#### Scenario: The test could not read a username
- **WHEN** the author typed the username `inguyen` because the test could not read one, and then creates a document
- **THEN** the note's front matter contains `owner: inguyen`

### Requirement: The dates are written in a fixed, sortable format
The plugin SHALL write `created` and `last_reviewed` as a calendar date in
`YYYY-MM-DD` form, taken from the author's own clock, and SHALL write the same
date into both.

#### Scenario: Both dates match at creation
- **WHEN** the author creates a document
- **THEN** `created` and `last_reviewed` hold the same value, in `YYYY-MM-DD` form

### Requirement: A document cannot be created before setup is complete
The plugin SHALL refuse to create a document unless all five setup steps are
complete, and SHALL tell the author "Finish the setup steps in the Docs
Publisher panel first." No document SHALL be created otherwise. This SHALL hold
wherever the action is started, the command palette included.

#### Scenario: Setup is incomplete
- **WHEN** the author runs the "New Document" command with the key step incomplete
- **THEN** no note is created and the author is told "Finish the setup steps in the Docs Publisher panel first."

#### Scenario: Setup was completed in an earlier session
- **WHEN** the author completed setup in an earlier session, restarts Obsidian and creates a document without testing the key again
- **THEN** the document is created, because the last successful test is remembered

### Requirement: Creating a document makes no request to the platform
The plugin SHALL create a document using only what it already holds locally —
the remembered username and the cached setup progress — and SHALL NOT start a
process or make any request to the platform while creating one.

#### Scenario: Creating a document while the network is unavailable
- **WHEN** setup is complete, the network then becomes unavailable, and the author creates a document
- **THEN** the document is created with its front matter filled in, and no process is started and no request is attempted

### Requirement: An author can submit a document for review
The plugin SHALL offer a "Submit for review" action for the currently open
document. Selecting it SHALL open a modal collecting `title` and `category`
and showing the document's target remote path, before any remote call is
made.

#### Scenario: Opening the submit modal
- **WHEN** the author selects "Submit for review" for the currently open document
- **THEN** a modal opens showing a title field, a category field, and the document's target remote path, and no remote call has yet been made

### Requirement: A document cannot be submitted before setup is complete
The plugin SHALL refuse to open the submit modal unless all five setup steps
are complete, and SHALL tell the author "Finish the setup steps in the Docs
Publisher panel first.", exactly as document creation does. The modal SHALL name
where the document is being sent — the server and the project path — so that an
address changed by hand in the plugin's data file after it was tested cannot send
a document to another server without the author seeing its name.

#### Scenario: Setup is incomplete
- **WHEN** the author selects "Submit for review" with the vault not yet connected
- **THEN** the modal does not open and the author is told "Finish the setup steps in the Docs Publisher panel first."

#### Scenario: The modal says where the document goes
- **WHEN** the author opens the submit modal for a vault whose project is `docs/kb` on `gitlab.example.com`
- **THEN** the modal names `gitlab.example.com` and `docs/kb`

### Requirement: Category is one of nine fixed values
The submit modal's category field SHALL offer exactly the nine values: User
Manual, Operational Manual, Release FAQ, SOP, Runbook, Configuration
Reference, Diagnostic Reference, Known Errors, Safe-Action Boundaries. It
SHALL NOT allow a free-text value or a tenth option.

#### Scenario: Choosing a category
- **WHEN** the author opens the category field in the submit modal
- **THEN** exactly the nine fixed values are offered and no free-text entry is accepted

### Requirement: Submission is blocked until title and category are both present
The plugin SHALL NOT proceed past the submit modal while `title` or
`category` is empty. This SHALL be enforced in the modal itself, not
discovered as a failure after the remote calls begin.

#### Scenario: Attempting to submit with a field empty
- **WHEN** the author has left `title` or `category` empty in the submit modal
- **THEN** the submit control is disabled and no remote call is made

### Requirement: The author sees the document's target remote path before its identity freezes
The submit modal SHALL show the document's resolved target remote path — the
note's current vault path — as a read-only line, visible before the author
confirms submission and before `doc_id` is derived.

#### Scenario: The target path reflects the note's current location
- **WHEN** the author opens the submit modal for a note at `Smart Buddy POS/Known-errors/CEPAS 3 Payments Fail with Error 200.md`
- **THEN** the modal shows that path as the document's target remote path

### Requirement: `doc_id` is derived from the filename at confirm time and validated as ref-legal
When the author confirms the submit modal and the note's front matter does
NOT already carry a `doc_id`, the plugin SHALL derive a candidate `doc_id`
from the note's filename at that moment, ASCII-folding Vietnamese diacritics
and rejecting a filename containing a space, any of `~^:?*[\`, a leading
dot, or a trailing `.lock`. A note whose filename fails this validation
SHALL NOT be submitted.

When the note's front matter DOES already carry a `doc_id`, the plugin SHALL
use that value and SHALL NOT re-derive one from the current filename. A
frozen `doc_id` is the document's identity for the remainder of its life,
and the filename is permitted to drift away from it.

#### Scenario: A ref-legal filename is accepted
- **WHEN** the author confirms the submit modal for a note named `SBT-KE-004_New-Terminal-Setup.md` whose front matter carries no `doc_id`
- **THEN** the candidate `doc_id` is derived from that filename and validation passes

#### Scenario: A filename that is not ref-legal is refused
- **WHEN** the author confirms the submit modal for a note whose filename contains a space and whose front matter carries no `doc_id`
- **THEN** no remote call is made, and the author is told to rename the file before submitting

#### Scenario: A note that already carries a frozen `doc_id`
- **WHEN** the author confirms the submit modal for a note whose front matter carries `doc_id: SBT-KE-001_EG95-mTLS-Socket-Reopen-Error200` and whose filename has since been changed to something else
- **THEN** the submission uses the frozen `doc_id` from front matter, the current filename is not used to derive one, and the frozen value is not overwritten

### Requirement: Submitting again after an interrupted submit completes the submission
When a previous submit attempt left the document's branch on the remote and the
branch's tip is a commit this vault built (it is reachable from the commit the
vault recorded as sent for that document), pressing "Submit for review" again
SHALL complete the submission rather than fail. The author SHALL NOT be
offered a separate recovery action, SHALL NOT be asked what happened, and SHALL
NOT be required to rename the file.

The plugin SHALL fetch before any write and SHALL replace the unfinished branch
in the same push that sends the note's current content, guarded by the tip it
saw, so no step clears the branch separately.

#### Scenario: The submission was interrupted after the content reached the remote
- **WHEN** a previous submit left the document's branch on the remote with a commit this vault built on its tip, and the author selects "Submit for review" again and confirms the modal
- **THEN** the unfinished branch is replaced with the note's current content, a review request is asked for, and the author is shown "Waiting for review"

#### Scenario: The note was edited between the failed attempt and the retry
- **WHEN** the author edits the note after an interrupted submit and then submits again successfully
- **THEN** what reaches the remote is the note's content as of the successful submit, and no content left by the interrupted attempt survives

#### Scenario: The front-matter write failed after the push
- **WHEN** a push succeeded but the note's front matter was not completed, so the note carries no `doc_id`, and the author submits again
- **THEN** the submission completes by the rule above and the front matter is written

#### Scenario: An ordinary first submission is unaffected
- **WHEN** the author submits a document whose derived branch does not exist on the remote
- **THEN** the submission proceeds with nothing replaced, and the author is shown "Waiting for review"

### Requirement: A document already awaiting review is never overwritten
When a FIRST-TIME submission's derived identity already has a branch on the
fetched copy whose tip is not a commit this vault built, the plugin SHALL write
nothing — not to the remote and not to the note's front matter — and SHALL NOT
replace the branch. Whether the vault built the commit is decided by
reachability from the commit the vault recorded as sent, never by an email
address, which changes with the author's identity and machine.

This requirement SHALL NOT apply to a document that already carries a
`doc_id`, nor to a branch whose tip this vault built, which is an interrupted
attempt of its own. A branch the same person pushed from another computer counts
as someone else's here, and is refused rather than overwritten.

#### Scenario: A first submission's derived identity collides with someone else's branch
- **WHEN** a note with no `doc_id` yet is submitted and its derived identity already has a branch on the remote whose tip this vault did not build
- **THEN** nothing is written or replaced anywhere, and the author is told "A document with this file name is already waiting for review. If that's this document, there's nothing more to do. If it's a different one, rename the file and submit again."

#### Scenario: A tracked document's own resubmit is not refused
- **WHEN** a document that already carries a `doc_id` and is waiting for review is resubmitted
- **THEN** this requirement does not apply, and the resubmit proceeds as an update

### Requirement: Resubmitting a document waiting for review pushes an update
When the author resubmits a document whose derived state is pending, the plugin
SHALL build a commit carrying the note's current content on the fetched tip of
that document's existing branch and push it there. It SHALL NOT start a second
review for the same branch.

The author SHALL be told "Your update was sent." The document SHALL remain
pending.

#### Scenario: Resubmitting a pending document
- **WHEN** the author edits and resubmits a document whose derived state is pending
- **THEN** a commit with the note's current content is pushed on top of the existing branch, a reviewer's earlier commits remain on it, and the author is told "Your update was sent."

#### Scenario: The panel still shows it waiting
- **WHEN** an update has been sent
- **THEN** the document is shown as "Waiting for review" and is not edited

### Requirement: Resubmitting a published document opens a new review cycle
When the author resubmits a document whose derived state is published, the
plugin SHALL build a commit on the fetched default branch carrying the note's
current content, push it to that document's branch asking for a review request,
and tell the author "Waiting for review", exactly as for a first submission.

#### Scenario: Resubmitting a published document
- **WHEN** the author edits and resubmits a document whose derived state is published
- **THEN** a commit is built on the fetched default branch, pushed to the document's branch with a review request asked for, and the author is told "Waiting for review"

### Requirement: Resubmitting a document that was not accepted opens a new review cycle
When the author resubmits a document whose derived state is closed, the plugin
SHALL build a commit on the fetched default branch carrying the note's current
content and push it to the document's branch, replacing anything left from the
prior cycle in that one push, asking for a review request. This replacing SHALL
NOT be surfaced to the author as a distinct step or choice.

#### Scenario: Resubmitting a document that was not accepted
- **WHEN** the author edits and resubmits a document whose derived state is closed
- **THEN** a fresh commit is pushed over the prior cycle's branch in one push, a review request is asked for, and the author is told "Waiting for review"

### Requirement: A duplicate `doc_id` across two local notes blocks a resubmit
Before any write, the plugin SHALL refuse a resubmit if another note in the
vault carries the same `doc_id` as the note being submitted, and SHALL
write nothing anywhere. This check SHALL run before the path-mismatch
check below.

#### Scenario: Two local notes share a `doc_id`
- **WHEN** the author resubmits a note whose `doc_id` another note in the vault also carries
- **THEN** the resubmit is refused before any remote call, and nothing is written anywhere

### Requirement: A local path drifted from the remote path blocks a resubmit
Before any write, and after the duplicate-`doc_id` check above finds nothing,
the plugin SHALL refuse a resubmit if the note's current vault path does not
exactly match the path this document occupies on the remote, comparing
case-sensitively, and SHALL name the path to restore rather than following
the move.

#### Scenario: The note has been moved since its last submission
- **WHEN** the author resubmits a note whose current vault path does not match the path this document occupies on the remote
- **THEN** the resubmit is refused before any remote call, the author is told the path to restore, and nothing is written anywhere

#### Scenario: A path differing only in case is treated as a mismatch
- **WHEN** the note's current path differs from the remote path only in letter case
- **THEN** the resubmit is refused, the same as any other path mismatch

### Requirement: A first submission is refused when its target path holds a document this vault has not received
This capability SHALL, before writing anything, refuse a submission for a note
that carries no `doc_id` when the fetched default branch holds a file at that
note's path and the vault's last synced version does not. The author SHALL be
told "A document already exists at this path on GitLab that you haven't
downloaded yet. Get updates first, then try again." It SHALL NOT perform this
check for a note that carries a `doc_id`, nor for a path the vault has already
received.

#### Scenario: Someone published at this path since the last update
- **WHEN** a note with no `doc_id` is submitted and the fetched default branch holds a file at its path that the last synced version does not
- **THEN** nothing is written anywhere and the author is told "A document already exists at this path on GitLab that you haven't downloaded yet. Get updates first, then try again."

#### Scenario: A document's own revision is never checked against itself
- **WHEN** a note that already carries a `doc_id` is submitted again
- **THEN** this check does not run

#### Scenario: A first submission proceeds when the path is free
- **WHEN** a note with no `doc_id` is submitted and the fetched default branch holds no file at its path
- **THEN** this check does not block the submission

#### Scenario: The check cannot be made
- **WHEN** the fetch fails or the fetched copy cannot be read
- **THEN** the submission is refused and nothing is written, rather than proceeding on an assumption that the path is free

### Requirement: Front matter is completed only after the document reaches the remote
The plugin SHALL NOT write `title`, `category`, or `doc_id` into the note's
front matter until the push has succeeded. A push that succeeded without a
review request counts as reaching the remote. On any failure before the push
has succeeded — including a failed fetch, a refusal, and a failed push — the
note's front matter SHALL remain exactly as it was before the submit attempt.

The commit SHALL carry `title`, `category` and `doc_id` in the note's content,
merged in memory, so the remote copy is complete even though the local write
happens afterwards. The local write SHALL then put exactly the committed text
into the note — not re-serialise the front matter — provided the note still holds
what it held when it was read for the submission; otherwise the note is left as
it is. A note that differs from what was pushed by even one byte would read as
edited at once.

#### Scenario: Front matter after a successful submission
- **WHEN** a document's first submission completes successfully with title "CEPAS 3 Payments Fail with Error 200" and category "Diagnostic Reference"
- **THEN** the note's front matter now contains `title: CEPAS 3 Payments Fail with Error 200`, `category: Diagnostic Reference`, and `doc_id` set to the filename that was current at confirm time

#### Scenario: The note equals what was pushed
- **WHEN** a first submission succeeds and the note is written back
- **THEN** the note's bytes are identical to the file pushed, and the document is not reported as edited

#### Scenario: The author kept typing during the push
- **WHEN** the note changed between being read for the submission and the push finishing
- **THEN** the note is left as the author has it, the document reads as edited, and nothing the author typed is overwritten

#### Scenario: Front matter after a failed submission
- **WHEN** a document's first submission attempt fails before its push has succeeded, for any reason
- **THEN** the note's front matter contains none of `title`, `category`, or `doc_id`

#### Scenario: Front matter after a refusal
- **WHEN** the submit is refused because a different person's branch already exists for the document's target
- **THEN** the note's front matter is unchanged, and in particular no `doc_id` is written

#### Scenario: The remote copy carries the front matter
- **WHEN** a first submission succeeds
- **THEN** the content on the document's branch carries `title`, `category` and `doc_id`

### Requirement: A failed check of the target's state stops the submission
When the plugin cannot establish the state of the document's target — the fetch
fails or the fetched copy cannot be read — it SHALL abort the submission before
any write and SHALL NOT proceed as though the target were absent.

Where the failure is a setup problem (the key is no longer accepted, git is
missing, the project is not found), the plugin SHALL show that setup problem's
message and return the panel to its step, and SHALL NOT describe it as a
connection problem: a retry cannot resolve a key GitLab does not accept.

#### Scenario: The fetch fails because the network is down
- **WHEN** the fetch before a submission fails because the server cannot be reached
- **THEN** no write is attempted, the note's front matter is unchanged, and the author is told "Submit didn't go through. Check your connection and submit again."

#### Scenario: The fetch fails because the key is no longer accepted
- **WHEN** the fetch before a submission fails because GitLab does not recognise the key
- **THEN** no write is attempted, the note's front matter is unchanged, the author is told "GitLab doesn't recognise this key yet. Add it on GitLab's SSH keys page, then test again.", and the panel shows the key step

### Requirement: A submit failure is reported as one undifferentiated outcome
For every cause of a submit failure other than those with their own message
below, the plugin SHALL tell the author the same thing and name the same
recovery action: "Submit didn't go through. Check your connection and submit
again." This covers a dropped connection, a timeout and an unexpected response.
It SHALL NOT name a cause and SHALL NOT advise renaming the file: renaming
re-derives a different permanent `doc_id` for the same document, so advising it
as a general remedy makes an interrupted submit unrecoverable.

These causes have their own message, each naming what to do:

- The server's access rules forbid the push: "GitLab did not accept this document. Your account may not be allowed to add documents to this project. Ask your admin for Developer access."
- The branch moved between the fetch and the push: "Someone changed this document on GitLab while you were sending it. Get updates, then send again."
- The push succeeded and no review request was opened: "Your document was sent, but a review request could not be opened automatically. Open GitLab to request a review." with a control "Open to request review".

A setup problem SHALL show its setup message and return the panel to its step.

#### Scenario: The connection drops mid-submission
- **WHEN** the network becomes unavailable after the push has started but before its outcome is known
- **THEN** the author is told "Submit didn't go through. Check your connection and submit again."

#### Scenario: A push is rejected for an unexpected reason
- **WHEN** a push fails with an unclassified result
- **THEN** the author is told the same message as the dropped-connection case, with no attempt to name which occurred

#### Scenario: The account may not write to the project
- **WHEN** the server's rules forbid the push
- **THEN** the author is told "GitLab did not accept this document. Your account may not be allowed to add documents to this project. Ask your admin for Developer access." and nothing on the remote changed

#### Scenario: The branch moved
- **WHEN** the document's branch on the remote no longer holds what the plugin fetched
- **THEN** nothing is overwritten and the author is told "Someone changed this document on GitLab while you were sending it. Get updates, then send again."

#### Scenario: The push succeeded and no review request opened
- **WHEN** the server accepts the push but no review request is created
- **THEN** the author is told "Your document was sent, but a review request could not be opened automatically. Open GitLab to request a review.", is offered "Open to request review", and the document reads "Waiting for review"

### Requirement: A successful submission confirms with the pending state's label
On a successful first submission, the plugin SHALL confirm to the author
using the pending state's author-facing label, as defined by
submission-tracking.

#### Scenario: Confirmation after a successful submission
- **WHEN** a document's first submission completes successfully
- **THEN** the author is shown "Waiting for review"

### Requirement: Reset replaces a note's content with the version under review
The plugin SHALL, on the author's explicit request for a document whose derived
state is pending, replace the open note's entire content with the content that
document currently carries on its own fetched branch. It SHALL write that
content verbatim, including front matter, so the note afterwards matches what
reviewers are looking at byte for byte.

It SHALL NOT change the document's state or its branch, and SHALL NOT re-assert
any front matter field of its own. A reset note SHALL NOT afterwards be reported
as edited, because the note now matches the branch it was last sent as. It SHALL
record the branch tip it brought into the note as this vault's last-sent commit
for the document, so the commits the author has now seen stop counting as someone
else's and a later update is not refused for them.

#### Scenario: A note with local edits is reset
- **WHEN** the author resets a document whose note has been edited since it was last submitted
- **THEN** the note's content is replaced by the content on that document's branch, front matter included, and the note matches that version exactly

#### Scenario: A reviewer's change on the branch is brought in
- **WHEN** a reviewer added a commit to the document's branch and the author resets after the next fetch
- **THEN** the note matches the branch tip, including the reviewer's change

#### Scenario: Sending after a reset is not refused
- **WHEN** the author resets a document, edits the note, and sends an update
- **THEN** the update is sent, because the commits the reset brought in are recorded as seen

#### Scenario: The reset note is not reported as edited
- **WHEN** a document is reset and its note is not edited afterwards
- **THEN** the panel does not report that document as edited

#### Scenario: Editing after a reset
- **WHEN** the author edits a note after resetting it
- **THEN** the panel reports that document as edited again

### Requirement: Reset always asks before overwriting, with no silent path
The plugin SHALL ask the author to confirm before every Reset, naming that
local changes to the note will be replaced by the version under review, and
SHALL provide no setting, option, or code path that performs the overwrite
without that confirmation. The prompt SHALL be dismissible without anything
being written.

This is the condition on which a deliberate, author-triggered Reset is
permitted at all while a document is awaiting review. The rule it is
exempted from exists to prevent silent loss of local edits, so an
unconfirmed Reset would be the exact case that rule forbids.

#### Scenario: The author confirms
- **WHEN** the author requests a Reset and confirms the prompt
- **THEN** the note's content is replaced

#### Scenario: The author dismisses the prompt
- **WHEN** the author requests a Reset and dismisses the prompt without confirming
- **THEN** nothing is written, and the note's content is exactly as it was

#### Scenario: There is no way to skip the prompt
- **WHEN** the plugin's Reset path is inspected
- **THEN** every route to the overwrite passes through the confirmation, and no setting disables it

### Requirement: Reset refuses rather than substituting content from elsewhere
The plugin SHALL refuse a Reset, writing nothing, when the document's
content cannot be read from its own tracked branch — whether the path is
absent there or the read did not succeed — and SHALL tell the author the
reset did not happen. It SHALL NOT fall back to any other source of
content.

#### Scenario: The tracked branch no longer holds the document
- **WHEN** a Reset is requested and the document's path is absent on its tracked branch, because the review ended since the panel last refreshed
- **THEN** the note is left untouched and the author is told the reset did not happen, rather than the note being replaced with content from anywhere else

#### Scenario: The read does not succeed
- **WHEN** a Reset is requested and the content read fails for any reason
- **THEN** the note is left untouched and the author is told the reset did not happen

### Requirement: A submission carries the images the document embeds
The plugin SHALL commit, alongside the note, every image the note embeds,
each at the same path it occupies in the vault relative to the vault root.
This SHALL apply to every write path: a first submission, an update to a
document under review, and a new cycle for a published or not-accepted
document.

#### Scenario: A first submission of a document with images
- **WHEN** the author submits a document whose note embeds two images
- **THEN** the note and both images are committed together, each at its own vault-relative path

#### Scenario: An update to a document under review
- **WHEN** the author sends an update for a document under review whose note embeds an image added since the last submission
- **THEN** the note and the newly embedded image are committed together to that document's existing branch

#### Scenario: A document that embeds nothing
- **WHEN** the author submits a document whose note embeds no images
- **THEN** the note alone is committed, exactly as before

### Requirement: Embeds are resolved through the vault's own resolver
The plugin SHALL resolve an embed written as a wikilink through the vault's
own link resolution, and SHALL NOT determine its location by matching
filenames from the note's text. A wikilink embed names a file, not a
location, and two folders may hold files of the same name.

An embed written as a markdown link SHALL be resolved as a path relative to
the note, and confirmed to exist in the vault before being carried.

#### Scenario: Two images share a filename in different folders
- **WHEN** a note embeds `![[diagram.png]]` as a wikilink, and the vault holds a `diagram.png` in two different folders
- **THEN** the image the vault's own resolver selects for that note is the one committed, not whichever file matched the name first

#### Scenario: A markdown-style embed
- **WHEN** a note embeds an image written as a markdown link with a path
- **THEN** that path is resolved relative to the note and the file it names is committed

### Requirement: An embed that cannot be resolved does not block the submission
The plugin SHALL skip an embed it cannot resolve to a file in the vault,
and SHALL submit the document without it. It SHALL NOT refuse the
submission, and SHALL NOT fail after a partial write.

A broken link in the author's own note is not a reason to stop them
publishing, and refusing would make a typo block a document.

#### Scenario: A note embeds an image that does not exist
- **WHEN** the author submits a document whose note embeds a filename matching no file in the vault
- **THEN** the submission proceeds, carrying the note and any embeds that did resolve, and is not refused

#### Scenario: A note embeds a file outside the vault
- **WHEN** a note's embed resolves to a location outside the vault
- **THEN** that embed is skipped and the submission proceeds

### Requirement: The plugin never deletes a remote attachment
The plugin SHALL NOT delete any attachment from the remote, under any
circumstance, including when a note stops embedding an image or embeds it
from a different path.

#### Scenario: An author removes an image from a note
- **WHEN** the author removes an embed from a note and submits the document again
- **THEN** the image remains on the remote, and the submission neither deletes it nor fails because of it

### Requirement: A note at a path the vault has received is submitted as a revision of that document
When a note carrying no `doc_id` sits at a path the vault's last synced version
holds, the plugin SHALL treat the submission as a revision of that published
document: it SHALL derive the `doc_id` from the filename by the same rule as a
first submission, freeze it in the note, and proceed as for a published
document, building the commit on the fetched default branch. The submit modal
SHALL say "This replaces the published version of this document. Reviewers will
see what changed." The derived identity SHALL still satisfy "A first
submission's identity must be unique across the project".

This is what makes a received document editable and submittable: a received note
that carries no `doc_id` (one published before this plugin, or by hand) is
neither refused as a collision nor treated as new.

#### Scenario: Editing a received document that has no identity yet
- **WHEN** the author edits a document received by Get updates whose front matter carries no `doc_id`, and submits it
- **THEN** the submission is not refused for a path that already exists, the modal said "This replaces the published version of this document. Reviewers will see what changed.", and a new review cycle is opened with `doc_id` frozen from the filename

#### Scenario: A received document's other front matter is untouched
- **WHEN** a received document whose front matter carries `title`, `owner` and `last_reviewed` written by someone else is submitted
- **THEN** those values are preserved exactly and the plugin adds only the fields it completes

### Requirement: A first submission's identity must be unique across the project
Before any write, the plugin SHALL refuse a submission whose derived `doc_id`
would also be derived from any other file in the fetched default branch's tree,
whatever folder that file is in, and SHALL write nothing. The author SHALL be
told "Another document in the project already has this file name, so this one
can't be sent. Rename this file and try again."

A document's identity is its filename and not its path, so two files sharing a
name would share one branch and the second could not be sent (see
`docs/document-naming.md`). A note that already carries a `doc_id` SHALL NOT be
checked, because its uniqueness was established when it was frozen.

#### Scenario: A name another document already uses
- **WHEN** the author submits a note named `README.md` and another file in the project derives the same identity
- **THEN** nothing is written and the author is told "Another document in the project already has this file name, so this one can't be sent. Rename this file and try again."

#### Scenario: A name that is unique
- **WHEN** no other file in the project derives the identity
- **THEN** this check does not block the submission

#### Scenario: A frozen identity is not rechecked
- **WHEN** a note that already carries a `doc_id` is submitted again
- **THEN** this check does not run

### Requirement: A document changed by someone else since the author last saw it is never overwritten
Before any write, for every file a submission carries, the plugin SHALL compare
the file in the fetched default branch with the file in the vault's last synced
version. When they differ, and the vault's note is not the same as the fetched
one, and the fetched one is not the version this vault last sent for that file
(the author's own change, merged), the plugin SHALL write nothing and tell the
author "Someone changed this document on GitLab since you last got updates. Get
updates, then send again."

When the document is waiting for review and the fetched branch holds a commit
that changes one of the files being sent and that this vault did not build and
has not brought in by a reset, the plugin SHALL write nothing and tell the author
"The version under review has changes that aren't in your note. Use Reset to
bring them in, then make your edits again." The text does not say who made them:
the same author on another computer reads the same.

This replaces the per-file staleness identifier the REST path carried, which kept
a publish from silently overwriting a newer version.

#### Scenario: A reviewer merged a change after the author last got updates
- **WHEN** the author edits a published document and the fetched default branch holds a newer version of it than the last synced one
- **THEN** nothing is written and the author is told "Someone changed this document on GitLab since you last got updates. Get updates, then send again."

#### Scenario: The author's note already equals the newer version
- **WHEN** the vault's note is byte-identical to the fetched default branch's file
- **THEN** this check does not block, and there is nothing further to send for that file

#### Scenario: The merged change is the author's own
- **WHEN** the default branch's version equals the version this vault last sent and the author edited the note again
- **THEN** this check does not block, and the update is sent

#### Scenario: Someone committed to the document's branch
- **WHEN** someone else added a commit to a document's branch and the author sends an update from a note written before it
- **THEN** nothing is written and the author is told "The version under review has changes that aren't in your note. Use Reset to bring them in, then make your edits again."

#### Scenario: The author changed their email
- **WHEN** every commit on the branch was built by this vault under an earlier email and the author sends an update
- **THEN** the update is sent, because the check does not compare emails

#### Scenario: A shared image changed on the project
- **WHEN** a submission carries an image whose copy on the fetched default branch differs from the last synced version and from the vault's
- **THEN** nothing is written and the author is told "Someone changed this document on GitLab since you last got updates. Get updates, then send again."

### Requirement: An identity read from a note is checked before it is used
Before building a branch name from a note's `doc_id`, the plugin SHALL check that
the value is valid in a branch name by the same rule as a first submission, and
SHALL refuse, writing nothing, when it is not. The author SHALL be told "This
note's identity isn't valid, so it can't be sent. Remove the doc_id line from the
note's properties and submit again." A received note's `doc_id` is data from
another person and is not trusted as already valid.

#### Scenario: A received note with an unusable identity
- **WHEN** a note received from the project carries a `doc_id` containing a space or `..`, and the author submits it
- **THEN** nothing is written or sent and the author is told "This note's identity isn't valid, so it can't be sent. Remove the doc_id line from the note's properties and submit again."

#### Scenario: A valid identity
- **WHEN** the note's `doc_id` is valid in a branch name
- **THEN** this check does not block the submission

### Requirement: An attachment already on the project is carried as it is in the vault
For each file a submission carries, the plugin SHALL commit the vault's bytes at
that path whether or not the path already exists on the project: a file that is
byte-identical to the project's changes nothing, and a different one replaces it
in the new commit, subject to "A document changed by someone else since the
author last saw it is never overwritten". The plugin SHALL NOT choose between
creating and updating.

#### Scenario: An image shared with other documents
- **WHEN** the author submits a document embedding an image whose path already exists on the project, byte-identical to the vault's
- **THEN** the image is carried unchanged and the review shows no difference for it

#### Scenario: An image nobody has published before
- **WHEN** the author submits a document embedding an image whose path does not exist on the project
- **THEN** the image is added by the commit

### Requirement: Submitting does not write a doc_id into the note
A successful submit SHALL NOT add a `doc_id` property to the note. It SHALL still
complete `title`, `category` and `owner` as it does now. The identity for a first
submission SHALL be derived from the file name by the existing rule, checked for
validity and for uniqueness across the project, and used for the branch and this vault's
send record. A note that already carries a `doc_id` keeps it untouched. This replaces
the freezing of identity into the note described by the earlier requirements "A note at
a path the vault has received is submitted as a revision of that document" and "An
identity read from a note is checked before it is used"; their other behaviour stands.

#### Scenario: First submission
- **WHEN** the author submits a note with `title` and `category` and no `doc_id`
- **THEN** the note afterwards has no `doc_id` added, the send is made on `doc/<id>` derived from its file name, and the panel lists it as "Waiting for review"

#### Scenario: Re-submitting after the send record is lost
- **WHEN** the author submits an already published note on a vault that has no send record
- **THEN** the identity is re-derived from the file name, and if it equals the identity of the document at that path the submission is a revision of it

### Requirement: A rename during review continues the same branch
When a note resolves to a document whose review is open and its path differs from the
path in the send record, a submit SHALL continue the document's existing branch and SHALL
NOT derive a new identity from the new file name. It SHALL be treated as a move.

#### Scenario: Renamed then edited
- **WHEN** a note under review is renamed and then edited, and its bytes still equal none of the known versions
- **THEN** it is not matched by content and is listed under "Not sent yet"; submitting it is a first submission, refused if a review for the same derived identity exists, with the existing message

### Requirement: Submitting a moved published note moves it on the project after confirmation
When a note resolves to a published document and its path differs from the document's path
on the project, a submit SHALL ask in plain words, "This note has moved. Submitting will
move it on the project too, so reviewers see it in its new place.", and only on
confirmation SHALL build a commit that adds the new path and removes the old one. This
is the only case in which a submit removes a file from the project. Declining SHALL send
nothing and change nothing. Files the note embeds are carried as before and never removed.

#### Scenario: Confirmed move
- **WHEN** the author submits a moved published note and confirms
- **THEN** one review is opened whose changes show the old path removed and the new path added

#### Scenario: Declined
- **WHEN** the author declines
- **THEN** nothing is sent, nothing is written, and the note remains listed as moved

#### Scenario: A move onto a path the project holds
- **WHEN** the new path already holds a different document on the project
- **THEN** the submission is refused with the existing "already exists at this path" message and nothing is sent
