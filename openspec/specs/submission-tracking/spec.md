# Submission Tracking Specification

## Purpose

This capability defines how the plugin tracks a document's review state
locally once it has been submitted: what is persisted, how a record is keyed
so it survives a rename, how that state is reconciled against the remote,
and the author-facing label shown for each state. It does not write into a
document's front matter and does not talk to the remote platform itself.

## Requirements

### Requirement: A submitted document's state is persisted locally, keyed by its frozen identity
This capability SHALL persist one record per submitted document in the
plugin's local data, keyed by that document's `doc_id`. It SHALL NOT key a
record by the document's file path, since a document's path may change after
its first submit while `doc_id` does not. A record created by a successful
submission SHALL also carry that document's remote path as it was at the
moment of that submission, captured going forward from this capability's
recovery support; a record created before this capability existed carries no
such path.

#### Scenario: A record is created on first successful submission
- **WHEN** a document is submitted for the first time and both the remote write and the merge request creation succeed
- **THEN** a record is persisted keyed by that document's `doc_id`, carrying the path the document was submitted at

#### Scenario: Resolving a note to its record after a rename
- **WHEN** the author opens a previously submitted note whose file has since been renamed
- **THEN** the plugin resolves the note's tracking record by reading `doc_id` from the note's own front matter, not by the note's current or original file path

#### Scenario: A record predating this capability carries no path
- **WHEN** a record was persisted before this capability existed
- **THEN** it carries no path, and this capability's recovery support falls back to the merge-request-based path lookup rather than treating the absence as an error

### Requirement: A document whose local note is gone can be recovered when its content is still reachable
This capability SHALL identify, for every persisted record whose `doc_id`
matches no note currently in the vault, whether that document's content can
be located on the remote — either from a path stored in the record itself or
from the single path its still-open merge request's commit touched — and
SHALL NOT report a document as recoverable when neither source yields a
single, unambiguous path.

#### Scenario: A record with a stored path
- **WHEN** an orphaned record carries a stored path
- **THEN** that document is reported as recoverable from that path

#### Scenario: A record with no stored path but an open merge request touching one file
- **WHEN** an orphaned record carries no stored path, and the remote's merge request for its branch is open and its commit changed exactly one file
- **THEN** that document is reported as recoverable from that file's path

#### Scenario: A record with no stored path and no open merge request
- **WHEN** an orphaned record carries no stored path and its branch has no open merge request
- **THEN** that document is reported as NOT recoverable, distinct from a document whose recovery has not yet been attempted

#### Scenario: A record whose merge request touched more than one file
- **WHEN** an orphaned record carries no stored path and its open merge request's commit changed more than one file
- **THEN** that document is reported as NOT recoverable rather than resolved to a guessed path

### Requirement: A recorded submission whose note is gone can be located wherever its content still is
This capability SHALL resolve a stored submission whose note has left the
vault to the place its content can still be read from, trying in turn: the
path the record itself captured, the path its still-open review reports, and
— when neither answers — the document's own file on the default branch,
identified by matching the record's identity against the files the repository
holds.

A document SHALL be reported as unlocatable only when none of those three
answers it. Reporting one unlocatable while its file sits on the default
branch tells the author something false, and told it for every document whose
review had been merged — which is the ordinary end state of a published
document.

The match against the repository SHALL be by the document's identity derived
from each file's name, by the same derivation used when a document is
imported, and SHALL NOT construct a path. Where more than one file derives
the same identity, the capability SHALL decline rather than choose.

A repository listing that reports itself incomplete SHALL NOT be resolved
from: a document missing from a partial listing is indistinguishable from one
that is not there.

#### Scenario: A published document whose review was merged
- **WHEN** a recorded submission's note is gone, its review has been merged, and its file is on the default branch
- **THEN** it is resolved as recoverable from that file

#### Scenario: A record whose document is nowhere
- **WHEN** a recorded submission's note is gone and no file on the default branch is that document
- **THEN** it is reported as unlocatable

#### Scenario: Two files claim the same identity
- **WHEN** more than one file on the default branch derives the identity a recorded submission carries
- **THEN** it is reported as unlocatable rather than resolved to either of them

#### Scenario: Every record carries its own path
- **WHEN** every recorded submission already captured the path it was submitted from
- **THEN** the repository listing is never read

### Requirement: Recovery never guesses at a document's remote path
This capability SHALL treat a document's remote path as either known (from a
stored value or from an unambiguous single-file merge request) or unknown,
and SHALL NOT infer, construct, or approximate a path from a `doc_id` or
from any other value.

#### Scenario: No inference from `doc_id` alone
- **WHEN** a record's path is unknown by the rule above
- **THEN** this capability does not construct a path from that record's `doc_id` or offer one as a fallback

### Requirement: Submission state lives only in plugin data, never in the note's front matter
This capability SHALL NOT write any submission-state value into a document's
front matter. Submission state SHALL be readable only from the plugin's own
persisted data.

#### Scenario: A note's front matter carries no submission state
- **WHEN** a document has been submitted and its tracking record shows a pending state
- **THEN** the note's front matter contains no field describing that state

### Requirement: A pending record reflects a document awaiting first review
A record created by a first successful submission SHALL carry the pending
state, and no other state SHALL be reachable through this capability's first
submission path.

#### Scenario: State immediately after a successful first submission
- **WHEN** a document's first submission completes successfully
- **THEN** its tracking record's state is pending

### Requirement: A document's state is resolved from the remote, not from what was last stored
This capability SHALL determine a document's current state by matching its
frozen `doc_id` against the remote's merge requests, and SHALL treat its own
persisted records as a cache of that answer rather than as the answer. Where
a stored record disagrees with the remote, the remote SHALL win.

#### Scenario: A stored state that the remote has moved past
- **WHEN** a document's stored record says it is awaiting review and the remote shows its merge request has been merged
- **THEN** the document resolves as published, and the stored record is updated to match

#### Scenario: A note with no stored record at all
- **WHEN** a note carrying `doc_id` in its front matter is resolved on a machine whose plugin data holds no record for it
- **THEN** the document's state is resolved from the remote exactly as it would be with a record present, and a record is created from that answer

### Requirement: Reconciliation matches a document by its frozen identity, in a fixed precedence
This capability SHALL reconcile a document by matching `doc/<doc_id>` against
the source branch of the remote's merge requests, considering all states,
most recent first, and SHALL resolve the result in this order:

1. An open merge request wins if one exists.
2. Otherwise the most recent merge request decides: merged resolves as
   published, closed without merging resolves as not accepted.
3. No merge request at all resolves as never submitted.

It SHALL match by `doc_id` read from the note's own front matter, never by
the note's file path and never by a stored record.

#### Scenario: An open merge request takes precedence over older ones
- **WHEN** a document has one open merge request and two older merged ones
- **THEN** it resolves from the open merge request, not from the most recent merged one

#### Scenario: A document whose review was closed without merging
- **WHEN** a document's only merge requests were closed without merging
- **THEN** it resolves as not accepted, and not as never submitted

#### Scenario: A document that has been published and not since revised
- **WHEN** a document's most recent merge request was merged and no open one exists
- **THEN** it resolves as published

#### Scenario: A note whose file has been renamed since it was submitted
- **WHEN** a note carrying `doc_id` is reconciled after its filename has been changed
- **THEN** it resolves through the `doc_id` in its front matter, and the current filename is not used for matching

#### Scenario: A note with no matching merge request
- **WHEN** a note carrying `doc_id` is reconciled and the remote holds no merge request for it
- **THEN** it resolves as never submitted

### Requirement: Reconciliation reads the remote once for all documents
This capability SHALL reconcile every known document against a single
listing of the remote's merge requests, matching locally. It SHALL NOT make
one request per document.

#### Scenario: Reconciling many documents
- **WHEN** reconciliation runs for a vault holding twenty submitted documents
- **THEN** the remote is listed once and all twenty are matched against that one result

#### Scenario: A reconciliation that cannot complete
- **WHEN** the listing does not succeed
- **THEN** no document's stored state is changed, and the caller is told the reconciliation failed rather than receiving states resolved from partial data

### Requirement: An open document with unresolved review threads is in changes-requested
This capability SHALL resolve a document with an open merge request as
changes-requested when that merge request carries unresolved review threads,
and as awaiting review when it does not. Resolving threads SHALL return the
document to awaiting review.

#### Scenario: A reviewer has left an unresolved thread
- **WHEN** a document's open merge request carries at least one unresolved review thread
- **THEN** the document resolves as changes-requested rather than awaiting review

#### Scenario: The reviewer resolves their threads
- **WHEN** every thread on a document's open merge request has been resolved and the merge request is still open
- **THEN** the document resolves as awaiting review again

#### Scenario: An open merge request nobody has commented on
- **WHEN** a document's open merge request carries no review comments
- **THEN** the document resolves as awaiting review

### Requirement: Each submission state has a fixed author-facing label
This capability SHALL define an author-facing label for each submission
state it recognizes. The labels SHALL be: pending is "Waiting for review",
changes-requested is "Changes requested", published is "Published", and
closed is "Not accepted". No label SHALL use a git-vocabulary term or an
internal state name.

The closed state's label was previously "Closed", a placeholder recorded as
provisional while that state was unreachable. It is now reachable and takes
the author vocabulary the project settled on.

#### Scenario: Displaying a pending document's state
- **WHEN** a surface displays the state of a document whose tracking record is pending
- **THEN** it displays the label "Waiting for review", not the internal state name and not any git-vocabulary term

#### Scenario: Displaying a document whose review asked for changes
- **WHEN** a surface displays the state of a document resolved as changes-requested
- **THEN** it displays the label "Changes requested"

#### Scenario: Displaying a published document
- **WHEN** a surface displays the state of a document resolved as published
- **THEN** it displays the label "Published"

#### Scenario: Displaying a document whose review was closed without publishing
- **WHEN** a surface displays the state of a document resolved as closed
- **THEN** it displays the label "Not accepted", and never "Closed"

### Requirement: A single document's state can be resolved without a full reconciliation pass
This capability SHALL provide a way to resolve one document's current state
against the remote, filtered to that document's own tracked branch, without
listing every merge request in the project. It SHALL apply the same state
precedence a full reconciliation pass applies: an open merge request wins if
one exists; otherwise the most recent merge request decides; no merge
request at all resolves as never submitted.

#### Scenario: Resolving one document queries only its own branch
- **WHEN** a single document's state is resolved
- **THEN** the remote is queried filtered to that document's own tracked branch, not listed unfiltered across the whole project

#### Scenario: Single-document resolution agrees with a full reconciliation pass
- **WHEN** a document's state is resolved individually and also resolved as part of a full reconciliation pass in the same moment
- **THEN** both report the same state

#### Scenario: A failed single-document resolution is not read as never-submitted
- **WHEN** the filtered query does not succeed
- **THEN** the caller receives a failure, and the document is not treated as though it had never been submitted

### Requirement: Resolving a document's remote path is unaffected by the files it embeds
Every place this capability resolves a document's remote path from its
merge request SHALL continue to resolve it once that merge request also
carries the images the document embeds. A merge request carrying a document
and its attachments SHALL NOT be treated as one whose path could not be
determined.

This binds three behaviours that already exist: the path-mismatch check
that refuses a resubmit whose note has moved, Reset's read of the content
under review, and recovery's fallback for a record with no stored path. All
three read the same answer, and before this change all three lost it the
moment a merge request carried more than one file.

#### Scenario: The path-mismatch check still binds for an illustrated document
- **WHEN** a document whose merge request carries its note and two images is resubmitted from a note that has been moved to a different folder
- **THEN** the resubmit is refused and the author is told the path to restore, rather than the check being skipped because the path could not be determined

#### Scenario: Reset still works for an illustrated document
- **WHEN** the author resets a document under review whose merge request carries its note and an image
- **THEN** the note's content is restored from the remote, rather than the reset failing because the path could not be determined

#### Scenario: Recovery's fallback still works for an illustrated document
- **WHEN** a record with no stored path is resolved for recovery, and its open merge request carries the document and an image
- **THEN** the document resolves as recoverable at its own path, rather than as unrecoverable

### Requirement: A document under review can have its remote content read from its own branch
This capability SHALL provide a way to read the content a document
currently carries on its own tracked branch, answering three ways: the
content was found, the path is absent on that branch, or the read did not
succeed. It SHALL NOT fall back to the project's default branch on an
absent answer.

The recovery read this mirrors does fall back, because a recovered
document may have been published and had its branch deleted. A document
being reset has an open review cycle by definition, so its branch exists;
an absent answer there means the caller's understanding of the state is
stale, not that the content lives somewhere else. Falling back would
substitute content from a different cycle that the author never asked for.

#### Scenario: The document's content is read from its tracked branch
- **WHEN** the read is performed for a document whose tracked branch holds its file
- **THEN** the caller receives that file's content as it stands on that branch

#### Scenario: The path is absent on the tracked branch
- **WHEN** the read is performed and the document's path does not exist on its tracked branch
- **THEN** the caller receives the absent answer, and no read is attempted against the project's default branch

#### Scenario: The read does not succeed
- **WHEN** the read fails for any reason other than the path being explicitly reported absent
- **THEN** the caller receives a read failure, and does NOT receive the absent answer

### Requirement: Only a document with an open review cycle can be reset
This capability SHALL report a document as resettable only when its
resolved state is pending or changes-requested. A document resolved as
published, not accepted, or never submitted SHALL NOT be reported as
resettable, and a document whose state has not been resolved SHALL NOT be
either.

#### Scenario: A document awaiting review
- **WHEN** a document's resolved state is pending or changes-requested
- **THEN** it is reported as resettable

#### Scenario: A document whose cycle is over
- **WHEN** a document's resolved state is published or not accepted
- **THEN** it is not reported as resettable

#### Scenario: A document whose state is unknown
- **WHEN** a document's state has not been resolved in this session
- **THEN** it is not reported as resettable, rather than assumed to be in an open cycle

### Requirement: Documents the remote has and the vault does not can be resolved
This capability SHALL resolve which documents exist on the remote's default
branch that this vault holds no note for, by comparing remote paths against
the paths of notes in the vault. The comparison SHALL be case-sensitive.

The answer SHALL be built from the vault's own files, never from stored
records. A stored record is not evidence that a file exists, and the question
being asked is precisely which files do not.

#### Scenario: A document only the remote has
- **WHEN** the remote's default branch holds a markdown document at a path no note in the vault occupies
- **THEN** that document is resolved as discoverable

#### Scenario: A document the vault already holds
- **WHEN** the remote's default branch holds a markdown document at a path a note in the vault already occupies
- **THEN** that document is NOT resolved as discoverable

#### Scenario: A document the vault holds at a different path
- **WHEN** the vault holds a note carrying a document's `doc_id` but at a different path from the remote's
- **THEN** the remote document is resolved as discoverable, and the collision is left to the import-time checks rather than being silently hidden

#### Scenario: A document this vault has a record for but no note
- **WHEN** the remote's default branch holds a document whose identity matches a submission this vault recorded, and no note for it remains
- **THEN** it is NOT resolved as discoverable, because it is a document this vault already knows about and has its own way to restore

#### Scenario: The listing was truncated
- **WHEN** the remote listing this resolution is built from reports that it was truncated
- **THEN** the resolution reports that it is incomplete rather than presenting its result as the full set of discoverable documents

### Requirement: A remote file with no front matter is not a discoverable document
This capability SHALL exclude from the discoverable set any markdown file
that carries no YAML front matter block at all.

It SHALL NOT exclude by filename, and SHALL NOT require the full front-matter
contract. Requiring the contract would empty the list against a real corpus,
whose documents carry what their authors wrote rather than what this plugin
writes at creation and first submit.

#### Scenario: A repository README
- **WHEN** the remote holds a `README.md` with no front matter
- **THEN** it is not offered as a discoverable document

#### Scenario: A document carrying partial front matter
- **WHEN** the remote holds a document whose front matter carries `title` and `owner` but neither `doc_id` nor `category` nor `lifecycle`
- **THEN** it IS offered as a discoverable document, since the fields it lacks are the ones this plugin itself writes

#### Scenario: A document named like a placeholder
- **WHEN** the remote holds a file named `_placeholder.md` that carries a front matter block
- **THEN** it is offered, because exclusion is decided by the absence of front matter and never by the filename
