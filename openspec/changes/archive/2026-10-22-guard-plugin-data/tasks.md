## 0. Sequencing

- [x] 0.1 Implement after `persist-connection-settings` is merged. That
      change also edits `SubmissionStore.load()` and adds `saveConnection`.
      Start from its merged version and keep its decision 5 intact:
      `isPluginData` checks only `submissions`, and a malformed `connection`
      is dropped on its own, never rejecting the file.

## 1. Guard the load and every write

- [x] 1.1 In `submission-store.ts`, add one private `write()` that calls
      `this.plugin.saveData(this.data)` unless a private `holdWrites` flag
      is set. Route every existing `saveData` call through it: `saveMany`,
      and `persist-connection-settings`' `saveConnection` (design.md
      decision 4).
- [x] 1.2 Change `load()` to return `'loaded' | 'recovered' | 'held'`
      (decision 1). Keep the recognised path exactly as
      `persist-connection-settings` leaves it. If `raw` is `null`, or
      `adapter.exists(<manifest.dir>/data.json)` is false, start empty and
      return `'loaded'` without writing (decision 2).
- [x] 1.3 Otherwise, `adapter.copy` the file to
      `<manifest.dir>/data-unreadable-<Date.now()>.json`. Then
      `console.error` the backup path, start empty, call `write()`, and
      return `'recovered'`. If the copy rejects, set `holdWrites`, start
      empty, and return `'held'` (decisions 3 and 4).
- [x] 1.4 Correct the `isPluginData` doc comment, which currently says it
      guards against the file being absent. Absence is now decided in
      `load()`.

## 2. Tell the author

- [x] 2.1 In `main.ts` `onload`, show `new Notice(message, 0)` for the
      result of `await this.submissions.load()`: `DATA_RECOVERED_MESSAGE` on
      `'recovered'`, `DATA_HELD_MESSAGE` on `'held'`, and nothing on
      `'loaded'`. Use the exact text in design.md decision 6, and check both
      messages against the author-facing vocabulary ban.

## 3. Check

- [x] 3.1 Add `tests/guard-plugin-data.test.ts`. Use a fake `Plugin` that
      supplies `loadData`, `saveData`, `manifest.dir`, and
      `app.vault.adapter.{exists, copy}`, following the pattern in
      `tests/stale-records.test.ts`. It needs these tests:
      - `null` and a file that does not exist: `'loaded'`, and neither
        `copy` nor `saveData` is called.
      - `undefined` from an existing file, and `{}`: `'recovered'`, `copy`
        is called with a `data-unreadable-` destination before the first
        `saveData`, and that `saveData` receives `{ submissions: {} }`.
      - `copy` rejects: `'held'`, and a later `save(record)` never calls
        `saveData`, while `get` still returns the record.
      - Valid `submissions` with a malformed `connection`: `'loaded'`, and
        `copy` is never called.
- [x] 3.2 Confirm `npm run build` and `npm test` both pass.
- [x] 3.3 (superseded by replace-rest-with-local-git-ssh — check not run) In the running plugin, with a copy of the real `data.json` saved
      somewhere first:
      - Quit Obsidian and replace
        `.obsidian/plugins/obsidian-docs-publisher/data.json` with the text
        `not json`. Reopen Obsidian. The recovered message appears and stays
        until clicked. The folder holds a `data-unreadable-<timestamp>.json`
        containing `not json`, and `data.json` now holds empty
        `submissions`.
      - Quit and reopen again. No notice appears, and no second copy is
        kept.
      - Quit, delete `data.json`, and reopen. No notice appears, and no copy
        is kept.
      - Put the saved `data.json` back and reopen. Every document shows the
        state it had before.
