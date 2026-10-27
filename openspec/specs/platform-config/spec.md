# Platform Config Specification

## Purpose

This capability defines how the author sets up the plugin: one project address, an SSH key (use an existing one or create a dedicated one, copy it, and test it), connecting the vault, and a name and email, as a five-step checklist shown in the panel and mirrored in the settings tab. It also holds the Advanced settings the author may change for this vault, and the gate that keeps every other action from running until setup is complete.

## Requirements
### Requirement: The settings tab can be opened from elsewhere in the plugin
The plugin SHALL provide a way for other surfaces to send the author to its
settings tab. When the plugin cannot open the settings tab itself, it SHALL
tell the author how to reach it by hand rather than appearing to do nothing.

#### Scenario: Opening the settings tab from the panel
- **WHEN** the author selects the control that opens settings from the plugin's panel
- **THEN** Obsidian's settings screen opens with this plugin's tab already selected

#### Scenario: The settings tab cannot be opened automatically
- **WHEN** the author selects that control and the plugin is unable to open the settings screen
- **THEN** the author is shown "Open Settings, then choose Docs Publisher under Community plugins." and the control does not silently do nothing

### Requirement: The settings tab has a project address, a key section and an identity section
The plugin SHALL register a settings tab containing, in this order: a single
text input for the project address, a key section, and a name and an email
input, matching the order of the setup steps. The address input SHALL accept the SSH clone address GitLab shows on
its Clone button, and the HTTPS form, which the plugin converts. The tab SHALL
say where to find it: "Paste the SSH address from GitLab's Clone button — it
starts with git@ or ssh://." The tab SHALL show the same five-step progress as
the panel's first screen.

#### Scenario: Opening the settings tab for the first time
- **WHEN** the author opens the plugin's settings tab after enabling the plugin
- **THEN** an empty project address input, a key section, a name and email section and the five-step progress are shown, and no access token input exists anywhere

#### Scenario: The tab says where the address comes from
- **WHEN** the author views the settings tab
- **THEN** it shows "Paste the SSH address from GitLab's Clone button — it starts with git@ or ssh://."

### Requirement: The project address is remembered, and an address that cannot be used is refused
The plugin SHALL save the project address to its own data file when the author
leaves the field or closes the settings tab with an edit not yet saved, as
entered after conversion to the SSH form, and SHALL fill it back in whenever the
settings tab opens, including on a start where the panel has not been opened.
Closing the tab with a field the author never typed in SHALL NOT change the
saved address. An address that does not parse SHALL NOT be saved and SHALL
be reported with "That address isn't one Docs Publisher can use. Paste the SSH
address from GitLab's Clone button — it starts with git@ or ssh://." A numeric
project identifier SHALL be refused the same way. Saving an address SHALL start
no network request.

Once the vault is connected, the address SHALL NOT be changed: an attempt SHALL
be refused with "This vault is connected to <project>. To use a different
project, use a different vault.", where <project> is the project path. The
comparison is of the whole address — host, port and project path — so the same
project path on another server is another project and is refused; the same
project written in another form (`https://…` for `git@…`) is not a change.

#### Scenario: An SSH address
- **WHEN** the author enters `git@gitlab.example.com:docs/kb.git`
- **THEN** it is saved and filled back in after a restart

#### Scenario: An HTTPS address
- **WHEN** the author enters `https://gitlab.example.com/docs/kb`
- **THEN** it is saved as `git@gitlab.example.com:docs/kb.git`

#### Scenario: An address that cannot be used
- **WHEN** the author enters `1234` or `hello`
- **THEN** nothing is saved and the author is told "That address isn't one Docs Publisher can use. Paste the SSH address from GitLab's Clone button — it starts with git@ or ssh://."

#### Scenario: Changing the address under a connected vault
- **WHEN** the vault is connected to `docs/kb` and the author enters another project's address
- **THEN** the old address is kept and the author is told "This vault is connected to docs/kb. To use a different project, use a different vault."

#### Scenario: The same project path on another server
- **WHEN** the vault is connected to `git@gitlab.example.com:docs/kb.git` and the author enters `git@gitlab.other.example.com:docs/kb.git`
- **THEN** the old address is kept and the author is told the vault is connected to `docs/kb`

#### Scenario: An address typed and not yet left
- **WHEN** the author types an address and closes the settings tab with Escape before the field loses focus
- **THEN** the address is saved as if the field had been left

#### Scenario: A restart with the panel closed
- **WHEN** Obsidian starts with a saved address and the author opens the settings tab before ever opening the panel
- **THEN** the address field shows the saved address and the steps are marked as they are

### Requirement: Name and email are read from the effective settings and saved to this vault only
The identity section SHALL show the effective name and email, which come from
this vault's settings when set there and otherwise from the author's
machine-wide settings, with a note saying which: "from this vault" or "from
your computer-wide settings". Saving SHALL write both to this vault's own
settings and SHALL NOT change the machine-wide settings. Saving needs the
vault's repository, which connecting creates, so before the vault is connected
the fields SHALL be shown read-only with "You can change these once this vault
is connected."

The identity step is the last of the five. It is complete when an effective name
and an effective email both exist, whichever scope they came from, so an author
who already has a machine-wide identity never sees it as a step to do.

#### Scenario: Only machine-wide settings exist
- **WHEN** the author's name and email are set only machine-wide
- **THEN** the fields are filled with them, labelled "from your computer-wide settings", and the identity step is complete

#### Scenario: Saving pins the identity to this vault
- **WHEN** the author edits the name and presses Save
- **THEN** this vault's settings hold the new name and the machine-wide settings are unchanged

#### Scenario: Before the vault is connected
- **WHEN** the vault is not connected and the author opens the identity section
- **THEN** the effective values are shown read-only with "You can change these once this vault is connected."

#### Scenario: Nothing is set anywhere
- **WHEN** no name or email exists in any scope
- **THEN** the fields are empty, the identity step is incomplete, and any action that needs it tells the author "Tell us your name and email in the plugin's settings first."

### Requirement: A key can be chosen, created, copied and tested from the settings tab and the panel
The key section SHALL use an existing key if one is present, preferring the
plugin's own `docs-publisher_ed25519`, then `id_ed25519`, then `id_rsa`. When
none exists it SHALL offer "Create key", which makes a dedicated
`docs-publisher_ed25519` and SHALL NOT overwrite any existing file. It SHALL
offer "Copy key" (the public text), "Open GitLab" (the author's SSH keys page,
derived from the address) and "Test". It SHALL say "A key lets GitLab recognise
this computer. It stays on this computer."

#### Scenario: No key exists
- **WHEN** the author has no key and opens the key section
- **THEN** "Create key" is offered, and after it runs the dedicated key exists and "Copy key", "Open GitLab" and "Test" are offered

#### Scenario: An existing key is used
- **WHEN** the author already has an `id_ed25519`
- **THEN** it is used, no new key is created, and "Copy key", "Open GitLab" and "Test" are offered

#### Scenario: A key already exists at the dedicated path
- **WHEN** "Create key" is pressed while a file already exists at the dedicated path
- **THEN** nothing is written and the existing key is used

#### Scenario: A file at the dedicated path that cannot be used
- **WHEN** "Create key" is pressed while a file at the dedicated path cannot be read as a key, or only the public half of it exists
- **THEN** nothing is written, and the author is told "There is already a file named docs-publisher_ed25519 in your .ssh folder that Docs Publisher can't use. Rename or move it, then press Create key again." with only "Create key" offered

### Requirement: Testing the key reports who the key belongs to
"Test" SHALL verify the key and the project address together, record the outcome
as the retained test result, and show it. On success it SHALL show "Your key
works. Connected as <username>." and persist the username. When the key works
but no username could be read it SHALL show "Your key works." and ask for the
username with "Type your GitLab username so new documents can name you as their
owner." While the test runs the control SHALL read "Testing…" and SHALL NOT be
pressable.

#### Scenario: A key GitLab accepts
- **WHEN** the author presses Test with a registered key and a reachable project
- **THEN** the tab shows "Your key works. Connected as <username>." and the key step is complete

#### Scenario: A key GitLab has not been given
- **WHEN** the author presses Test with an unregistered key
- **THEN** the tab shows "GitLab doesn't recognise this key yet. Add it on GitLab's SSH keys page, then test again."

#### Scenario: The key needs a password
- **WHEN** the author presses Test with a key protected by a passphrase
- **THEN** the tab shows "This key is protected by a password, which Docs Publisher can't type for you. Create a new key for Docs Publisher." with a "Create key" control

#### Scenario: A key that cannot be read
- **WHEN** the author presses Test with a key file that `ssh-keygen` cannot read, which is not the same as one with a password
- **THEN** the tab shows "Docs Publisher can't read this key, so it can't use it. Create a new key for Docs Publisher instead." with "Create key" and "Test" controls

#### Scenario: The username could not be read
- **WHEN** the key and project pass but the greeting cannot be read
- **THEN** the tab shows "Your key works." and asks "Type your GitLab username so new documents can name you as their owner.", and the key step stays incomplete until a username is typed

#### Scenario: The username is typed
- **WHEN** the author types a username after a test that could not read one
- **THEN** it is remembered, the key step is complete, and new documents carry it as their owner

#### Scenario: The test runs only when asked
- **WHEN** the author opens the settings tab, opens the panel, or Obsidian starts
- **THEN** no key test is performed until the author presses Test

### Requirement: Setup problems are reported with a message that names what to do next
Every failure in the setup steps SHALL be reported with the message for its
kind, never a status, an exit code or raw output:

- git missing: "Git isn't installed on this computer. Install it, then check again."
- ssh missing: "Docs Publisher couldn't find SSH on this computer. Reinstalling Git usually fixes this."
- key rejected: "GitLab doesn't recognise this key yet. Add it on GitLab's SSH keys page, then test again."
- key protected: "This key is protected by a password, which Docs Publisher can't type for you. Create a new key for Docs Publisher."
- key unreadable: "Docs Publisher can't read this key, so it can't use it. Create a new key for Docs Publisher instead."
- key file in the way: "There is already a file named docs-publisher_ed25519 in your .ssh folder that Docs Publisher can't use. Rename or move it, then press Create key again."
- address rewritten by a git setting: "A setting on this computer sends this address somewhere else, so Docs Publisher stopped. Ask whoever set up Git on this computer to remove it."
- host identity changed: "GitLab's identity has changed since you last connected. Ask your admin before continuing."
- server unreachable: "Could not reach GitLab at that address. Check the address and your connection, then try again."
- project not found: "That project could not be found, or your access does not include it. Check the address in settings."
- empty project: "That project has nothing in it yet. Ask your admin to add a first file."
- anything else: "The check did not succeed. Check your setup and try again."

None of them SHALL send the author to an admin to fix their own key or address,
except where the admin is the only one who can act (host identity, empty
project).

#### Scenario: Git is missing
- **WHEN** the setup check cannot find git
- **THEN** the author is told "Git isn't installed on this computer. Install it, then check again." with "Get Git" and "Check again" controls

#### Scenario: An unexpected failure
- **WHEN** a setup operation fails for an unclassified reason
- **THEN** the author is told "The check did not succeed. Check your setup and try again." and no raw text is shown

### Requirement: Setup is five steps, computed locally and held in one place every surface reads
The plugin SHALL compute setup progress as five steps in this order: git
installed; project address; key tested; vault connected; name and email. Each
step SHALL be decided from local facts only: git runs; the address parses and is
valid; a key file exists, the last key test succeeded for that key and address,
and a username is known; the vault's origin equals the address and a fetch has
completed; an effective name and email exist. The result SHALL be held in memory in one place that the
panel and the settings tab both read, and both SHALL be notified when it
changes, so a step completed on one surface shows on the other.

The result SHALL be recomputed only when the plugin starts (once the workspace
is ready, so it is known whichever surface the author reaches first, the command
palette included), when the panel opens, when the settings tab opens or closes,
when the author presses "Check again", and after a setup action. It SHALL NOT be
recomputed while rendering. Recomputations SHALL NOT overlap: one that is asked
for while another runs SHALL make the running one read again when it finishes,
so the last answer is never older than the last request. Announcing a result
identical to the one already held SHALL NOT redraw any surface, since a redraw
between the press and the release of a control loses the click. A setup-type
failure from any action SHALL mark the matching step incomplete.

Until the first recomputation has finished, nothing is known: the panel SHALL
say "Checking your setup…" instead of showing the empty facts as if they were
the author's, and an action started from the command palette SHALL do nothing
and tell the author "Docs Publisher is still checking your setup. Try again in a
moment."

An action that fails for a reason of its own, one that is not a setup condition,
SHALL end with the author told "The check did not succeed. Check your setup and
try again." and SHALL NOT leave the busy state taken.

#### Scenario: A fresh machine
- **WHEN** the author has git, no address, no key and a machine-wide name and email
- **THEN** step 1 and step 5 are complete, steps 2 to 4 are incomplete, and the panel shows step 2

#### Scenario: A step completed in the settings tab
- **WHEN** the panel is open and the author enters a valid project address in the settings tab
- **THEN** the panel shows step 2 complete and moves to step 3 without being reopened

#### Scenario: Rendering does not recompute
- **WHEN** the panel re-renders because the author switched notes
- **THEN** no process is started

#### Scenario: The panel before the first check
- **WHEN** the panel opens before the first recomputation has finished
- **THEN** it says "Checking your setup…" and does not say that git is missing

#### Scenario: A command before the first check
- **WHEN** the author runs "Submit for review" from the command palette before the first recomputation has finished
- **THEN** nothing is attempted and the author is told "Docs Publisher is still checking your setup. Try again in a moment."

#### Scenario: Two recomputations at once
- **WHEN** the settings tab closes while a recomputation is running, and the author saved a change just before
- **THEN** the result that ends up shown includes the change

#### Scenario: A later failure reopens a step
- **WHEN** a publish fails because the key is no longer accepted
- **THEN** the key step is marked incomplete and the panel shows it

### Requirement: Setup must be complete before any action that needs it
Any action elsewhere in the plugin that needs git, the key or the connected
vault — creating a document, submitting, resetting, getting updates — SHALL
check that the setup steps it depends on are complete before attempting
anything, and when they are not SHALL do nothing and tell the author "Finish the
setup steps in the Docs Publisher panel first." Creating a document, submitting,
resetting and getting updates depend on all five steps; connecting the vault
depends on the first three. This SHALL hold wherever the action is started, the
command palette included.

#### Scenario: An action from the command palette during setup
- **WHEN** the author runs "Submit for review" from the command palette with the key step incomplete
- **THEN** nothing is attempted and the author is told "Finish the setup steps in the Docs Publisher panel first."

### Requirement: Changing the project address or the key discards the previous test result
Changing the project address or the key in use SHALL discard the retained test
result and the username it learned and mark the key step incomplete, so a
verified username is never shown against an address or key it was not verified
against, and a new key never inherits the previous key's owner when the server's
greeting cannot be read. It SHALL NOT start a test.

#### Scenario: A new key is created after a successful test
- **WHEN** the author creates a new key after a successful test
- **THEN** the key step is incomplete and no test is started

### Requirement: The plugin stores no secret
The plugin's data file SHALL hold only the project address, the path of the key
in use, the username, and the key path and address the last successful test
covered. It SHALL NOT hold a password, an access token or any key material. The plugin SHALL NOT read, copy, log or transmit a
private key file. The settings tab SHALL say "Your project address and the
location of your key are remembered. Docs Publisher never stores a password."

#### Scenario: Inspecting the data file
- **WHEN** the data file is read after a successful test
- **THEN** it holds an address, a key path, a username and the tested pair, and nothing else of the author's

#### Scenario: The settings tab says what is remembered
- **WHEN** the author views the settings tab
- **THEN** it shows "Your project address and the location of your key are remembered. Docs Publisher never stores a password."

### Requirement: The plugin's saved settings never stop it starting
The plugin SHALL start whatever its data file holds: a missing, empty, truncated
or unexpected file SHALL start the plugin from defaults with no error notice,
and old keys left by earlier versions SHALL be ignored and SHALL NOT be deleted.
Saving SHALL merge the plugin's own values into what was loaded, never replace
it, so the old keys survive every save and an earlier version can be reinstalled.

#### Scenario: A data file from the previous version
- **WHEN** the plugin loads a data file holding submission records and a remembered connection
- **THEN** it starts from the first unmet setup step, ignores those keys, and leaves them in the file

#### Scenario: A save keeps the old keys
- **WHEN** the plugin saves the project address after loading a data file that also holds submission records
- **THEN** the saved file still holds those records unchanged

#### Scenario: A damaged data file
- **WHEN** the data file is not valid JSON
- **THEN** the plugin starts from defaults and shows no error

### Requirement: Advanced git settings can be set for this vault or returned to default
The settings tab SHALL offer an Advanced section, closed by default, listing a
fixed short list of git settings — `core.editor`, `core.pager` and `color.ui` —
and no others, with each one's value and where it comes from. No setting whose
name contains a word from the author-facing vocabulary ban SHALL ever be listed
(for example `init.defaultBranch`, `merge.*`, `pull.*`). Each row SHALL have a tick: ticked writes
the value into this vault's own settings; unticked removes it from this vault,
so the machine-wide or system value applies. Each row SHALL have "Back to
default", which removes the setting from this vault and shows the value it falls
back to. Machine-wide and system values SHALL be shown read-only and SHALL NOT
be edited. The section SHALL say these settings do not change how documents are
sent or received.

#### Scenario: Ticking a setting
- **WHEN** the author ticks a setting and enters a value
- **THEN** this vault's settings hold it and the machine-wide settings are unchanged

#### Scenario: Back to default
- **WHEN** the author presses "Back to default" on a setting set in this vault
- **THEN** it is removed from this vault and the row shows the value it falls back to

#### Scenario: A value set machine-wide
- **WHEN** a setting exists only machine-wide
- **THEN** its row shows the value read-only, labelled "from your computer-wide settings"

#### Scenario: Only the listed settings appear
- **WHEN** the machine-wide settings also hold `init.defaultBranch` and `merge.ff`
- **THEN** the Advanced section lists neither of them
