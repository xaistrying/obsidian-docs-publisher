# Submission Tracking Specification

## Purpose

This capability derives a document's state from the local copy of the project and never stores it: whether a review is open (pending), the document is on the default branch (published), or its review ended without being accepted (closed). It matches a note to its document by path and exact content, with a `doc_id` in the note read only as an alias, and works out whether a note has been edited since it was last sent, so the panel can draw without starting a process or reaching the network.

## Requirements
### Requirement: Submission state is derived and never written into the note's front matter
This capability SHALL NOT write any submission-state value into a document's
front matter, and SHALL NOT persist submission state anywhere. A document's
state SHALL be readable only by deriving it from the fetched copy of the
project and the vault's own files, as defined by "A document's state is derived
from the fetched copy".

#### Scenario: A note's front matter carries no submission state
- **WHEN** a document has been submitted and is waiting for review
- **THEN** the note's front matter contains no field describing that state

#### Scenario: Nothing is persisted
- **WHEN** a document is submitted and Obsidian is then restarted
- **THEN** the plugin's data file holds no record of that document, and its state is derived again from the fetched copy

### Requirement: Each submission state has a fixed author-facing label
This capability SHALL define an author-facing label for each submission state it
recognizes. The labels SHALL be: pending is "Waiting for review", published is
"Published", and closed is "Not accepted". No label SHALL use a git-vocabulary
term or an internal state name. There is no "Changes requested" state: it cannot
be derived without the platform's API and was removed on purpose. There is no
"Not submitted yet" state either: a note carries a `doc_id` only after a
successful send, so a note that has one has always been submitted.

#### Scenario: Displaying a pending document's state
- **WHEN** a surface displays the state of a document that is pending
- **THEN** it displays the label "Waiting for review", not the internal state name and not any git-vocabulary term

#### Scenario: Displaying a published document
- **WHEN** a surface displays the state of a document that is published
- **THEN** it displays the label "Published"

#### Scenario: Displaying a document whose review was closed without publishing
- **WHEN** a surface displays the state of a document that is closed
- **THEN** it displays the label "Not accepted", and never "Closed"

### Requirement: Resolving a document's remote path is unaffected by the files it embeds
A document's remote path SHALL be found by its `doc_id`, never from the note's
current path: when its document branch exists, the single markdown file that
branch changed; otherwise the single path on the default branch whose file name
derives that `doc_id` (unique by the project's naming rule); otherwise none, and
more than one candidate counts as none. It SHALL continue to resolve once the
branch also carries the images the document embeds. A branch carrying a document
and its attachments SHALL NOT be treated as one whose path could not be
determined.

This binds the path-mismatch check that refuses a resubmit whose note has moved,
Reset's read of the content under review, and the state derived for a note that
was renamed or moved. All read the same answer. A moved note keeps its state; the
mismatch is reported by the check, not by the note silently reading as a different
document.

#### Scenario: The path-mismatch check still binds for an illustrated document
- **WHEN** a document whose branch carries its note and two images is resubmitted from a note that has been moved to a different folder
- **THEN** the resubmit is refused and the author is told the path to restore, rather than the check being skipped because the path could not be determined

#### Scenario: Reset still works for an illustrated document
- **WHEN** the author resets a document under review whose branch carries its note and an image
- **THEN** the note's content is restored from that branch, rather than the reset failing because the path could not be determined

#### Scenario: A published note that was moved
- **WHEN** the author moves a published note to another folder
- **THEN** the note still derives as published (its path is found by identity on the default branch), and a resubmit is refused with the path to restore rather than a second copy being added

#### Scenario: A pending note that was renamed
- **WHEN** the author renames a note whose review is live
- **THEN** it still derives as pending, and a resubmit is refused with the path to restore

#### Scenario: Two files claim the identity
- **WHEN** more than one path on the default branch has a file name that derives the document's identity and no branch exists
- **THEN** the remote path is none and the document is closed, not guessed

### Requirement: A document under review can have its remote content read from its own branch
This capability SHALL provide a way to read the content a document currently
carries on its own document branch, from the fetched copy, answering three
ways: the content was found, the path is absent on that branch, or the read did
not succeed. It SHALL NOT fall back to the default branch on an absent answer.

A document being reset has a live review by definition, so its branch exists; an
absent answer there means the caller's understanding of the state is stale, not
that the content lives somewhere else. Falling back would substitute content from
a different cycle that the author never asked for.

#### Scenario: The document's content is read from its branch
- **WHEN** the read is performed for a document whose branch holds its file
- **THEN** the caller receives that file's content as it stands on that branch

#### Scenario: The path is absent on the branch
- **WHEN** the read is performed and the document's path does not exist on its branch
- **THEN** the caller receives the absent answer, and no read is attempted against the default branch

#### Scenario: The read does not succeed
- **WHEN** the read fails for any reason other than the path being explicitly absent
- **THEN** the caller receives a read failure, and does NOT receive the absent answer

### Requirement: Only a document with a live review can be reset
This capability SHALL report a document as resettable only when its derived
state is pending. A document that is published or closed SHALL NOT be reported as
resettable, and a document whose state has not been derived SHALL NOT be either.

#### Scenario: A document waiting for review
- **WHEN** a document's derived state is pending
- **THEN** it is reported as resettable

#### Scenario: A document whose cycle is over
- **WHEN** a document's derived state is published or closed
- **THEN** it is not reported as resettable

#### Scenario: A document whose state is unknown
- **WHEN** no fetch has completed
- **THEN** no document is reported as resettable

### Requirement: The edit baseline describes what the document was last sent as
A document SHALL be reported as edited when the note's current bytes equal none
of the versions it can legitimately be at the document's remote path: the last
synced version's, the fetched default branch's, the version this vault last sent
for it, or its document branch's. The comparison SHALL be made by content
identifier, with no line-ending or other filter. A note equal to any one of the
four SHALL NOT be reported as edited: equal to the last synced version means it
has only not yet received someone else's later change, and raising that as the
author's work would list every document others touch; equal to the default
branch means it is published; equal to the last sent or the branch's version
means it is what was sent.

A document with no remote path (nothing is known to compare against) SHALL be
reported as not edited. Absence means nothing has been established, and reporting
an unestablished difference would raise every document at once.

Being edited is a fact about the NOTE and not about the review. It SHALL NOT
change a document's state or its branch.

#### Scenario: A note is submitted and not touched afterwards
- **WHEN** a document is submitted and its note is not edited afterwards
- **THEN** the document is not reported as edited

#### Scenario: A note is edited after being submitted
- **WHEN** the author edits a note after its document was submitted
- **THEN** the document is reported as edited

#### Scenario: A note is reset to the version under review
- **WHEN** a document under review is reset
- **THEN** the document is not reported as edited, because the note now matches its branch

#### Scenario: A document received from the project
- **WHEN** a document arrives by getting updates and its note is not edited afterwards
- **THEN** the document is not reported as edited

#### Scenario: Others changed a published document the note has not yet received
- **WHEN** a note equals the last synced version of a published document and the project's version has since changed
- **THEN** the document is not reported as edited, and it is not listed under "Needs you"

#### Scenario: The author's own revision was merged and the note is then edited
- **WHEN** a revision the author sent is merged unchanged and the author edits the note afterwards
- **THEN** the document is reported as edited, because the note equals none of the four versions

#### Scenario: The note's bytes equal what was pushed
- **WHEN** a first submission succeeds and the note is written back
- **THEN** the note's content identifier equals the pushed file's, and the document is not reported as edited

#### Scenario: A document with no known remote path
- **WHEN** a document's remote path cannot be found
- **THEN** it is reported as not edited

### Requirement: A document's state is derived from the fetched copy
This capability SHALL derive a document's state from the vault's own note and
the fetched copy of the project, for a note carrying a `doc_id`, with `M` the
fetched default branch, `B` the fetched branch `doc/<doc_id>`, and `P` the
document's remote path (found by identity, per "Resolving a document's remote
path is unaffected by the files it embeds"). A review is LIVE when `B` exists and
at least one file `B` changed relative to its merge base with `M` differs from
`M`'s copy of that file, or `M` lacks it. Counting every changed file and not only
the note means a revision that changes only an image is still live, and a branch
left behind after a merge — including a squash merge, whose commits are not
ancestors of `M` but whose files equal `M`'s — is not live.

- A live review: pending.
- Not live, and `M` has a file at `P`: published.
- Not live, and the document has no remote path: closed.
- No fetch has completed: no state, and the document is treated as waiting on the author.

A note carrying no `doc_id` SHALL have no state and SHALL NOT be listed. Nothing is
stored, so the derived state is the only state.

#### Scenario: A document with a live review
- **WHEN** the document branch exists and changed the document's file in a way the default branch does not have
- **THEN** the document is pending

#### Scenario: A revision that changes only an image
- **WHEN** the document branch changed one image, the note itself is identical on the default branch, and the image differs
- **THEN** the document is pending

#### Scenario: A merged document whose branch was left behind
- **WHEN** the document branch still exists but every file it changed is identical on the default branch
- **THEN** the document is published, not pending

#### Scenario: A squash-merged document whose branch was left behind
- **WHEN** the review was merged by squashing and its branch was not removed
- **THEN** the document is published, not pending

#### Scenario: A merged document whose branch was removed
- **WHEN** the document branch no longer exists and the default branch holds the document's path
- **THEN** the document is published

#### Scenario: A review closed without merging and its branch removed
- **WHEN** the document branch no longer exists, the default branch has no file whose name derives the document's identity, and the note carries a `doc_id`
- **THEN** the document is closed

#### Scenario: A second cycle that was not accepted
- **WHEN** a published document's second cycle was closed without merging and its branch removed
- **THEN** the document reads as published, because the first version is still on the default branch, and it is listed because the note differs from it

#### Scenario: A review closed without merging whose branch was left
- **WHEN** a review was closed without merging and nobody removed its branch
- **THEN** the document still reads as pending, which is an accepted limit of deriving state without the platform's API

#### Scenario: Before any fetch
- **WHEN** no fetch has completed in this vault
- **THEN** no document has a state and none is placed under "Waiting on reviewers"

### Requirement: One fetch serves every document
Deriving every document's state SHALL use one fetch and the listings read from
the fetched copy. It SHALL NOT make one request per document, and a derivation
SHALL NOT start a network connection by itself.

#### Scenario: Deriving many documents
- **WHEN** states are derived for a vault holding twenty submitted documents
- **THEN** one fetch is made and all twenty are derived from the fetched copy

#### Scenario: A fetch that cannot complete
- **WHEN** the fetch does not succeed
- **THEN** the states last derived are kept, and the caller is told the refresh failed rather than receiving states derived from partial data

### Requirement: Straight after a successful send the document reads as waiting for review
After a push to a document branch succeeds, the plugin SHALL record the
branch's new tip in the fetched copy itself, so the document is derived as
pending at once without another fetch. A push that fails SHALL change nothing
in the fetched copy.

#### Scenario: A first submission
- **WHEN** the author submits a document for the first time and the push succeeds
- **THEN** the document is derived as pending and Reset is offered, without a fetch

#### Scenario: A new version of a published document
- **WHEN** the author submits a published document again and the push succeeds
- **THEN** the document is derived as pending, without a fetch

#### Scenario: A failed push
- **WHEN** a push fails at any point
- **THEN** the document's derived state is whatever it was before

### Requirement: A note is matched to its document by path and exact content, with doc_id as an alias
The plugin SHALL find the document a note belongs to without requiring a `doc_id` in the
note, in this order: (1) the document at the note's own path on the project, from the
fetched default branch or the last synced version; (2) the document whose send record
from this vault touched the note's path; (3) a document whose version known to this
vault (last synced, default branch, last sent, or its review branch) has the same content
identifier as the note and sits at a path that no longer exists in the vault. A match in
(3) SHALL require exact equality of content identifiers and SHALL NOT use similarity. A
`doc_id` in the note's front matter, valid as a ref part, SHALL take precedence as the
identity and SHALL NOT be rewritten or removed. When two documents match at the same
step, the note SHALL match none and SHALL NOT be listed as either.

#### Scenario: Matched by path
- **WHEN** a note with no `doc_id` sits at a path the fetched default branch holds
- **THEN** its state is derived for that document

#### Scenario: Matched after a move by content
- **WHEN** a note sits at a new path and its content identifier equals the last-sent version of a document whose old path no longer exists in the vault
- **THEN** it resolves to that document, and its state is unchanged by the move

#### Scenario: Ambiguous
- **WHEN** two absent paths hold the same bytes and one note matches both
- **THEN** the note resolves to neither

#### Scenario: A legacy doc_id
- **WHEN** a note carries a valid `doc_id`
- **THEN** it resolves by that identity, and the property is left in the note

### Requirement: The send record remembers the path the review started from
This vault's record of the last send for a document (`sent/<id>`) SHALL identify the
path the note had in that send, readable from the recorded commit itself, so no new
stored state is needed. A note whose path differs from that recorded path while its
bytes equal that send's note SHALL be reported as moved.

#### Scenario: Rename during review
- **WHEN** the author renames a note whose review is open
- **THEN** the panel shows "Waiting for review" and the moved marker, from the recorded commit's path

#### Scenario: Another vault
- **WHEN** a second vault has no send record for the document
- **THEN** it derives state from paths on the project only, and shows no moved marker for a document it never sent
