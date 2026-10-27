## Context

`SubmissionStore` is the only writer of `data.json`. It holds the whole file
as one object and rewrites all of it on every save. `load()` currently does:

```ts
const raw: unknown = await this.plugin.loadData();
this.data = isPluginData(raw) ? raw : emptyData();
```

After `persist-connection-settings` lands, the recognised branch also checks
the optional `connection` key on its own and drops it if it is malformed
(that change's decision 5). The fallback branch stays the same. The fallback
is the hazard: an unusable file loads as empty, and the next save replaces it.

### What `loadData()` actually returns

`obsidian.d.ts` (1.13.1) only says `loadData(): Promise<any>`, and the
developer docs (checked via context7) say no more. The behaviour below was
read from the installed Obsidian 1.13.7 bundle (`obsidian.asar` → `app.js`).
The call chain is `Plugin.loadData` → `vault.readPluginData(dir)` →
`vault.readJson(dir + "/data.json")`, which is, de-minified:

```js
try { return JSON.parse(await this.adapter.read(path)); }
catch (e) {
  if (e.code === "ENOENT") return null;
  console.error("failed to read JSON", path, e);
  return undefined;
}
```

| `data.json` on disk | `loadData()` resolves to |
|---|---|
| Missing | `null` (no log) |
| Empty, truncated, or not JSON | `undefined` (logged) |
| Exists but cannot be read (permissions, a directory, and so on) | `undefined` (logged) |
| Valid JSON | the parsed value, including a literal `null` |

`loadData()` never rejects. `saveData` also never rejects: `writeJson` wraps
`adapter.write` in a try/catch with an empty handler, so a failed write is
invisible to the plugin.

**Uncertainty.** This was read on desktop. On mobile (`isDesktopOnly` is
false), a missing file goes through the Capacitor adapter, and nobody has
checked that it reports `ENOENT`. If it reports something else, a missing
file would come back as `undefined`. Decision 2 makes the design safe either
way.

## Goals / Non-Goals

**Goals:**
- A first run, with no `data.json`, is exactly as silent as it is today.
- A `data.json` that exists but cannot be used is never lost to the
  plugin's own save.
- The author is told once, in author vocabulary, what happened and what to
  do.
- `persist-connection-settings` decision 5 still holds.

**Non-Goals:**
- Repairing or partly salvaging an unusable file.
- Validating individual records.
- Anything that happens to `data.json` after start-up.
- See the proposal's Deferred list.

## Decisions

### 1. Three outcomes, decided once in `load()`

`load()` returns `'loaded' | 'recovered' | 'held'`:

- **`loaded`**: `raw` passes `isPluginData`, which is the existing path plus
  `persist-connection-settings`' separate `connection` check. The same
  outcome covers `raw` that is missing, meaning the file is absent (decision
  2). In that case the store starts empty and nothing is written.
- **`recovered`**: the file exists but cannot be used. The store copies it
  aside, starts empty, and writes the empty data straight away.
- **`held`**: the file exists and cannot be used, and the copy failed. The
  store starts empty and turns off writing for the session.

`main.ts` `onload` shows the notice for `recovered` or `held`. The store
does not import `Notice` itself. It stays a data class, and its tests need
no UI. This follows how every other failure message is raised by the
caller, not by the data layer.

- **Alternative, rejected:** `load()` throws, and `onload` catches it. An
  unusable file is an expected state, not a fault, and three outcomes read
  more plainly as a return value than as an exception type to match on.

### 2. "Missing" is decided by whether the file exists, not by `null` alone

If `raw` is neither recognised nor `null`, the store asks
`app.vault.adapter.exists(<manifest.dir>/data.json)`. If the answer is false,
the result is `loaded`, silently. If it is true, the file is unusable.

A `null` result is treated as missing without the extra call. That also
covers a file that literally contains `null`, which holds nothing to lose.

This single existence check turns the mobile uncertainty from Context into a
non-issue. However a platform reports a missing file, the file does not
exist, so the first run stays silent. It costs one call, and only on the
path that is already abnormal.

- **Alternative, rejected:** telling the cases apart by `null` versus
  `undefined` alone. That is correct on desktop today, but it depends on an
  unverified adapter behaviour and on a minified internal that could change.
  Getting it wrong would show a data-loss warning on every first run.

### 3. Copy aside, then start fresh, rather than refuse to run

The store calls `adapter.copy(dataPath, backupPath)`, where the backup path
is `<manifest.dir>/data-unreadable-<Date.now()>.json`. `copy` moves bytes
without parsing them, so it works whether the problem is bad JSON or a bad
shape. The timestamp means a second incident never overwrites
the copy from the first.

After a successful copy, the store writes `emptyData()` immediately. The
next start-up then finds a valid file, so the notice appears once and not on
every launch until the next save, and there is exactly one backup.

- **Alternative, rejected: refuse to load the plugin.** Nothing gets
  overwritten, but the author cannot work at all until someone edits JSON by
  hand, and Obsidian shows only its generic "failed to load plugin", which
  is not an exact message.
- **Alternative, rejected: read-only for as long as the file is unusable,
  with no copy.** The plugin would run, but nothing it did would persist,
  and the notice would come back on every launch until someone fixed the
  file. Every save caller would need to cope with a save that did not
  happen. The copy gives the same protection for the old data while leaving
  the plugin fully working.
- **Alternative, rejected: salvage whatever records parse.** A partly
  parsed file is exactly the "guess and carry on" this change exists to
  stop, and it is more code for a rare event.
- **What starting fresh costs, recorded:** until the copy is put back,
  imported documents read "Not submitted yet". Submissions heal from each
  note's `doc_id` on the next refresh. If an author selects Submit for
  review on an imported document meanwhile, the existing collision
  pre-flight (`checkTargetPathFree`) refuses it with its existing message,
  because the file is already on the remote. So the author cannot make
  things worse, and the notice does not need to warn against submitting.

### 4. The fallback when even the copy fails: hold every write

If `copy` rejects, the store sets a private `holdWrites` flag. Every
`saveData` call in the store goes through one private `write()` method, and
that method returns without writing while the flag is set. That covers
`saveMany`, and through it `save` and `saveEditBaseline`, as well as
`persist-connection-settings`' `saveConnection`. In-memory updates and
change listeners still run, so the panel behaves normally for the session.
The next launch tries again from the start.

This is the smallest guard that keeps the original file alive when it
cannot be preserved any other way. It is a flag and one `if` statement, and
it sits where every write already passes, not in each caller.

- **Accepted consequence:** in a held session, a submit still reaches the
  remote but is not recorded. It heals from `doc_id` on a later refresh,
  once the file is valid again. An import in a held session is lost at
  restart, and the held notice says nothing new is saved.

### 5. `persist-connection-settings` decision 5 is left alone

`isPluginData` still checks only `submissions`. The `connection` key is
still validated separately and dropped when malformed. A bad `connection`
never produces `recovered` or `held`. This change only replaces what the
fallback branch does. It does not change what counts as recognised.

### 6. Exact messages

Both notices use `new Notice(message, 0)`, so they stay until clicked. A
message that disappears after a few seconds at start-up, often before the
author is looking, does not count as telling them.

- `DATA_RECOVERED_MESSAGE`: "Docs Publisher couldn't read the information
  it saves about your documents, so it has started fresh. A copy of the old
  information was kept in the plugin's folder. Until it's put back,
  documents you imported may show as Not submitted yet, and you may need to
  enter your GitLab address and project ID again. Please tell whoever looks
  after Docs Publisher for your team."
- `DATA_HELD_MESSAGE`: "Docs Publisher couldn't read the information it
  saves about your documents, and couldn't keep a copy of it. To avoid
  losing it, Docs Publisher won't save anything new about your documents
  until Obsidian is restarted. Please tell whoever looks after Docs
  Publisher for your team."

Neither uses branch, commit, merge request, MR, conflict, or main. "Not
submitted yet" is the fixed author-facing label for `unsubmitted`. The file
name is left out of the author message on purpose. It means nothing to the
author, and whoever looks after the plugin finds it by its prefix. The
store also logs the backup path with `console.error` for that person.

## Risks / Trade-offs

- **[A valid file with an unexpected but harmless shape, such as `{}`, now
  produces a backup and a notice.]** → Every build since the first write
  (commit 41a63b0) has written `{ submissions }`, so any other shape is
  genuinely foreign. A spurious notice is the safe way to be wrong.
- **[Records made after a fresh start and records in the kept copy have to
  be merged by hand.]** → The person restoring merges the two `submissions`
  objects, as described under Migration Plan. This is acceptable for a rare
  event on a four-person tool.
- **[Vault sync copies the backup file to other devices.]** → It holds the
  same data the original did. No credential is involved, and the token is
  never in `data.json`.
- **[Backup files pile up if corruption keeps recurring.]** → Each one is
  also a notice the author reports. Recurring corruption is a bug to fix,
  not something to clean up automatically.

## Migration Plan

Nothing to migrate. A valid `data.json` loads exactly as it does today.

To restore after a `recovered` notice, the person who looks after the plugin:

1. Quits Obsidian.
2. Opens `.obsidian/plugins/obsidian-docs-publisher/` and fixes the newest
   `data-unreadable-*.json` so that it is valid JSON of the form
   `{ "submissions": { ... } }`.
3. Merges into its `submissions` any records the current `data.json` has
   gained since the fresh start.
4. Saves the result as `data.json` and reopens Obsidian.

Rollback: an older build treats the fresh `data.json` as ordinary data and
ignores the backup files.

## Open Questions

- **Does the mobile adapter report `ENOENT` for a missing file?** It does
  not block this change, because decision 2 makes the answer irrelevant to
  behaviour. Nobody needs to check it before implementing.
