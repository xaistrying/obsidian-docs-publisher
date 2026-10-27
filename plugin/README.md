# Docs Publisher — user guide

Docs Publisher lets you write documents in Obsidian and send them for review
without leaving Obsidian. You write, you press a button, a reviewer reads it,
and it is published. This guide takes about ten minutes to read.

Sections 1–8 are for authors. Section 9 is for the admin or reviewer who sets
authors up.

- [1. Install the plugin](#1-install-the-plugin)
- [2. Set up: five steps, shown in the panel](#2-set-up-five-steps-shown-in-the-panel)
- [3. Write and send a document](#3-write-and-send-a-document)
- [4. What each status means, and what to do next](#4-what-each-status-means-and-what-to-do-next)
- [5. Sending changes, and starting again](#5-sending-changes-and-starting-again)
- [6. Get updates](#6-get-updates)
- [7. Troubleshooting](#7-troubleshooting)
- [8. Filename rules](#8-filename-rules)
- [9. For admins and reviewers](#9-for-admins-and-reviewers)

---

## 1. Install the plugin

You need Obsidian **1.5.7 or newer** on a **computer** (Windows, macOS or
Linux). The plugin does not work on phones or tablets.

You also need **Git** installed on your computer. If you do not have it, the
panel tells you, with a **Get Git** button that opens the download page. Install
it with its default choices, then press **Check again** in the panel.

1. Download these three files from the release page: <RELEASE_URL>
   - `main.js`
   - `manifest.json`
   - `styles.css`
2. In your vault, create the folder
   `<vault>/.obsidian/plugins/obsidian-docs-publisher/` and put the three
   files in it. (`.obsidian` is a hidden folder. If you cannot see it, turn on
   "show hidden files" in your file browser.)
3. In Obsidian, open **Settings → Community plugins** and turn community
   plugins on if they are off.
4. Under **Installed plugins**, switch on **Docs Publisher**. If it is not
   listed, restart Obsidian.
5. Open the plugin's panel with the ribbon icon **Open Docs Publisher**, or
   run **Open Docs Publisher** from the command palette.

To update later, replace the three files with the new ones. Do not delete the
folder — it also holds your settings (see section 9), so you will not have to
set up again.

## 2. Set up: five steps, shown in the panel

The first time, the panel shows **Set up Docs Publisher** and takes you through
five steps, one at a time. It always shows the first step that is not done,
and the same steps are listed in **Settings → Docs Publisher**. You do this once.

There is no password or token to keep. The plugin uses a **key** instead: a pair
of files on your computer that lets GitLab recognise it. The private half never
leaves your computer, and the plugin never reads it.

**Step 1 — Git installed.** If it is not, see section 1.

**Step 2 — Add your project's address.** In GitLab, open your project, press the
**Clone** button, and copy the address under **Clone with SSH**. It starts with
`git@` or `ssh://`. Open **Settings → Docs Publisher** (the panel has an
**Open settings** button) and paste it into the address field, then click
anywhere else. If you paste an address that starts with `https://`, the plugin
converts it for you. Ask your team lead if you do not know which project to use.

**Step 3 — Connect this computer to GitLab.**

1. If you already have a key, the plugin finds and uses it. If not, press
   **Create key**. This makes a key just for Docs Publisher.
2. Press **Copy key**, then **Open GitLab**. GitLab opens on your **SSH keys**
   page. Paste the key, give it a name you will recognise, and add it.
3. Back in Obsidian, press **Test**. You see "Your key works. Connected as
   *your username*." If the plugin could not read your username, it asks you to
   type it once.

If your key is protected by a password, the plugin says so and offers to create
a new key for Docs Publisher: it cannot type a password for you.

**Step 4 — Connect this vault to the project.** Press **Connect this vault**.
Nothing in your vault is changed or replaced: your notes stay exactly as they
are. You see "This vault is connected to your project."

> If the vault is already linked to a different project, or holds changes that
> were never sent, or sits inside a larger project folder, the plugin leaves it
> alone and says so. Use a different vault for this project.

**Step 5 — Tell us who you are.** Your name and email appear on the documents
you send. If Git on your computer already has them, this step is already done.
Otherwise open **Settings → Docs Publisher**, type them, and press **Save**. They
are saved for this vault only.

When all five are done the panel says **Ready to publish your documentation.**
and shows **New Document**.

**What is remembered.** The project address, where your key is stored on your
computer, your username, and what the last test covered. Nothing secret.

## 3. Write and send a document

### Create the document

1. Press **New Document** in the panel (or run **New Document** from the
   command palette).
2. A note named **Untitled document** opens. The plugin has filled in its
   properties for you: `owner` (your GitLab username), `created` and
   `last_reviewed` (today's date), and `lifecycle: active`.
3. **Rename the note** before you send it. The default name has a space in it,
   and a document's filename may not contain spaces (see
   [Filename rules](#8-filename-rules)). Follow your team's naming convention,
   for example `BOA-SOP-001_Update-Device-Details`.
4. **Put the note in the right folder now.** Your vault's folders are the
   project's folders: where the note sits is exactly where it will be
   published.
5. Write the document. Images you embed in the note are sent with it.

### Send it for review

1. With the note open, press **Submit for review** in the panel (or run
   **Submit for review** from the command palette).
2. Fill in the form:
   - **Title** — the document's title.
   - **Category** — choose one of: User Manual, Operational Manual, Release
     FAQ, SOP, Runbook, Configuration Reference, Diagnostic Reference, Known
     Errors, Safe-Action Boundaries.
   - **Target path** — where the document will be published. **Check it.** If
     it is wrong, close the form, move the note to the right folder, and
     start again.
   - **Sending to** — the server and project it goes to.
3. Press **Submit**. You see **Waiting for review**.

> **You can move or rename a note after sending it.** The plugin recognises it
> by where it sits on the project, by the send it made, or, if you moved it
> without changing it, by its exact contents. A moved note shows **Moved**
> beside its status. Press **Submit** and the plugin asks "This note has moved.
> Submitting will move it on the project too, so reviewers see it in its new
> place." Choose **Move and submit** and the review shows the old path removed
> and the new one added; choose **Cancel** and nothing is sent. This is the only
> time a send removes anything from the project. If you moved the note **and**
> edited it before sending, the plugin cannot tell it from a new note, so it is
> listed under **Not sent yet**; move it back, send it, then move it.

The plugin adds `title` and `category` to the note's properties on the send, if
they are missing. It adds nothing else: there is no document ID in your note.
From then on the properties are yours: to change the title or category later,
edit them in the note's properties. The plugin never changes them again. Update
`last_reviewed` yourself whenever you re-read a document and confirm it is
still correct. (A note an older version of the plugin sent may carry a `doc_id`
property. It is left exactly as it is and is read as the same document.)

**If the review request could not be opened automatically** you see "Your
document was sent, but a review request could not be opened automatically. Open
GitLab to request a review." with **Open to request review**. The document did
arrive; press the button and GitLab opens on the page that asks for the review.

## 4. What each status means, and what to do next

At the top of the panel are your initials and name with a green "Connected"
dot, then a banner that says what the project has ("You have the latest
documents.", "3 updates available", or that the check failed). Under it, a
**New document** button and two icon buttons (hover for their names): **Get
updates**, outlined while something is waiting, and **Refresh**, which only
checks.

Under a rule, your notes are sorted into groups. Click a group's title to fold
or open it; its number is shown beside it. Each row shows the note's name and
buttons on the first line, then its status with a coloured dot (orange while it
waits on someone, green when done, red when it needs fixing, blue when moved),
then its folder; hover the name for its full path.

- **Changes** — documents you sent that now need you: not accepted, or edited
  or moved since you last sent them. Each has an upload button to send it. When
  there are none it says "No changes to send."
- **New** — every note that is not on the project yet, the way git lists new
  files, each with an upload button. A note with no title or category is listed
  too, and Submit asks for them. Starts folded, with its number. Hidden folders
  and Obsidian's own folders are never listed.
- **Waiting on reviewers** — sent and unchanged. Nothing to do until a reviewer
  responds. Starts folded; its number shows how many documents are in it.
- **From the project** — the files **Get updates** would bring in: new,
  changed, removed, or deleted here (a note you deleted comes back). Starts
  folded; only the first 50 are named.

The note you have open always has a row of its own above the groups, with its
status and the send button, whichever group lists it and whether or not that
group is folded; it is the only row that offers **Reset**. Inside its group the
same note is marked with a thin bar. Published documents you have not changed
or moved are listed nowhere else.

| Status | What it means | What to do |
|---|---|---|
| **Waiting for review** | A reviewer has it. | Nothing. If you edit it meanwhile, press **Send update**. |
| **Published** | It is live. | Nothing. To revise it, see section 5. Published documents you have not changed are not listed; open the note to see its status. |
| **Not accepted** | The reviewer closed it without publishing. | Make the changes asked for and press **Submit again**. Use **Open in GitLab** on its row to read why. |

Other markers:

- **Unsent edits** — you changed the note since you last sent it. It is shown
  beside the status, not instead of it. Press **Send update** (or **Submit a
  new version**) when you are ready.
- **Moved** — the note is not where the document is on the project: you moved
  or renamed it. It is shown beside the status. Press **Submit** to move the
  document there too (see section 3). **Get updates** does not bring the old
  copy back while the moved note is in your vault unchanged.
- **No status at all** — the plugin has not checked this document yet, or the
  check failed. Press **Refresh**.

**Open in GitLab** on a row opens the review while the document is waiting,
and the document's page once it is published.

**Refresh.** The panel checks for changes when it opens and when you press
**Refresh** — never on its own, and never while you type. While it works, the
button reads **Checking…**. If a check fails, the panel keeps the last known
statuses and says "Could not check your documents' status just now. They may
have changed since this was last updated."

Under the list the panel says how many updates are waiting: "You have the
latest documents." or, for example, "3 updates available". See section 6.

## 5. Sending changes, and starting again

**Send update** (Waiting for review). Sends your latest version to the same
review, on top of anything a reviewer added. You see "Your update was sent."

**Revising a published document.** Open the note, make your changes, and press
**Submit a new version**. A new review starts and the status becomes **Waiting
for review**.

**Resubmitting after Not accepted.** Make the changes the reviewer asked for,
then press **Submit again**. A new review starts.

**If a reviewer changed the document.** A reviewer can add their own edits to a
document under review. If they did, the next **Send update** is stopped with
"The version under review has changes that aren't in your note. Use Reset to
bring them in, then make your edits again." Nothing is sent and nothing is lost.

**Reset** throws away your changes to a document under review and brings in the
version the reviewers have. It is a button beside **Send update**, shown with
the note open and only while the document is Waiting for review. Pressing it
asks first: "Reset this document? … will be replaced with the version currently
under review. Anything you have changed in this note since you last sent it will
be lost." Press **Cancel** to keep your note, or **Reset** to replace it. When
done you see "This note now matches the version under review." After a Reset
you can edit the note and send an update as normal.

If the review has finished since you last looked, Reset does nothing and says
"This document's review has already finished, so nothing was reset. Get updates
to see where it stands now."

## 6. Get updates

**Get updates** brings the whole project's documents into your vault: new
documents are added, and documents someone else changed are updated. It only
ever brings changes **down**; it never sends anything.

Before it changes anything, the first time it shows a summary: "*N* to
download, *N* to update, *N* need your decision. Nothing changes until you
confirm."

- A document you have not touched is simply updated.
- A document you changed and nobody else did is left alone.
- A document you **and** someone else changed in different places is combined,
  and you see "Merged your changes with GitLab's in *name*."
- A document you and someone else changed in the **same** place asks you, in
  plain words: "You and someone else both changed this document. Choose which
  one to keep." You pick **Keep mine**, **Use theirs** or **Keep both** (which
  saves the other version beside it). Nothing you wrote is deleted without your
  choice.
- If you removed a document that someone else then changed (or the other way
  round), you are asked: **Remove it**, **Keep it removed**, **Get it back**.
- A note with unsaved changes in the editor is left as it is, and you are told
  to save it and get updates again.
- If one file cannot be saved on your computer, the rest are still updated, and
  you are told which one.

You see "You already have the latest documents." when there is nothing to get,
or "Got the latest documents: *N* added, *N* updated, *N* removed." afterwards.

## 7. Troubleshooting

| You see | What it means | What to do |
|---|---|---|
| "Git isn't installed on this computer. Install it, then check again." | Git is missing. | Section 1. |
| "That address isn't one Docs Publisher can use. Paste the SSH address from GitLab's Clone button — it starts with git@ or ssh://." | The address was mistyped, or is not a project address. | Copy it again from the **Clone** button. |
| "GitLab doesn't recognise this key yet. Add it on GitLab's SSH keys page, then test again." | The key is not on your GitLab account. | Step 3: **Copy key**, **Open GitLab**, add it, **Test**. |
| "This key is protected by a password, which Docs Publisher can't type for you. Create a new key for Docs Publisher." | The key has a password. | Press **Create key**. |
| "Docs Publisher can't read this key, so it can't use it. Create a new key for Docs Publisher instead." | The key file is damaged or unreadable. | Press **Create key**. |
| "There is already a file named docs-publisher_ed25519 in your .ssh folder that Docs Publisher can't use. Rename or move it, then press Create key again." | An unusable file is in the way of the new key. | Rename or move that file, then press **Create key**. |
| "GitLab's identity has changed since you last connected. Ask your admin before continuing." | The server's identity is not the one this computer remembers. | Ask your admin. Do not continue until they confirm. |
| "Could not reach GitLab at that address. Check the address and your connection, then try again." | The address is wrong, or you are offline. | Check the address and your connection. GitLab may only be reachable from the company network — in the office or on the VPN. You can keep writing; send when connected. |
| "That project could not be found, or your access does not include it. Check the address in settings." | Wrong address, or your account cannot see the project. | Check the address; ask your admin for access. |
| "A setting on this computer sends this address somewhere else, so Docs Publisher stopped. Ask whoever set up Git on this computer to remove it." | A Git setting rewrites the project's address. | Ask whoever looks after your computer. |
| "Submit didn't go through. Check your connection and submit again." | The send did not complete. | Check your connection and send again. It is safe to retry. |
| "GitLab did not accept this document. Your account may not be allowed to add documents to this project. Ask your admin for Developer access." | Your account cannot add to the project. | Ask your admin. |
| "Someone changed this document on GitLab while you were sending it. Get updates, then send again." | It changed between your check and your send. Nothing was sent. | Get updates, then send again. |
| "Someone changed this document on GitLab since you last got updates. Get updates, then send again." | The published version is newer than the one you started from. Nothing was sent. | Get updates, then send again. |
| "A document already exists at this path on GitLab that you haven't downloaded yet. Get updates first, then try again." | Someone published at this path since you last got updates. | Get updates. |
| "Another document in the project already has this file name, so this one can't be sent. Rename this file and try again." | Two documents cannot share a file name. | Rename the file. |
| "There is nothing new to send: this document already matches the version on GitLab." | Your note equals the published one. | Make a change first. |
| "This note's identity isn't valid, so it can't be sent. Remove the doc_id line from the note's properties and submit again." | An older version of the plugin wrote a document ID into this note and it is damaged. | Remove the `doc_id` property and send again. |
| "This note's title or category is missing or not one of the nine categories. Fill it in on the note, then submit again." | A property was removed or mistyped. | Fix it in the note's properties. |
| "Another note in this vault is the same document: …" | You duplicated a note, so two notes claim to be one document. | Delete the copy, or clear its document ID. |
| A note you deleted is back after **Get updates**. | **Get updates** makes your vault match the project, so a note the project still has and your vault lacks is brought back. | To stop receiving it, ask the project's owner to remove it from the project. |
| "Finish the setup steps in the Docs Publisher panel first." | A step in section 2 is not done. | Open the panel and follow it. |
| "Docs Publisher is still checking your setup. Try again in a moment." | The plugin has only just started. | Wait a few seconds. |
| "The Obsidian Git plugin is also turned on for this vault. It can send changes on its own and clash with Docs Publisher. Turn one of them off." | Two tools are managing the same vault. | Turn one off. Docs Publisher is not blocked. |
| "The check did not succeed. Check your setup and try again." | Something unexpected. | Press **Check again**; if it repeats, tell whoever looks after the plugin. |

## 8. Filename rules

A document's filename is what its identity is made from when it is first sent, so:

- **It must be unique across the whole project**, not just within its folder.
  Two documents called `README` in different folders cannot both be
  published. Use your team's naming convention (for example
  `BOA-SOP-001_Update-Device-Details`) and you will not hit this.
- **No spaces**, and none of `~ ^ : ? * [ \`. It may not start with `.` or `-`,
  contain `..`, or end with `.lock`. Parentheses, `&`, `#`, `-` and `_` are fine.
- Vietnamese letters are fine: `HD-001_Cài-đặt` is accepted. But accents are
  ignored when comparing names, so `Cài-đặt` and `Cai-dat` count as the
  **same** name.
- Names that differ only in capitals (`Notes.md` and `notes.md`) are one file
  on Windows and macOS, so avoid them.

Choose the name **before the first send**. You can rename or move the note
afterwards (see section 3), and the document keeps its identity; but a note you
rename **and** edit before sending is treated as a new note, and its new name
must follow these rules.

---

## 9. For admins and reviewers

This section uses git vocabulary.

**How the plugin works.** There is no token and no API call. The plugin runs the
`git` and `ssh` programs on the author's computer, over SSH, with the author's
own key. The vault itself becomes a git repository (a `.git` folder inside it);
`.obsidian/` and `.trash/` are excluded through `.git/info/exclude`, never a
committed ignore file. It never runs `checkout`, `merge`, `pull`, `rebase` or
anything else that writes the working tree: files in the vault are written only
by the plugin's own code, through Obsidian.

**Requirements.** Git (and OpenSSH, which Git for Windows includes) on the
author's computer; each author needs an account with an SSH key and
**Developer** access on the project.

**Why Developer is safe.** An author's key can push to `doc/<doc_id>` branches
and open merge requests. It cannot publish: keep the **default branch
protected** so only reviewers can merge. The plugin only ever pushes to
`doc/<doc_id>` and never to the default branch. The dedicated key it creates
has no passphrase, because the plugin cannot type one; that is bounded by the
protected branch, and an author can remove a copied key in GitLab at any time.

**What the plugin does in GitLab.** Each document gets branch `doc/<doc_id>`
(the filename, frozen at first send) and, from push options, one merge request
into the default branch, with the title the author gave and "delete source
branch" ticked. **Reviewing and merging happen in GitLab itself — the plugin has
no merge action.** How your actions show up to the author:

| In GitLab | Author sees |
|---|---|
| Open merge request | Waiting for review |
| Merged (any method, branch kept or removed) | Published |
| Closed without merge, branch removed | Not accepted. Terminal: "Submit again" starts a fresh branch from the default branch. |
| Closed without merge, branch left | Still Waiting for review (the plugin has no API to see closed requests; delete the branch). |

"Changes requested" no longer exists as a status, because it needs the
platform's API. Reviewers' comments reach the author through GitLab's own
notifications.

**Pushing to a `doc/*` branch yourself** is fine. The author's next update is
stopped with "The version under review has changes that aren't in your note…" if
you changed a file they are sending, and they bring your change in with Reset.
A commit that touches only other files does not stop them.

**Project setup.** The project must have at least one commit. Document filenames
must be unique repository-wide and ref-legal (`docs/document-naming.md`). The
server must accept push options (`receive.advertisePushOptions`); if it does
not, documents are still sent, and the author is shown "Open to request review".

**Plugin data.** The plugin stores `data.json` in
`<vault>/.obsidian/plugins/obsidian-docs-publisher/`. It holds the project
address, the path of the author's key, their username, and what the last test
covered. **It never contains a key or a password.** Settings left by an earlier
version of the plugin (its records, its saved connection) are ignored and left in
the file, so that version can be reinstalled. Nothing in it is irreplaceable: the
address is also in `.git/config`, and the name and email are git settings.

- **Never commit it** to any repository.
- Reinstalling or updating: replace `main.js`, `manifest.json` and
  `styles.css` only; leave `data.json` in place. `install.sh` does exactly this.

**Where to read more.** `docs/ssh-setup.md` (keys, security trade-offs, what
has been checked on Windows), `docs/ce-verification.md` §F (what has not yet
been confirmed on the target GitLab), and `docs/document-naming.md`.
