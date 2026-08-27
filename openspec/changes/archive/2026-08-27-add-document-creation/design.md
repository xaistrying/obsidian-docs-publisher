## Context

The plugin currently ends at "Connected as X — Developer access." Nothing
writes to the vault. This change adds the first code that does.

Two constraints shape everything below:

- **The identity is already in hand.** Milestone 2 retains the connection
  result in `ConnectionStateHolder` for the session. Creating a document reads
  that; it makes no request. This keeps `git-publishing` the sole owner of
  remote access without needing a new client method.
- **The author's first keystroke must not be blocked.** The shift-right split
  recorded in `openspec/config.yaml` puts `title`, `category` and `doc_id` at
  submit, not creation. So there is no modal here — the plugin writes what it
  can know and gets out of the way.

The panel correction rides along because the authoring gate makes it wrong:
`DOCUMENT_ACCESS_LEVEL = 15` currently drives a "Ready to publish your
documentation." message that a Planner would see and could not act on.

## Goals / Non-Goals

**Goals:**
- One click produces a note carrying `owner`, `created`, `last_reviewed` and
  `lifecycle`, opened for editing.
- The same gate is enforced at every entry point, not just by hiding a button.
- Read-only accounts get a panel state that tells them the truth.
- No new dependency, no new remote call, no new folder convention.

**Non-Goals:**
- Any front matter the author owns (`title`, `category`) or the plugin
  snapshots later (`doc_id`). Milestone 4.
- Validating that a filename can serve as an identifier. Milestone 4 owns
  that, at the moment it takes the snapshot.
- A template body. The note is front matter and an empty document; imposing
  headings would be guessing at nine different deliverable shapes.
- Any notion of "which folder is a document folder". The vault mirrors the
  repository 1:1, so every folder is equally valid and the plugin has no
  opinion.

## Decisions

### Create with `vault.create`, not `fileManager.createNewMarkdownFile`

`createNewMarkdownFile` is what Obsidian's own New Note uses and would handle
name collisions for us, but it is **not present in the `obsidian@1.13.1`
typings** — it is internal API. `Vault.create(path, data)` is public and typed,
and it takes the full file content, which is exactly what we want since the
front matter is composed before the file exists.

Cost: we handle name uniqueness ourselves — probe with
`vault.getAbstractFileByPath` and append ` 1`, ` 2`, … until the path is free,
matching Obsidian's own convention. That is a short loop and it is typed.

### Compose the front matter as text, not via `processFrontMatter`

`FileManager.processFrontMatter` operates on an existing `TFile`. Using it
would mean creating an empty file, then rewriting it — two writes and a window
where a half-formed note exists. Building the YAML block as a string and
passing it to `vault.create` is one write and no intermediate state.

The values are safe to interpolate without a YAML escaper: GitLab usernames are
restricted to alphanumerics, `-`, `_` and `.`; the dates are generated; and
`active` is a literal. This is worth stating because it is the reason no
serializer dependency is being added — not an oversight.

### Placement follows the vault's own setting

`fileManager.getNewFileParent(activeFilePath)` returns the folder Obsidian
would use for a new note, honouring the user's "Default location for new
notes" preference. Passing the active file's path makes "same folder as
current file" work; passing `''` when nothing is open falls back correctly.

Rejected: a plugin setting for a documents folder. The vault mirrors the
repository 1:1 and the team already has a governed hierarchy — a second,
plugin-owned notion of where documents live could only disagree with it.

### Dates come from local time, never `toISOString()`

`new Date().toISOString().slice(0, 10)` yields the **UTC** date. For an author
in UTC+7, every document created before 07:00 local would be stamped with
yesterday. Compose from `getFullYear()`, `getMonth() + 1` and `getDate()` with
zero-padding.

Small, and the kind of thing that is invisible until someone compares a
document's `created` against the review history and finds it a day early.

### One threshold module, two bands

Add `AUTHOR_ACCESS_LEVEL = 30` beside the existing `DOCUMENT_ACCESS_LEVEL = 15`
in `platform-config/connection-state.ts`, with a matching predicate. Both bands
are then answered by the same file that already answers the first, and no
surface writes its own `>=` comparison.

The panel reads three cases from those two predicates: can author, can read
only, cannot work. Keeping the read-only band derived (`grantsDocumentAccess &&
!grantsAuthoring`) rather than stored means the two thresholds cannot drift
into an ordering where a band is unreachable.

### The command is always in the palette and refuses out loud

Obsidian's `checkCallback` would remove "New Document" from the palette when
the author cannot use it. Rejected: it also makes a bound hotkey do nothing at
all, silently — the failure this codebase already avoids in `openSettingsTab`,
which tells the author how to reach settings by hand rather than appearing to
do nothing.

So: a plain `callback`, with the gate inside, surfacing a `Notice`. The panel
control is a separate matter and *is* conditionally rendered — a visible button
that refuses when pressed would be worse than no button, and the panel
re-renders on state change already.

### The default filename deliberately contains a space

The note is created as `Untitled document`. Beyond matching Obsidian's
convention, a space is illegal in a git ref — so if this default ever survived
to a first submit, milestone 4's ref-legality check refuses it rather than
freezing `Untitled document` as a permanent `doc_id`. That is milestone 4's
guard doing its job, not a mechanism this change relies on, but it is the
reason not to "tidy" the default into `untitled-document`.

## Risks / Trade-offs

- **The author never renames, and submits `Untitled document`** → Milestone 4
  refuses at the snapshot. This change does not warn, because warning about a
  rule enforced two milestones later, at creation time, teaches the author a
  mechanic before they need it.
- **`getNewFileParent` puts the note somewhere unexpected** → It is the same
  place Obsidian's own New Note would put it, so the author's mental model
  already covers it. Preferable to a plugin-specific answer they would have to
  learn separately.
- **Two thresholds can drift** → Both live in one file, both are consumed
  through predicates, and the read-only band is derived from the pair rather
  than declared independently.
- **The role gate is optimistic, never proof** → A Developer whose token was
  granted read-only access passes this check and will still fail at submit
  (`docs/gitlab-roles.md` §1 — gate 2 has no API and cannot be introspected).
  This gate removes the common case, not the case. Nothing here may be treated
  later as evidence that a submit will succeed.
- **`vault.create` can still reject a path** → The uniqueness probe is not
  atomic, and a sync client could land a file between the probe and the write.
  The failure surfaces as a `Notice`; no partial note is left behind, because
  content and creation are one call.

## Migration Plan

None required. No stored data changes, nothing is written to plugin data, and
existing notes are untouched — the plugin only ever writes files it creates.
The panel change is a render-time difference visible on next load.

## Open Questions

None blocking. One deliberately left to observation: whether authors want the
new note's name selected for renaming immediately on creation. Obsidian offers
no public API to focus the file-explorer rename field, so doing it would mean
reaching into internals for a convenience — revisit only if authors report the
rename step as friction.
