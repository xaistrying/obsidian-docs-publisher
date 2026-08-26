## 1. Connection state

- [x] 1.1 Add `connection-state.ts` to `platform-config`: a discriminated union of `unverified`, `checking`, `verified` (identity + access), and `failed` (failure kind + identity or null), plus a holder exposing the current value, a setter, and `onChange(listener)` returning an unsubscribe function. Memory only — no `saveData` call anywhere in this file.
- [x] 1.2 Name the access threshold as a constant rather than a bare `>= 15`, with a comment pointing at `docs/gitlab-roles.md` §3 for why Planner is the floor. Add a helper that answers whether a `verified` state grants access to the project's documents, so both surfaces ask the same question the same way.
- [x] 1.3 Hold the state on the plugin instance beside the existing connection details, and pass it to both the settings tab and the view.

## 2. Settings tab publishes into the state

- [x] 2.1 Rewrite `testConnection()` to write `checking`, then `verified` or `failed`, into the shared state instead of calling `setStatus`. Keep the in-flight guard and the empty-fields check, which run before any state is written.
- [x] 2.2 Render the settings tab's status line from the shared state and subscribe to changes; delete the local `checking` field and the hand-rolled busy-state reconstruction in `display()`, which the subscription makes unnecessary. Unsubscribe when the tab is hidden.
- [x] 2.3 Reset the state to `unverified` from the `onChange` handler of all three inputs. Do not start a check.

## 3. Opening the settings tab

- [x] 3.1 Add a helper that opens this plugin's settings tab, guarding `setting.open` and `setting.openTabById` independently before calling either, and addressing the tab by the manifest `id`. On either being missing, show the `Notice` "Open Settings, then choose Docs Publisher under Community plugins."
- [x] 3.2 Confirm the guard actually fires: temporarily stub the settings object away, click the panel's control, and see the notice rather than a button that does nothing. Undo the stub.

## 4. The panel renders the state

- [x] 4.1 Give `DocsPublisherView` the connection state, subscribe on open and unsubscribe on close, and re-render on change. Use the view's own component lifecycle for teardown so a check finishing after the view closes cannot write into a detached container.
- [x] 4.2 Render the header independently of the body: name the person whenever an identity is known, and add the "<role> access" line only when an access level was read.
- [x] 4.3 Render the four bodies — not connected, checking, connected, blocked — with the exact copy from the `plugin-shell` spec. Map `failed` and `verified`-without-access onto the same blocked layout, differing only in message and in how much of the header is present.
- [x] 4.4 Add the panel's own failure-message table. Do not import the settings tab's — the two differ deliberately, since the panel has no fields "above" to refer to.

## 5. Check it works

- [x] 5.1 `npm run build` compiles with no TypeScript errors, and the undocumented settings call is the only cast in the change.
- [x] 5.2 The closing demo, in one pass: open the panel on a fresh launch and see "Not connected yet"; click "Open settings" and land on this plugin's tab; fill in all three values; click "Test connection"; close settings; the panel now names you and your role literally, e.g. "Developer access".
- [x] 5.3 With that connection verified, edit one character of the address in settings — the panel returns to "Not connected yet" and no check runs.
- [x] 5.4 Enter a wrong project ID with a valid token and check: the panel names you but shows the project message. Enter a bad token: the panel names nobody and shows the expired-or-incorrect message.
- [x] 5.5 Restart Obsidian with the panel open — it shows "Not connected yet" again, and no file in the vault contains the token or the result.
