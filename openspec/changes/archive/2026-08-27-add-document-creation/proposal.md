## Why

Milestone 2 gave the plugin an authenticated connection and a panel that
reports it. Nothing yet lets an author start a document. Creating one by hand
today means hand-writing a YAML block whose fields the rest of the pipeline
depends on — the exact mechanic the product thesis exists to remove from the
author's experience.

This change adds "New Document": one click produces a note already carrying
the four front matter fields the plugin can know without asking anyone.

It also corrects a message that is wrong today. The panel tells anyone at
Planner or above "Ready to publish your documentation.", but submitting
requires Developer (`docs/gitlab-roles.md` §3). A Planner is told they are
ready to publish and can publish nothing. That correction is bundled here
rather than split out because it is not independently observable value — it
is the state the authoring gate makes necessary, and shipping the gate
without it would leave the panel contradicting the button beside it.

## What Changes

- **New capability `doc-authoring`.** First code in the plugin that writes to
  the vault.
- **"New Document" is offered in two places** — a control in the plugin's
  panel and a command palette entry — both taking the same path, matching how
  the panel itself is opened.
- **A note is created at Obsidian's configured location for new notes** and
  opened for editing. The author names it themselves; the plugin does not
  impose a filename.
- **Four front matter fields are written at creation**, and never written
  again by the plugin:
  - `owner` — the authenticated account's username
  - `created` — today's date
  - `last_reviewed` — the same date as `created`
  - `lifecycle` — `active`
- **Creating is gated twice**: a successful connection check must have
  happened in this session, and the account's role on the configured project
  must be Developer or above. Each refusal names what the author does next.
- **The panel gains a read-only state** for accounts between Planner and
  Reporter: they are named, their role is named, and they are told they can
  read but not contribute. "Ready to publish your documentation." is reserved
  for Developer and above.

### Deferred to a later proposal

Named explicitly so none of it reads as an omission:

- `title`, `category` and `doc_id` are **not** written here. They are
  collected at submit by milestone 4 — `title` and `category` from the
  author, `doc_id` snapshotted from the filename. This is the shift-right
  split recorded in `openspec/config.yaml`: nothing blocks the author's first
  keystroke.
- Submitting, branches, merge requests — milestone 4.
- Embedded images and other attachments — milestone 4a.
- Duplicate-`doc_id` and path-mismatch checks — they bind from the second
  submit onward, so milestones 6 and 7 claim them.
- Validating that a filename is usable as an identifier — milestone 4, at the
  moment it takes the snapshot. This change accepts any filename Obsidian
  accepts.
- Reading the corpus, listing the author's documents, any reviewer surface.

## Capabilities

### New Capabilities
- `doc-authoring`: creating a document in the vault — where the note is
  placed, what front matter the plugin writes at creation and what it
  deliberately leaves for later, and the conditions under which an author may
  create one at all.

### Modified Capabilities
- `plugin-shell`: the sidebar view's connected states change. "The author can
  work" splits into "can author" (Developer and above) and "can read only"
  (Planner and Reporter), and the view gains the "New Document" control in
  the first of those.

## Impact

- **New** `plugin/src/doc-authoring/` — note creation and front matter
  composition. No HTTP client, no endpoint knowledge; the capability boundary
  is unaffected.
- **Modified** `plugin/src/main.ts` — the view renders a new state and a new
  control; the plugin registers one new command.
- **Modified** `plugin/src/platform-config/connection-state.ts` — an
  authoring threshold beside the existing `DOCUMENT_ACCESS_LEVEL`, so neither
  surface reimplements a level comparison.
- **No change** to `git-publishing`. This change makes no remote call: the
  identity comes from the connection result milestone 2 already retains.
- **No new dependency.** Front matter is composed as text and written through
  Obsidian's vault API.
