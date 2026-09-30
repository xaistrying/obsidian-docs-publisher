## 1. Persist the two values through the one writer

- [x] 1.1 In `submission-store.ts`, export `SavedConnection { host: string;
      projectId: string }` and add `connection?: SavedConnection` to
      `PluginData`. Give it no token field (design.md decision 2).
- [x] 1.2 Add `savedConnection(): SavedConnection | undefined` and
      `saveConnection(saved)`. The save must build `{ host, projectId }`
      from the two named properties, never spread its argument, and write
      through the same `saveData(this.data)` the records use. Do not notify
      record listeners: a connection save changes no record.
- [x] 1.3 In `load`, validate `connection` on its own. Keep it only when
      both properties are strings, and otherwise drop the key. Leave
      `isPluginData` checking `submissions` alone, so that a bad
      `connection` can never reject the file and erase the records
      (decision 5).

## 2. Save on Test connection, restore at start-up

- [x] 2.1 Add `rememberConnection(saved: SavedConnection): Promise<void>` to
      `ConnectionHolder` in `settings-tab.ts`, and implement it on the
      plugin in `main.ts` through `this.submissions.saveConnection`.
- [x] 2.2 In `testConnection`, once the all-three-fields guard passes and
      before `state.set({ kind: 'checking' })`, save the address and project
      ID as typed. Catch and `console.error` a failed save, then carry on
      with the check (decision 3). An empty field must still save nothing.
- [x] 2.3 In `onload`, right after `await this.submissions.load()`, copy the
      saved `host` and `projectId` into `this.connection`. Leave
      `connectionState` alone, so the plugin still starts not connected
      (decision 4).

## 3. Copy and comments

- [x] 3.1 Settings-tab intro (`settings-tab.ts`), exactly: "Your GitLab
      address and project ID are remembered after you test the connection.
      Your access token is kept for this Obsidian session only and never
      written to disk, so you paste it again after a restart." Check it for
      the author-facing vocabulary ban.
- [x] 3.2 Panel not-connected note (`main.ts`), exactly: "You paste your
      access token once each time you start Obsidian."
- [x] 3.3 Correct the comments that say the connection details are never
      persisted: `connection.ts` `createEmptyConnectionDetails`, `main.ts` on
      the `connection` field and on the `submissions` field. They must say
      the token alone is never persisted.

## 4. Records

- [x] 4.1 Amend `docs/access-tokens.md` §3 in place, keeping its history
      convention (dated AMENDED note, nothing deleted). The address and
      project ID now persist once tested. The token decision is unchanged.
      The daily burden is now one field. Record the 2026-09-30 decision to
      leave the `secretStorage` spike open past v1, against that section's
      own "answer it when credential handling is next touched" instruction,
      and say why: this change did not touch where the token is stored.
- [x] 4.2 Amend the credentials entry in `openspec/config.yaml`, which
      summarises §3 as "the three values are held in memory for the session
      and never written to any file", to match. This is also the explicit
      flag that the storage decision's "flag before persisting anything
      else" rule asks for.

## 5. Check

- [x] 5.1 Add `tests/connection-settings.test.ts`, using the fake `Plugin`
      pattern from `tests/stale-records.test.ts`. It needs three tests:
      - Saving and then loading from the captured data returns the address
        and project ID.
      - The JSON passed to `saveData` contains neither a `token` key nor the
        token's value, even when `saveConnection` is handed a full
        `ConnectionDetails` object.
      - A malformed `connection` is dropped while every record still loads.
- [x] 5.2 Confirm `npm run build` and `npm test` both pass.
- [x] 5.3 In the running plugin:
      - Fill in all three fields and select Test connection.
      - Quit and reopen Obsidian, then open settings. The address and
        project ID are filled in, the token is empty, and the panel shows
        "Not connected yet" with the new note.
      - Paste the token and test. The plugin connects.
      - Open `data.json`. It holds `connection` with those two values and
        nothing resembling the token.
