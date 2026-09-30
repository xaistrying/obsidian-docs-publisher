## Context

Today all three connection values live only in memory, in `plugin.connection`
(`main.ts`, created by `createEmptyConnectionDetails`). Nothing in the plugin
calls `saveData` with them. The only writer of `data.json` is
`SubmissionStore`, which holds the whole file as one in-memory object
(`PluginData { submissions }`) and rewrites all of it on every save
(`saveMany`).

The change is small, but that last fact shapes it. Any second writer of
`data.json` that keeps its own copy would erase the other's keys on its next
save.

Relevant decisions:

- The credentials decision in `docs/access-tokens.md` §3 keeps the token in
  memory only.
- The storage decision in `openspec/config.yaml` treats plugin data as
  plaintext by default and requires a flag before anything else is
  persisted. The proposal is that flag.

## Goals / Non-Goals

**Goals:**
- After a restart, the settings tab shows the last-tested address and
  project ID. The author pastes only the token.
- The token cannot reach `data.json`, by construction and not by care.
- Existing `data.json` files load unchanged, and an older plugin build
  reading a newer file loses nothing.

**Non-Goals:**
- Persisting the token, and the `secretStorage` spike (see the proposal's
  Deferred section).
- Checking automatically at start-up. There is no token at start-up to check
  with.
- A "forget" control.
- Any change to how the connection check itself runs or is reported.

## Decisions

### 1. `SubmissionStore` stays the single writer of `data.json`

`PluginData` gains an optional `connection?: SavedConnection`, where:

```ts
interface SavedConnection { host: string; projectId: string }
```

The store exposes two methods:

- `savedConnection(): SavedConnection | undefined`
- `saveConnection(saved: SavedConnection): Promise<void>`

The second writes through the same `saveData(this.data)` as the records do.

- **Alternative, rejected:** a second small store in platform-config calling
  `loadData`/`saveData` itself. Each store would keep its own copy of the
  file. The next record save would write `{ submissions }` and drop
  `connection`, and a connection save would drop the records, or keep a stale
  copy of them. Making the two reconcile means read-modify-write on every
  save across two owners. That is more code, and it is a race.
- **Alternative, rejected:** pulling out a general `PluginDataFile` that both
  capabilities sit on. This file is one key larger, and a framework for it is
  the speculative generality `config.yaml`'s design rule warns against.
- **The cost, recorded:** a submission-tracking class now holds one
  platform-config value. That is acceptable for one key. If a third concern
  ever needs `data.json`, that is when to extract a shared file owner.

### 2. The token is excluded structurally

`SavedConnection` has no token field. `saveConnection` builds its object from
the two named properties. It never spreads a `ConnectionDetails`, because
`{ ...details }` would copy the token in and the type checker would allow it,
since the extra property survives at runtime.

The unit test asserts on the serialized output: the JSON passed to `saveData`
contains neither a `token` key nor the token's value. That is the check that
fails if someone later "simplifies" the method into a spread.

### 3. Saved on "Test connection", as entered, whatever the outcome

`testConnection` saves only after its all-three-fields guard passes, and
before the check starts, so a check that throws still leaves the values
saved. The values are saved exactly as typed, not normalized. The fields then
restore what the author actually wrote, and https normalization still happens
at use time in `normalizeHost`.

A failed save is caught and logged with `console.error`, and the check goes
ahead. Failing to remember an address must not stop someone connecting in the
current session.

The settings tab gets no dependency on the store. `ConnectionHolder` gains
`rememberConnection(saved: SavedConnection): Promise<void>`, and the plugin
implements it with the store. That keeps the tab's existing "all it needs
from the plugin" interface as its only seam.

- **Alternative, rejected:** saving on every `onChange`. That rewrites the
  whole file, records included, on every keystroke.
- **Alternative, rejected:** saving on `hide()`. Quitting Obsidian with the
  tab open is not guaranteed to call it, and it saves values the author never
  tried.

### 4. Loaded at `onload`, into the existing object, before anything reads it

After `await this.submissions.load()`, the saved `host` and `projectId` are
copied into `this.connection`. The object is `readonly` and its fields are
mutable, and the settings tab already mutates them. This happens before the
settings tab and the view are registered.

The connection state is not touched. It starts `unverified`, which is exactly
what the "start-up is not a connection" scenario requires. `discardResult` is
not involved, because loading is not an edit.

### 5. A malformed `connection` is dropped, never fatal

`isPluginData` keeps checking only `submissions`. The `connection` key is
validated on its own: both properties must be strings, otherwise the key is
ignored.

Folding it into `isPluginData` would make a bad `connection` value reject the
whole file. `load` would then fall back to empty data and the next save would
erase every tracking record. That is the existing corruption hazard, and it
would gain a new trigger.

### 6. Rollback and older builds

An older build's `load` assigns the raw object, `connection` included, to
`this.data`, and its saves write that same object back. A downgrade therefore
keeps the saved values rather than stripping them, and a later upgrade finds
them again. No migration is needed in either direction.

## Risks / Trade-offs

- **Vault sync replicates the address and project ID** along with the
  records `data.json` already holds. → Accepted in the proposal: neither is a
  credential, and the storage decision already treats this file as plaintext.
- **Two devices testing different projects fight through sync.** → The last
  tested wins, and the next Test connection on the other device overwrites it
  again. It is visible in the settings tab, and it matches how the records in
  the same file already behave.
- **The saved project differs from the one the records were stamped with.**
  → No new behaviour. Records already carry their own project
  (`scope-records-to-their-project`) and show "In another project" when they
  do not match. Remembering the values makes a mismatch less likely, because
  a typo is no longer re-made every session.
- **The daily token paste remains.** → Deliberate. It is the `secretStorage`
  spike's to remove, and the proposal records why this change did not take
  that on.

## Migration Plan

No steps are needed. The first Test connection after upgrading writes the
`connection` key, and before that the plugin behaves exactly as it does
today. Rolling back is safe, as decision 6 explains.

## Open Questions

None blocking.
