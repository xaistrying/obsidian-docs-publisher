## ADDED Requirements

### Requirement: Connecting a vault adopts it without touching any file
Connecting SHALL link the vault to the project, fetch the project's default
branch, record an empty version — nothing received yet — as both the vault's last
synced version and its connected version, so that every file the project holds
is waiting to be downloaded, and point the vault's HEAD and index at the fetched
version, without
creating, changing or deleting any file in the vault's working tree. It SHALL
record `.obsidian/` and `.trash/` in the vault's local ignore file (never in a
committed ignore file). Afterwards each file SHALL stand in one of four
relations to the project: identical to the project's copy, different from it,
present only in the vault, or present only on the project. The relations are
facts about files; which notes the panel lists is decided separately and only
for notes that carry a `doc_id`.

Connecting an empty vault SHALL be the same operation with no differences. The
author SHALL be told, on success, "This vault is connected to your project."

#### Scenario: A vault with notes the project does not have
- **WHEN** the author connects a vault holding notes at paths the project does not have
- **THEN** no file changes and those notes have no counterpart on the project

#### Scenario: A note that differs from the project's copy
- **WHEN** the author connects a vault holding a note whose text differs from the project's copy at the same path
- **THEN** the note's text is untouched, and the next update treats it as the author's own change

#### Scenario: A note identical to the project's copy
- **WHEN** the author connects a vault holding a note byte-identical to the project's copy
- **THEN** it is clean and an update leaves it alone

#### Scenario: Documents the vault lacks
- **WHEN** the project has documents at paths the vault has no file for
- **THEN** none is written during connecting, and the panel reports that updates are available

#### Scenario: An empty vault
- **WHEN** the author connects a vault that holds only its own settings folder
- **THEN** connecting succeeds, nothing is written, and the panel reports that updates are available

#### Scenario: Connecting twice
- **WHEN** the author connects a vault that is already connected to this project
- **THEN** nothing changes and the author is told "This vault is connected to your project."

### Requirement: A vault that is already a repository is adopted only when that is safe
When the vault already contains a git repository, the plugin SHALL adopt it only
if all of these hold: the repository's top level is the vault's own folder;
its `origin` equals the configured project address; its current branch is the
project's default branch; and its HEAD is unborn, or is the fetched tip, or is an
ancestor of the fetched tip. In every other case it SHALL refuse and change
nothing in the vault, the repository or its settings.

Adopting SHALL NOT move HEAD or the index. It SHALL record the repository's
current HEAD as the last synced version and as the connected version (or the
fetched tip when HEAD is unborn), so that older notes in the vault are updated by
the next update rather than treated as the author's changes. It SHALL add any
missing line to the local ignore file.

The plugin SHALL also notice when the Obsidian Git plugin is enabled in the
vault and warn once per session without blocking.

#### Scenario: The same project
- **WHEN** the vault is a repository at its own folder whose origin is the configured address, whose branch is the default branch and whose HEAD is an ancestor of the fetched tip
- **THEN** it is adopted, HEAD and the index are unchanged, and the author is told "This vault is connected to your project."

#### Scenario: A different project
- **WHEN** the vault is a repository whose origin is a different address, or has none
- **THEN** nothing is changed and the author is told "This vault is already linked to a different project, so Docs Publisher left it alone. Use a different vault for this project."

#### Scenario: A different version is checked out
- **WHEN** the vault is a repository for this project whose current branch is not the default branch
- **THEN** nothing is changed and the author is told "This vault is already tracking a different version of the project, so Docs Publisher left it alone. Ask whoever set it up to switch it back."

#### Scenario: The vault holds changes that were never sent
- **WHEN** the vault is a repository for this project whose HEAD is not the fetched tip and not an ancestor of it
- **THEN** nothing is changed and the author is told "This vault holds changes that were never sent to GitLab, so Docs Publisher left it alone. Ask whoever set it up to send them first."

#### Scenario: The vault is inside another repository
- **WHEN** the vault's folder is a subfolder of a repository
- **THEN** nothing is changed and the author is told "This vault sits inside a larger project folder, so Docs Publisher left it alone. Use a vault whose own folder is the project."

#### Scenario: Obsidian Git is also enabled
- **WHEN** the Obsidian Git plugin is enabled in the vault
- **THEN** the author is told once per session "The Obsidian Git plugin is also turned on for this vault. It can send changes on its own and clash with Docs Publisher. Turn one of them off.", and connecting is not blocked

#### Scenario: The project uses a hash format the plugin cannot compare
- **WHEN** the project's repository uses SHA-256 object identifiers
- **THEN** connecting is refused with the unexpected-failure message for a setup action and nothing is changed

### Requirement: The plugin never runs a command that writes working-tree files
The plugin SHALL NOT run `checkout`, `switch`, `merge`, `pull`, `rebase`,
`restore`, `stash`, `reset --hard` or `reset --merge`, or any command that writes
files in the vault's working tree. This SHALL be enforced where it cannot be
bypassed: the process runner SHALL accept only an allowlist of subcommands
(git-publishing, "Processes are run without a shell, hermetically, and
bounded"). The only commands that move HEAD or the index SHALL be the mixed reset
performed when connecting a repository the plugin created and at the end of
getting updates. Files in the vault SHALL be written only by the plugin's own
per-file code, through Obsidian's file API for notes.

#### Scenario: After a publish
- **WHEN** the author publishes a document
- **THEN** every file in the vault, the vault's index and HEAD are exactly as they were before

#### Scenario: A forbidden command is requested
- **WHEN** any part of the plugin asks the runner to run `checkout`, `merge`, `pull` or `reset --hard`
- **THEN** the runner refuses it and no process is started

### Requirement: The plugin touches the settings folder and the repository folder only as named here
The plugin SHALL NOT read, write, delete or compare any path under `.obsidian/`
or `.git/` as part of getting updates, connecting or publishing, whatever the
project holds at those paths, with one exception: the repository's own metadata
that connecting and the other operations in this capability write — the origin,
the unborn HEAD's symbolic ref, the local ignore file and the refs under
`refs/docs-publisher/`.

#### Scenario: The project has a settings folder
- **WHEN** the project contains files under `.obsidian/` and the author gets updates
- **THEN** none of them is written to the vault and the author's plugin list, hotkeys and Docs Publisher's own settings are unchanged

#### Scenario: Connecting writes its own metadata
- **WHEN** the vault is connected
- **THEN** the origin, the ignore file and the bookkeeping refs exist, and no other path under `.git/` was written by the plugin itself

### Requirement: Getting updates applies the whole project, one direction
Getting updates SHALL fetch, then apply every difference between the last synced
version and the fetched version of the project, for every file the project holds,
with no filter on file type or folder (except the paths named above). It SHALL
never send anything to the remote. A path that the project removed or moved SHALL
be removed or moved in the vault by the same rules as any other change.

#### Scenario: New documents arrive
- **WHEN** the project has gained documents and images since the last update and the vault has no file at those paths
- **THEN** they are written to the vault at their own paths, with any missing folders created

#### Scenario: Other markdown files arrive too
- **WHEN** the project holds a `README.md` with no front matter
- **THEN** it is written to the vault like any other file

#### Scenario: Nothing is sent
- **WHEN** the author gets updates
- **THEN** no push is made and nothing on the remote changes

#### Scenario: Already up to date
- **WHEN** the author gets updates and the project has not changed since the last update
- **THEN** the author is told "You already have the latest documents." and nothing changes

#### Scenario: The author is told what happened
- **WHEN** an update adds three files, changes two and removes one
- **THEN** the author is told "Got the latest documents: 3 added, 2 updated, 1 removed."

### Requirement: Each changed file is decided by comparing the note, the last synced version and the new version
Getting updates SHALL resolve the fetched default branch to one commit at the
start and use that commit for every comparison and for the final step. For each
path where the last synced version (the base) differs from that commit (theirs),
it SHALL decide by the note's current bytes (mine), comparing exact content
identifiers with no line-ending or other filter, taking the first case that
applies:

1. mine equals theirs (the same bytes, or both absent): do nothing.
2. theirs equals what this vault last sent for that path: do nothing, because it is the author's own change coming back.
3. mine equals the base (the same bytes, or both absent): take theirs — write it, or move the note to the vault's own trash when theirs is absent.
4. mine is absent, the base and theirs are both present and differ: ask "Keep it removed" or "Get it back".
5. mine is present and differs from the base, theirs is absent: ask "Keep mine" or "Remove it".
6. mine and theirs are both present, the base is absent, and they differ: ask with the three choices below.
7. mine, the base and theirs are all present and different and the file is text: merge, or ask where the edits overlap.
8. mine, the base and theirs are all present and different and the file is not text: ask with the three choices below.

After the files are decided, the last synced version SHALL advance to the fetched
commit's tree, except that every path that was skipped keeps its previous entry.
A note the author kept SHALL then read as the author's own change against the new
base, and no conflict state SHALL be stored. HEAD and the index SHALL then be moved
to the fetched commit as a fast-forward.

#### Scenario: The note is unchanged and the project changed it
- **WHEN** the vault's note equals the last synced version and the project has a newer one
- **THEN** the newer version is written to the note

#### Scenario: The note equals the new version already
- **WHEN** the vault's note is byte-identical to the project's new version, for example after the author's own document was approved
- **THEN** nothing is written and the update does not fail

#### Scenario: The author's own merged revision, edited again
- **WHEN** the author sent a revision that was merged unchanged, then edited the note further before getting updates
- **THEN** the project's version equals what the author sent, nothing is written, the further edits stay, and the author is not asked

#### Scenario: The project removed an unchanged note
- **WHEN** the project removed a document the author has not changed
- **THEN** the note is moved to the vault's own trash

#### Scenario: A reorganisation
- **WHEN** a reviewer moved a document to another folder on the project and the author has not changed it
- **THEN** the note disappears from its old folder and appears in the new one

#### Scenario: The author renamed a note the project then changed
- **WHEN** the author renamed or deleted a received note and the project changed it at its old path
- **THEN** the author is asked "Keep it removed" or "Get it back", under "<name> was removed here" and "You removed this document here, but it changed on GitLab."

#### Scenario: The author's version is kept
- **WHEN** the author chooses to keep their note
- **THEN** the note keeps their text, afterwards reads as the author's own change, and is not asked about again

#### Scenario: One path was skipped and the next update repeats it
- **WHEN** an update skips one note and applies the rest, and the author gets updates again after the cause is gone
- **THEN** the skipped note is applied by the second update, and no other file is asked about again

#### Scenario: A skipped note and a later publish
- **WHEN** an update skipped a note the project had changed, and the author then publishes that document without getting updates again
- **THEN** publishing is refused as "Someone changed this document on GitLab since you last got updates. Get updates, then send again."

### Requirement: Edits that do not overlap are merged; edits that overlap ask in plain words
When mine, the base and theirs are all present and different and the file is text,
the plugin SHALL attempt a three-way merge of the text. If it merges without
overlap it SHALL write the merged text and tell the author "Merged your changes
with GitLab's in <name>." If the edits overlap, or the file is not text, or both
sides added the same path with different content, the plugin SHALL ask the
author, never write conflict markers into any file, and never leave the vault in a
half-merged state.

The choices for two changed versions SHALL be "Keep mine", "Use theirs" and
"Keep both", under the title "Two versions of <name>" and the text "You and
someone else both changed this document. Choose which one to keep." For a
removal the choices SHALL be "Keep mine" and "Remove it", under the text "This
document was removed on GitLab, but you changed it here."

"Keep both" SHALL write the project's version beside the note as
`<name> (from GitLab).<extension>` (then `(from GitLab 2)`, `(from GitLab 3)` and
so on when that name is taken) and leave the note unchanged.

#### Scenario: Different paragraphs changed
- **WHEN** the author edited the first paragraph and a reviewer edited the last paragraph
- **THEN** the merged text is written, both changes are present, and the author is told "Merged your changes with GitLab's in <name>."

#### Scenario: The same sentence changed
- **WHEN** the author and a reviewer both changed the same sentence
- **THEN** the author is asked with "Keep mine", "Use theirs" and "Keep both", and the note holds no conflict marker meanwhile

#### Scenario: Keep both
- **WHEN** the author chooses "Keep both"
- **THEN** the note is unchanged and the project's version exists beside it as `<name> (from GitLab).md`

#### Scenario: Keep both a second time
- **WHEN** `<name> (from GitLab).md` already exists and the author chooses "Keep both" again
- **THEN** the new copy is written as `<name> (from GitLab 2).md` and the earlier copy is untouched

#### Scenario: An image changed on both sides
- **WHEN** an image the author replaced was also replaced on the project
- **THEN** the author is asked with the same three choices and no merge is attempted

#### Scenario: Removed on the project, changed here
- **WHEN** the project removed a document the author has changed
- **THEN** the author is asked with "Keep mine" and "Remove it"

#### Scenario: The same new path on both sides
- **WHEN** the author created a note at a path another author has since published a different document at
- **THEN** the author is asked with the three choices

### Requirement: No version of the author's text is destroyed
Before any write that replaces or removes text the author changed — a clean
merge, "Use theirs", "Remove it" — the plugin SHALL copy the author's version to
`.trash/Docs Publisher/<timestamp>/<path>` inside the vault, its own folder, so
recovery does not depend on the vault's "deleted files" setting. Notes the project
removed that the author had not changed SHALL be moved to the vault's own trash
folder, again independent of that setting. A copy that cannot be made SHALL stop
that file's write and be reported as a skipped file.

#### Scenario: Use theirs
- **WHEN** the author chooses "Use theirs"
- **THEN** the project's version is written and the author's earlier text exists in the plugin's own trash folder

#### Scenario: A clean merge
- **WHEN** an automatic merge replaces the note's text
- **THEN** the note's text from before the merge exists in the plugin's own trash folder

#### Scenario: Remove it
- **WHEN** the author chooses "Remove it"
- **THEN** the note is moved out of the vault's notes with the author's changes preserved in the trash folder

#### Scenario: The vault permanently deletes removed files
- **WHEN** the vault's setting for deleted files is "permanently delete" and an update replaces a note the author changed
- **THEN** the copy still exists in the plugin's own trash folder

### Requirement: A file that cannot be applied is skipped and seen again
When a path cannot be written on the author's computer — a name that is not
allowed, a path that is too long, a file the system refuses, a note open in an
editor with unsaved changes, or a copy that could not be made — the plugin SHALL
skip that file, continue with the rest, and tell the author "Couldn't save <path>
on this computer. Everything else was updated." For a note with unsaved changes it
SHALL instead say "<name> has unsaved changes, so it was left as it is. Save it
and get updates again." A skipped path SHALL keep its previous entry in the last
synced version, so the next update decides it again.

#### Scenario: A name Windows does not allow
- **WHEN** the project holds one file whose name the author's system cannot create
- **THEN** every other change is applied and the author is told which path was skipped

#### Scenario: Skipped means still pending
- **WHEN** a path was skipped and the author gets updates again
- **THEN** that path is considered again and nothing else is

### Requirement: The first update after connecting shows a summary and waits
The first time getting updates would change the vault after connecting, the
plugin SHALL show a summary — how many files it would download, how many it
would update, how many need the author's decision — under the title "Get the
latest documents?" and the text "<d> to download, <u> to update, <k> need your
decision. Nothing changes until you confirm.", and SHALL apply nothing until
the author chooses "Get updates". "Cancel" SHALL leave the vault unchanged. "The
first time" SHALL be derived from the vault's own bookkeeping: the last synced
version still being the one connecting recorded.

#### Scenario: Confirming
- **WHEN** the author gets updates for the first time after connecting a vault with 120 files to download and chooses "Get updates"
- **THEN** the files are applied

#### Scenario: Cancelling
- **WHEN** the author chooses "Cancel"
- **THEN** nothing is written and the panel still reports that updates are available

#### Scenario: Later updates do not ask first
- **WHEN** an update has already completed since connecting
- **THEN** the next update applies without the summary

### Requirement: Updates are applied only when the author asks, from one fetched version
The plugin SHALL fetch on opening the panel and on request in order to count
available updates, and SHALL apply updates only when the author chooses Get
updates. It SHALL NOT apply updates in the background and SHALL NOT overwrite a
note without the author's action. While an update is being applied, the plugin
SHALL NOT start a fetch of its own (a refresh, or the one made when the panel
opens), so the version the update compares against cannot change under it.

#### Scenario: Opening the panel
- **WHEN** the author opens the panel and the project has newer content
- **THEN** the panel says how many updates are available and no file in the vault changes

#### Scenario: Refreshing during an update
- **WHEN** the author presses Refresh while an update is running
- **THEN** no fetch starts and the author is told "Still finishing your last action. Try again in a moment."

### Requirement: Names that differ only in case are one file on some computers
On a file system that treats names differing only in letter case as the same file
(detected by probing the vault's file system, not assumed from the platform),
the plugin SHALL decide whether a path is occupied case-insensitively. A path the
project holds that differs from an existing note's path only in case SHALL count
as present in the vault, so the update asks instead of one name replacing the
other.

#### Scenario: The project adds a name that differs only in case
- **WHEN** the vault holds `Docs/a.md` and the project adds `docs/A.md` on a case-insensitive file system
- **THEN** the note `Docs/a.md` is not overwritten, and the author is asked with the three choices

#### Scenario: A case-sensitive file system
- **WHEN** the vault is on a case-sensitive file system
- **THEN** the two names are treated as two files

### Requirement: A failed update says what to do and routes setup problems to the checklist
A failed fetch or update SHALL leave the vault and the last synced version
unchanged. A network failure SHALL tell the author "Could not get updates. Check
your connection and try again." A failure that is a setup problem (key
rejected, key protected, host identity changed, project not found, git missing)
SHALL show the corresponding setup message and return the panel to that step.

#### Scenario: The network is down
- **WHEN** the author gets updates and the server cannot be reached
- **THEN** nothing in the vault changes and the author is told "Could not get updates. Check your connection and try again."

#### Scenario: The key was removed from GitLab
- **WHEN** the author gets updates and the key is no longer accepted
- **THEN** the author is told "GitLab doesn't recognise this key yet. Add it on GitLab's SSH keys page, then test again." and the panel shows the key step

### Requirement: A note open in the editor is updated through Obsidian
When an update writes a note, it SHALL use Obsidian's own file API so that an
open editor shows the new text. A note open in an editor SHALL be treated as
having unsaved changes when the editor's text differs from the file's text on
disk; it SHALL then be left unchanged and reported as a skipped note.

#### Scenario: The note is open and saved
- **WHEN** an update changes a note that is open in the editor with no unsaved changes
- **THEN** the editor shows the new text

#### Scenario: The note has unsaved changes
- **WHEN** an update would change a note that is open and whose editor text differs from the file on disk
- **THEN** it is left unchanged and the author is told "<name> has unsaved changes, so it was left as it is. Save it and get updates again."
