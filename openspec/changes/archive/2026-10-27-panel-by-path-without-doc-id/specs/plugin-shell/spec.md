## MODIFIED Requirements

### Requirement: The panel lists the author's documents with their current state
The sidebar view SHALL list every note in the vault that is a document, showing each
one's name and its current state's author-facing label. A note is a document when git
establishes it: its path is on the project, a send from this vault touched its path,
or its exact bytes match a version the project or this vault holds at another path
(a move). A `doc_id` in a note's front matter, where one exists, SHALL be read as an
alias for the same identity and SHALL NOT be required.

A document has a next action when the author or a reviewer is expected to act on it.
A document that is published, and whose note has not been edited since it was last
sent, has none, and SHALL NOT be listed: a list of settled documents is reference
rather than work. A note that is not on the project is covered by "The panel lists notes that
have not been sent".

A document's state label SHALL be shown whenever that document has a derived state. No
marker a row also carries SHALL be displayed in place of that label. Markers describing
the note, that it has been edited since it was last sent or that it has been moved,
SHALL be shown alongside the state, not instead of it.

#### Scenario: Documents are listed with their states
- **WHEN** the author opens the sidebar view in a vault holding one document waiting for review, one not accepted and one published, none of them edited since they were last sent
- **THEN** the first two are listed, each showing its own state's label, and the published one is not listed

#### Scenario: A published document that has been edited
- **WHEN** a published document's note has been edited since it was last sent
- **THEN** it is listed, showing the "Published" label and the edited marker

#### Scenario: A document with no identity property
- **WHEN** a note sits at a path the project holds and its front matter carries no `doc_id`
- **THEN** it is recognised as that document, and is listed if it has a next action

#### Scenario: A moved note
- **WHEN** the author moves a published note to another folder without changing it
- **THEN** it is listed once, at its new path, showing the "Published" label and the moved marker, and the old path is not listed

#### Scenario: A document that is both under review and locally edited
- **WHEN** a document waiting for review has been edited since it was last sent
- **THEN** its row shows "Waiting for review" AND the edited marker

#### Scenario: A document whose state has not been derived
- **WHEN** a document has been edited and no fetch has completed
- **THEN** its row shows the edited marker and no state label

## ADDED Requirements

### Requirement: The panel lists notes that have not been sent
The sidebar view SHALL show a collapsible section "Not sent yet" holding every markdown
note that is not on the project and has no send from this vault, whatever its properties,
the way git lists new files. It SHALL be collapsed when the view opens and its heading
SHALL report its count while collapsed. Each row SHALL show the note's name and folder and
a **Submit** control that opens the submit dialog for that note, which asks for a title and
category when the note has none. Hidden folders (names starting with a dot) and the
settings and repository folders SHALL never be listed or counted. Before anything has been
derived the section SHALL list nothing and say so, since "not on the project" cannot yet
be told.

#### Scenario: Notes in a folder the author never sent from
- **WHEN** the vault holds `L1/a.md` and `L2/b.md`, neither on the project, `b.md` with `title` and `category` and `a.md` without
- **THEN** "Not sent yet" lists both, each with its folder and a Submit control, and its heading counts 2

#### Scenario: Submitting from a row
- **WHEN** the author presses Submit on a row
- **THEN** the submit dialog opens for that note, exactly as for the open note, and once the send succeeds the row leaves "Not sent yet"

#### Scenario: Nothing to list
- **WHEN** every note is on the project or has been sent
- **THEN** the section is present and reads "Every note is on the project."

### Requirement: A moved note is shown as moved and is not restored by Get updates
When a path the project holds is absent from the vault and a note elsewhere in the vault
has exactly the bytes the project holds at that path, the panel SHALL show that note
with the moved marker and SHALL NOT count the absent path as an update. Get updates SHALL
NOT restore it. A move that was also edited has no exact match and SHALL be treated as a
deletion plus a new note.

#### Scenario: Pure move
- **WHEN** the author moves a published note without editing it and presses Get updates
- **THEN** no copy is restored at the old path and the panel shows no waiting update for it

#### Scenario: Move and edit
- **WHEN** the author moves a published note and edits it
- **THEN** Get updates restores the original at the old path, and the edited note is listed under "Not sent yet" if it qualifies

### Requirement: The ready screen is a toolbar and groups of single-purpose rows
The ready screen SHALL show, top to bottom: who is connected (initials in an avatar, the
name, and a "Connected" status with a green dot); a banner saying what the project has, in
one of four conditions (latest, updates waiting, check failed, not checked yet); a New
document button beside two icon buttons (Get updates, Refresh), each with a tooltip; a
rule; the open note's row, always, whatever its status and whichever group lists it; then the groups **Changes**,
**New**, **Waiting on reviewers** and **From the project**. Get updates SHALL be outlined,
and never made the primary button, only while an update is waiting. Every group SHALL fold
on a click of its title and show its count as a pill. **Changes** SHALL start open, hold the
documents edited, moved or not accepted, and read "No changes to send." when empty. The
notes never sent SHALL be the separate group **New**. **New**, **Waiting on reviewers** and
**From the project** SHALL start folded. **From the project** SHALL name the files Get
updates would act on (new, changed, removed, deleted here) by name, up to 50, then say how
many more. Every row SHALL show its name and its buttons on one line, then its status with a
coloured dot, then its folder; the full path SHALL be the tooltip of the name. Only the open
note's row SHALL offer Reset.

#### Scenario: Nothing waiting
- **WHEN** the project has nothing the vault lacks
- **THEN** Get updates is not outlined, the banner reads "You have the latest documents.", and "From the project" is present, folded, with a count of 0

#### Scenario: A note the author deleted
- **WHEN** the author deletes a note the project has unchanged
- **THEN** "From the project" counts it and names it as "Deleted here", and Get updates is outlined

#### Scenario: A very large first update
- **WHEN** the project holds 400 files the vault lacks
- **THEN** "From the project" names 50 and says "and 350 more"

#### Scenario: The open note is always shown
- **WHEN** the open note is published and unchanged, or waiting for review, or never sent
- **THEN** a row for it is shown above the groups with its status and the send control, even when the group that lists it is folded

#### Scenario: Folding a group does not move its rows
- **WHEN** the open note is waiting for review and the author folds or opens "Waiting on reviewers"
- **THEN** the row above the groups is unchanged, and the note's row inside the group is only marked as the current one
