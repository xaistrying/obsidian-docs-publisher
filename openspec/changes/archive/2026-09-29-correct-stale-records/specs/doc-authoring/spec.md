## ADDED Requirements

### Requirement: A submission records the document before writing its front matter
Once a first submission's remote writes have succeeded, the plugin SHALL
persist the document's tracking record BEFORE writing `doc_id`, `title` or
`category` into the note, so that no failure between the two can leave work on
the remote that nothing locally describes.

The ordering is the requirement, not an implementation note. A submission has
two halves, and the remote half is the one that cannot be undone: once a branch
and a merge request exist, the document exists. If the local half then fails
part-way, what matters is which part survived. Recording first means the worst
case is a tracked document whose front matter is incomplete — a state this
capability already knows how to finish, since a note carrying `doc_id` but no
`category` has not been through a first submit in this vault and its next
submit collects and writes both. Recording last means the worst case is a note
with no `doc_id` at all, which no surface can find: the panel lists documents
by `doc_id`, reconciliation matches by `doc_id`, and recovery is offered by
`doc_id`. The document then exists on the remote and nowhere else.

The edit baseline SHALL still describe the note as it stands after the
front-matter write, so recording the document early SHALL NOT record a baseline
taken before that write.

#### Scenario: A first submission completes normally
- **WHEN** a document's first submission succeeds end to end
- **THEN** it is tracked, its front matter carries `doc_id`, `title` and `category`, and its edit baseline describes the note as written

#### Scenario: The front-matter write fails after the remote writes succeeded
- **WHEN** a first submission's branch and merge request are created and the front-matter write then fails
- **THEN** a tracking record for the document already exists, so the document is listed, reconciled and visible to the author rather than existing only on the remote

#### Scenario: A submission that failed part-way is resubmitted
- **WHEN** the author submits a document that was recorded but whose front matter was left incomplete
- **THEN** the submission collects and writes the missing fields rather than refusing, exactly as it does for any note carrying `doc_id` and no `category`

#### Scenario: The remote writes fail
- **WHEN** a first submission's branch, commit or merge request does not succeed
- **THEN** no tracking record is written, because there is nothing on the remote for it to describe
