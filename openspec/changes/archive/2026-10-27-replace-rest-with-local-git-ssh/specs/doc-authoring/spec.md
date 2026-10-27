## RENAMED Requirements

- FROM: `### Requirement: A document cannot be created without a verified connection`
- TO: `### Requirement: A document cannot be created before setup is complete`

- FROM: `### Requirement: A document cannot be submitted without a verified connection`
- TO: `### Requirement: A document cannot be submitted before setup is complete`

- FROM: `### Requirement: Resubmitting a pending or changes-requested document pushes an update`
- TO: `### Requirement: Resubmitting a document waiting for review pushes an update`

- FROM: `### Requirement: A first submission is refused when its target path already holds a published document`
- TO: `### Requirement: A first submission is refused when its target path holds a document this vault has not received`

## MODIFIED Requirements

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

## ADDED Requirements

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

## REMOVED Requirements

### Requirement: A document cannot be created without Developer access
**Reason**: Roles cannot be read without the platform's API; the role pre-check is lost on purpose (design.md, "What this removes").
**Migration**: The action is attempted and a refused push says "GitLab did not accept this document. Your account may not be allowed to add documents to this project. Ask your admin for Developer access." (creating a note needs no access at all, since it is local).

### Requirement: A document cannot be submitted without Developer access
**Reason**: Same.
**Migration**: "A submit failure is reported as one undifferentiated outcome", the not-allowed message.

### Requirement: A refused first submission offers to recover the document already there
**Reason**: There is no recovery; the refusal now tells the author to get updates, which brings the document.
**Migration**: "A first submission is refused when its target path holds a document this vault has not received".

### Requirement: A recovered document is restored only to its original remote path
**Reason**: There is no recovery action; Get updates writes every file at its own path.
**Migration**: vault-sync, "Getting updates applies the whole project, one direction".

### Requirement: Recovery never overwrites a note already at its target path
**Reason**: Same; the equivalent protection is the per-file rule.
**Migration**: vault-sync, "Each changed file is decided by comparing the note, the last synced version and the new version".

### Requirement: A submission records the document before writing its front matter
**Reason**: There are no records. The remaining risk — front matter not written after a successful push — is covered by completing the submission on the next press.
**Migration**: "Submitting again after an interrupted submit completes the submission", scenario "The front-matter write failed after the push".

### Requirement: A failure while clearing a previous attempt is reported as its own outcome
**Reason**: Clearing is not a separate step; the abandoned branch is replaced in the push itself.
**Migration**: "A submit failure is reported as one undifferentiated outcome".

### Requirement: An attachment already on the remote is updated, not recreated
**Reason**: Files are no longer written with a create/update verb.
**Migration**: "An attachment already on the project is carried as it is in the vault".

### Requirement: An imported document is written at its exact remote path
**Reason**: There is no import; Get updates writes every file at its own path.
**Migration**: vault-sync, "Getting updates applies the whole project, one direction".

### Requirement: Importing freezes the document's identity
**Reason**: There is no import. The identity of a received document is frozen when it is first submitted.
**Migration**: "A note at a path the vault has received is submitted as a revision of that document".

### Requirement: An import is refused rather than colliding with what the vault already has
**Reason**: There is no import; collisions with the vault are resolved by the per-file rule at update time.
**Migration**: vault-sync, "Edits that do not overlap are merged; edits that overlap ask in plain words".

### Requirement: Imported and recovered documents bring their images with them
**Reason**: Get updates brings every file, images included, so no separate fetch is needed.
**Migration**: vault-sync, "Getting updates applies the whole project, one direction".

### Requirement: A submission records the project it submitted to
**Reason**: There are no records; a vault is connected to one project, its origin.
**Migration**: vault-sync, "A vault that is already a repository is adopted only for the same project".
