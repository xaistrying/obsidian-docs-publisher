# Docs Publisher — user guide

Docs Publisher lets you write documents in Obsidian and send them for review
without leaving Obsidian. You write, you press a button, a reviewer reads it,
and it is published. This guide takes about ten minutes to read.

Sections 1–7 are for authors. Section 8 is for the admin or reviewer who sets
authors up.

- [1. Install the plugin](#1-install-the-plugin)
- [2. Get an access token](#2-get-an-access-token)
- [3. Connect to GitLab](#3-connect-to-gitlab)
- [4. Write and submit a document](#4-write-and-submit-a-document)
- [5. What each status means, and what to do next](#5-what-each-status-means-and-what-to-do-next)
- [6. Reset, Restore and Import](#6-reset-restore-and-import)
- [7. Troubleshooting](#7-troubleshooting)
- [8. For admins and reviewers](#8-for-admins-and-reviewers)

---

## 1. Install the plugin

You need Obsidian **1.5.7 or newer**.

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
folder — it also holds your document list (see section 8).

## 2. Get an access token

The access token is what lets the plugin act as you on GitLab. **Treat it like
a password**: never paste it into a note, a chat message or an email, and never
share it with anyone, including your admin. Each person creates their own.

1. Sign in to GitLab in your browser.
2. Go to **User settings → Access tokens** and create a **fine-grained**
   access token.
3. Give it a name you will recognise, for example `Docs Publisher`.
4. Set the expiry date to **one year from today**.
5. Tick exactly the permissions listed in the plugin's settings, under
   **Access token** (open Obsidian **Settings → Docs Publisher** to see the
   list). The same list is in section 8 for your admin. There are two tabs of
   permissions: most are on **Group and project**, and one, **User (Read)**,
   is on the separate **User** tab — it is easy to miss. Nothing else is
   needed.
6. Create the token and copy it. GitLab shows it only once.
   You will need it each time you start Obsidian, so keep it somewhere private
   on your own computer, such as a password manager. **Never keep it inside
   your vault**: vault files can be synced, and a note can be submitted to
   GitLab, which would publish the token with it.

**When your token expires:** it stops working on its expiry date, and the
plugin tells you with "Your access token has expired or is incorrect. Check
you pasted all of it, or create a new one in GitLab." Create a new token with the same steps above and paste it into the plugin. Your GitLab
address and project ID are remembered, so nothing else needs entering. A
calendar reminder a week before the date saves you the surprise.

## 3. Connect to GitLab

Open Obsidian **Settings → Docs Publisher** and fill in the three fields:

| Field | What to enter |
|---|---|
| **GitLab address** | The address of your GitLab server, for example `https://gitlab.example.com`. Ask your team lead if you don't know it. |
| **Project ID** | The numeric ID of the project, shown on its overview page in GitLab. A namespace path like `my-group/my-docs` also works. Ask your team lead if you don't know it. |
| **Access token** | Paste your token from section 2. |

Then press **Test connection**.

- While it checks, you see **Checking…**.
- When it works, you see **Connected as** *your name* **—** *your role*
  **access**, for example "Connected as Jane Doe — Developer access". The
  panel then says **Ready to publish your documentation.** and shows the
  **New Document** button.
- If it fails, the message says what to fix. See section 7.

**What is remembered.** Your GitLab address and project ID are remembered
after you test the connection. Your access token is kept for this Obsidian
session only and is never written to disk, so **you paste the token again each
time you start Obsidian** (then press **Test connection** again). Until you do,
the panel shows **Not connected yet** with an **Open settings** button.

If your role is not Developer or higher, the panel explains that you can read
documents but not add to them. Ask your admin for Developer access.

## 4. Write and submit a document

### Create the document

1. Press **New Document** in the panel (or run **New Document** from the
   command palette).
2. A note named **Untitled document** opens. The plugin has filled in its
   properties for you: `owner` (your GitLab username), `created` and
   `last_reviewed` (today's date), and `lifecycle: active`.
3. **Rename the note** before you submit. The default name has a space in it,
   and a document's filename may not contain spaces (see
   [Filename rules](#filename-rules)). Follow your team's naming convention,
   for example `BOA-SOP-001_Update-Device-Details`.
4. **Put the note in the right folder now.** Your vault's folders are the
   project's folders: where the note sits is exactly where it will be
   published.
5. Write the document. Images you embed in the note are sent with it.

### Submit it for review

1. With the note open, press **Submit for review** in the panel (or run
   **Submit for review** from the command palette).
2. Fill in the form:
   - **Title** — the document's title.
   - **Category** — choose one of: User Manual, Operational Manual, Release
     FAQ, SOP, Runbook, Configuration Reference, Diagnostic Reference, Known
     Errors, Safe-Action Boundaries.
   - **Target path** — shows where the document will be published. **Check
     it.** If it is wrong, close the form, move the note to the right folder,
     and start again.
3. Press **Submit**. You see **Waiting for review**.

> **After the first submit, the note cannot move.** Do not move or rename it
> afterwards. If you do, the next submit is refused with "This document belongs
> at … Move the note back there, then submit again."

The plugin adds `title`, `category` and a document ID to the note's properties
on the first submit. From then on they are yours: to change the title or
category later, edit them in the note's properties. The plugin never changes
them again. Update `last_reviewed` yourself whenever you re-read a document and
confirm it is still correct.

## 5. What each status means, and what to do next

The panel sorts your documents into two lists:

- **Needs you** — "Documents waiting on you: not sent yet, sent back by a
  reviewer, or changed since you last sent them."
- **Waiting on reviewers** — "Sent and unchanged. Nothing to do until a
  reviewer responds." This list starts folded; its number shows how many
  documents are in it. Click the heading to open it.

When a note is open, its status is also shown above the panel's buttons.

| Status | What it means | What to do |
|---|---|---|
| **Not submitted yet** | Nobody has seen it yet. | Finish it and press **Submit for review**. |
| **Waiting for review** | A reviewer has it. | Nothing. If you edit it meanwhile, press **Send update**. |
| **Changes requested** | A reviewer left comments. | Click **Open in GitLab** on the document's row to read them. Edit the note, then press **Send update**. |
| **Published** | It is live. | Nothing. To revise it, see below. |
| **Not accepted** | The reviewer closed it without publishing. | Read why with **Open in GitLab**. To try again, see below. |

Other markers you may see:

- **Unsent edits** — you changed the note since you last sent it. Press
  **Send update** (or **Submit a new version**) when you are ready.
- **In another project** — the document belongs to a different project than
  the one in your settings. Check your **Project ID** before submitting.

**Send update** (Waiting for review or Changes requested). Sends your latest
version to the same review. You see "Your update was sent. Refresh to see where
the review stands." The status does not change by itself: a document stays
**Changes requested** until the reviewer's comments are resolved in GitLab.

**Revising a published document.** Open the note, make your changes, and press
**Submit a new version**. The form shows the title, category and location
(read-only). Press **Submit**. A new review starts and the status becomes
**Waiting for review**. Published documents you have not changed are not
listed in the panel; open the note to see its status.

**Resubmitting after Not accepted.** Make the changes the reviewer asked for,
then press **Submit again**. A new review starts.

**Refresh.** The panel checks for status changes when it opens and when you
press **Refresh** — never on its own. While it works, the button reads
**Checking…**. If a check fails, the panel keeps the last known statuses and
says "Could not check your documents' status just now. They may have changed
since this was last updated."

## 6. Reset, Restore and Import

| Use | When | Where |
|---|---|---|
| **Reset** | You want to throw away your changes to a document under review and go back to the version the reviewer has. | Button beside **Send update**, with the note open. Only shown while the document is Waiting for review or Changes requested. |
| **Restore** | You deleted a note while it was still under review. | **Documents you can restore** — "Documents still in review that this vault no longer has a note for." |
| **Import all** | You want documents that are already published but not in your vault (new laptop, new colleague's work). | **Documents you can import** — "Documents on the platform that this vault has no copy of." |

**Reset overwrites your note.** Pressing **Reset** asks first: "Reset this
document? … will be replaced with the version currently under review. Anything
you have changed in this note since you last sent it will be lost." Press
**Cancel** to keep your note, or **Reset** to replace it. When done you see
"This note now matches the version under review."

**Restore** puts the note back where it was. You see "This document is back in
your vault."

**Import all** brings in every document in the list, each at its own
location, and marks it **Published**. You see how many were imported. Any
document that could not be imported stays in the list with the reason under
it — usually a name problem (see [Filename rules](#filename-rules)). If the
list says it is incomplete, there were more documents than could be listed at
once.

## 7. Troubleshooting

| You see | What it means | What to do |
|---|---|---|
| "Your access token has expired or is incorrect. Check you pasted all of it, or create a new one in GitLab." | Your token has expired, was pasted wrongly, or was revoked. | Paste the token again and press **Test connection**. If it still fails, create a new token (section 2). |
| "Your access token doesn't have permission to … (missing: *name*). Create a new access token that includes it." | Your token is missing the permission named in brackets. | A token's permissions can't be changed after it is created, so create a new token that includes it (section 2) — compare with the list in the plugin's settings — and paste the new one in. |
| "Could not reach GitLab at that address. Check the address above and your connection, then try again." | The address is wrong, or you are offline / off the network. | Check the **GitLab address** and your connection. GitLab can only be reached from the company network — in the office or on the VPN. You can keep writing and saving documents anywhere; submit them once you're connected. |
| "Submit didn't go through. Check your connection and submit again." | The submit did not complete. | Check your connection and submit again. It is safe to retry. |
| "Someone else changed this document while you were working on it. Open it in GitLab to see their changes, then submit again." | Someone edited the document under review directly in GitLab. Nothing of yours was sent. | Open it in GitLab to see their changes. To keep both, copy your changes somewhere, press **Reset** to take their version, add your changes back, then **Send update**. |
| "Test your connection in the plugin's settings before creating a document." / "Add your GitLab details in the plugin's settings first." | You are not connected in this session. | Section 3. |
| "This note's title or category is missing or not one of the nine categories. Fill it in on the note, then submit again." | The `title` or `category` property was removed or mistyped. | Fix it in the note's properties. The category must match one of the nine exactly. |
| "Another note in this vault is the same document: …" | You duplicated a note, so two notes claim to be one document. | Delete the copy, or clear its document ID, then submit again. |

### Filename rules

A document's filename is its permanent identity, so:

- **It must be unique across the whole project**, not just within its folder.
  Two documents called `README` in different folders cannot both be
  published. Use your team's naming convention (for example
  `BOA-SOP-001_Update-Device-Details`) and you will not hit this.
- **No spaces**, and none of `~ ^ : ? * [ \`. It may not start with `.` or end
  with `.lock`. Parentheses, `&`, `#`, `-` and `_` are fine.
- Vietnamese letters are fine: `HD-001_Cài-đặt` is accepted. But accents are
  ignored when comparing names, so `Cài-đặt` and `Cai-dat` count as the
  **same** name.

Messages you may see:

- "This file's name can't be used as a document ID. Rename it — no spaces and
  none of ~^:?*[\ — then submit again."
- "A document with this file name is already waiting for review. If that's this
  document, there's nothing more to do. If it's a different one, rename the
  file and submit again."
- "A document already exists at this location. Rename this note to publish it
  separately, or delete it and import the existing one instead."

Rename only **before the first submit**. After that, see the warning in
section 4.

---

## 8. For admins and reviewers

This section uses git vocabulary.

**Roles.** An author needs **Developer** on the project. Developer is the
floor for submitting: a submit is a push to a non-protected branch plus a merge
request. Planner and Reporter connect but are read-only (the panel says so and
asks for Developer access); Guest and below see nothing. A role is a
prediction, not proof — a Developer whose token lacks a permission still fails,
with a message naming it. See `docs/gitlab-roles.md`.

**Token permissions.** Fine-grained personal access token, one per author
(never a shared or project token — the merge request author must be the real
person). Exactly these, as shown in the settings tab:

- Group and project — Project (Read), Repository (Read), Branch (Read, Delete),
  Commit (Create), Merge Request (Read, Create)
- User — User (Read). On the separate User tab; missing it fails Test
  connection at the first step.

Authors do not need Merge Request: Merge.

**Expiry and renewal.** Each author creates their own token with a one-year
expiry; there is no central rotation. When a token expires, every call fails
with 401 and the plugin shows the author "Your access token has expired or
is incorrect. Check you pasted all of it, or create a new one in GitLab."
with a link to its settings; the author creates a new token
(section 2). Permissions can't be edited on an existing token, so a missing
permission also means a new token. To cut off someone who leaves, remove them
from the project — their token loses access with it.

**What the plugin does in GitLab.** Each document gets branch
`doc/<doc_id>` (the filename, frozen at first submit) and one merge request
into `main`. **Reviewing and merging happen in GitLab itself — the plugin has
no merge action in v1.** How your actions show up to the author:

| In GitLab | Author sees |
|---|---|
| Open MR, no unresolved threads | Waiting for review |
| Open MR with unresolved threads | Changes requested (back to Waiting for review once threads are resolved and they Refresh) |
| Merged | Published |
| Closed without merge | Not accepted. This is terminal: "Submit again" cuts a fresh branch from `main`, and the plugin deletes the abandoned branch itself (hence Branch: Delete). |

Do not push commits to a `doc/*` branch yourself — the author's next update is
refused ("Someone else changed this document…") and they must reconcile by
hand. Comment instead. On CE, required approvals do not exist; the protected
`main` branch's "Allowed to merge" setting is the only gate on publishing.

**Project setup.** The project must have at least one file (a README will do);
an empty project fails every submit with "This project has no files yet…".
Document filenames must be unique repository-wide and ref-legal
(`docs/document-naming.md`). A `README.md` or `_placeholder.md` that carries
YAML front matter is offered for import as if it were a document — remove the
front matter.

**Plugin data.** The plugin stores `data.json` in
`<vault>/.obsidian/plugins/obsidian-docs-publisher/`. It holds each document's
tracking record and the remembered GitLab address and project ID. **It never
contains the access token** — the token is held in memory only.

- **Back it up.** Submitted documents recover their status from GitLab on
  Refresh, but imported documents' Published status exists only in this file;
  lose it and they all read "Not submitted yet".
- **Never commit it** to any repository.
- Reinstalling or updating: replace `main.js`, `manifest.json` and
  `styles.css` only; leave `data.json` in place.
