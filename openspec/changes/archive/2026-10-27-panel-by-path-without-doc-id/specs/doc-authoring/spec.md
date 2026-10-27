## ADDED Requirements

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
