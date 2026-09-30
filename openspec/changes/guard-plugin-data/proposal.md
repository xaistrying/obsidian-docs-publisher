## Why

`SubmissionStore.load()` treats a `data.json` it cannot use the same way it
treats a missing one: it starts empty, says nothing, and the next save
overwrites the file. Since Import shipped, that is real data loss. An
imported document's "Published" state exists only in `data.json`. Nothing on
the remote can rebuild it, because reconciliation resolves state from merge
requests and an import has none (`openspec/config.yaml`, "Submission state is
tracked in plugin data", AMENDED 2026-09-22). Tracked submissions heal from
each note's `doc_id` on the next refresh. Imported documents do not, and they
all go back to "Not submitted yet" with no way for the author to fix it.
Found by the 2026-09-30 release review.

## What Changes

- **A missing `data.json` stays silent.** This is the normal first run.
  Obsidian's `loadData()` returns `null` for it, and the store starts empty
  as it does today.
- **A `data.json` that exists but cannot be used is copied aside before
  anything overwrites it.** "Cannot be used" means it could not be read, it
  is not valid JSON, or it is valid JSON without a `submissions` object. The
  plugin copies it to a new file named `data-unreadable-<timestamp>.json` in
  the plugin's own folder, starts fresh, and immediately writes the fresh
  file. It then tells the author once, with a notice that stays until it is
  dismissed:

  > Docs Publisher couldn't read the information it saves about your
  > documents, so it has started fresh. A copy of the old information was
  > kept in the plugin's folder. Until it's put back, documents you imported
  > may show as Not submitted yet, and you may need to enter your GitLab
  > address and project ID again. Please tell whoever looks after Docs
  > Publisher for your team.

- **If the copy cannot be made, nothing is written for the rest of the
  session.** The plugin keeps working in memory, but no save reaches
  `data.json` until Obsidian restarts, so the unreadable original survives
  for someone to recover. The author sees, once:

  > Docs Publisher couldn't read the information it saves about your
  > documents, and couldn't keep a copy of it. To avoid losing it, Docs
  > Publisher won't save anything new about your documents until Obsidian is
  > restarted. Please tell whoever looks after Docs Publisher for your team.

- **`persist-connection-settings`' rule is kept.** A malformed `connection`
  key is still dropped on its own and never makes the file count as
  unusable. That change's design decision 5 is unchanged.

### Deferred, deliberately

- **Restoring from the kept copy inside the plugin.** Whoever looks after
  the plugin puts the copy back by hand (see design.md, Migration Plan). This
  is a four-person tool and the incident is rare. Add a restore action only
  if it happens more than once.
- **Checking each record's shape.** The guard checks the file's top-level
  shape, as `isPluginData` does today. A file with a well-formed
  `submissions` object holding one malformed record still loads. Add this
  only if a malformed record is ever seen.
- **Atomic writes.** Obsidian's `saveData` writes the file in place. Guarding
  against a crash in the middle of a write belongs to Obsidian's adapter, not
  to this plugin.
- **Reacting to `data.json` changing while Obsidian is open** (vault sync,
  `onExternalSettingsChange`). That is a separate problem. This change only
  covers what the plugin finds at start-up.
- **A notice when `saveData` fails.** Obsidian swallows write errors (see
  design.md, Context), so the plugin cannot see a failed write at all.
- **`plugin/install.sh` deleting `data.json`.** Already fixed, and out of
  scope.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `submission-tracking`: adds a requirement that stored records are never
  overwritten when the stored file cannot be used, including the exact
  author messages.

## Impact

- `plugin/src/submission-tracking/submission-store.ts`: `load()` tells a
  missing file apart from an unusable one, copies the unusable one aside, and
  returns which of the three happened. Every write goes through one guarded
  method.
- `plugin/src/main.ts`: `onload` shows the matching notice.
- A new test file under `plugin/tests/`.
- No change to any remote interaction, the data shape, or the settings tab.
