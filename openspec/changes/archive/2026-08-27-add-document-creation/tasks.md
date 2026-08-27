## 1. The access bands

- [x] 1.1 Add `AUTHOR_ACCESS_LEVEL = 30` and a `grantsAuthoring(state)`
      predicate beside `DOCUMENT_ACCESS_LEVEL` / `grantsDocumentAccess` in
      `plugin/src/platform-config/connection-state.ts`, with a comment citing
      `docs/gitlab-roles.md` §3 for why Developer is the floor.
- [x] 1.2 Add a `grantsReadOnly(state)` predicate derived from the pair
      (`grantsDocumentAccess && !grantsAuthoring`) so the middle band is never
      declared with its own comparison.

## 2. Creating the document

- [x] 2.1 Create `plugin/src/doc-authoring/front-matter.ts`: compose the
      four-field YAML block from a username and a date. Format the date
      `YYYY-MM-DD` from local `getFullYear`/`getMonth`/`getDate` — not
      `toISOString`, which returns the UTC day.
- [x] 2.2 Create `plugin/src/doc-authoring/create-document.ts`: resolve the
      target folder via `fileManager.getNewFileParent`, find a free path from
      the `Untitled document` base by probing `getAbstractFileByPath`, write
      the note with `vault.create`, and open it.
- [x] 2.3 Add the gate in front of that path: refuse with
      `MISSING_DETAILS_MESSAGE` when the connection details are absent, with
      "Test your connection in the plugin's settings before creating a
      document." when unverified or failed, and with the role-specific message
      when the role is below Developer. Every refusal is a `Notice` and creates
      no file.

## 3. Wiring the entry points

- [x] 3.1 Register a "New Document" command in `plugin/src/main.ts` using a
      plain `callback` (not `checkCallback`, so a bound hotkey cannot fail
      silently) that calls the gated path.
- [x] 3.2 Render the "New Document" control in the panel's authoring state
      only, calling the same path.

## 4. The panel's three connected states

- [x] 4.1 Split the panel's connected rendering into can-author, read-only and
      blocked, replacing the single `grantsDocumentAccess` branch.
- [x] 4.2 Add the read-only copy: "Your <role> access lets you read this
      project's documents but not add to them. Ask your admin for Developer
      access.", with the "Open settings" control and no "New Document".
- [x] 4.3 Confirm "Ready to publish your documentation." now appears only at
      Developer and above.

## 5. Closing the change

- [x] 5.1 Run the type checker and the build; both clean.
- [x] 5.2 Observable check — connected as a Developer: open the panel, select
      "New Document". A note opens with front matter carrying `owner` (your
      GitLab username, not your email), `created` and `last_reviewed` set to
      today and equal, `lifecycle: active`, and no `title`, `category` or
      `doc_id`. Rename the note freely; nothing objects.
- [x] 5.3 Observable check — gating: with the plugin reloaded and no
      connection check run, invoke "New Document" from the command palette. No
      note is created and the message names what to do next. Repeat pointing
      at a project where the account holds Reporter: the panel shows the
      read-only message with no "New Document" control, and the command
      palette entry still refuses by name.

      **Observed in part.** The no-details refusal was confirmed: the toast
      read "Add your GitLab details in the plugin's settings first.", no note
      was created, and the panel offered no "New Document" control. The
      Reporter half was **not** observed — no account holding Reporter or
      Planner on any project was available to test with. So `grantsReadOnly`,
      `readOnlyMessage` and the panel's read-only branch ship unobserved,
      verified by the type checker and by reading only. First observation
      falls to whoever first connects at Planner or Reporter; if that band
      renders wrong, look here before looking at the authoring path.
