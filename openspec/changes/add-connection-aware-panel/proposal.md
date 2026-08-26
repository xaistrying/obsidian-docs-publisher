## Why

The connection check currently proves who the plugin connected as and then
throws that away — the result is written into a `<div>` in the settings tab
and is unreachable from anywhere else. The sidebar panel, which is the
surface every author actually works in, cannot tell whether the plugin is
connected at all, so it shows the same fixed placeholder text whether the
author is ready to work or has entered nothing.

That gap blocks every milestone that follows. Nothing can decide what to
offer an author until something knows whether there is a connection and what
access it carries. Because credentials are session-scoped by design, the
not-connected state is not an edge case — it is what every author sees on
every launch, permanently, and it currently offers them no way forward.

## What Changes

- Add a session-scoped connection state, owned by `platform-config`, holding
  the outcome of the last connection check: its status, the identity read,
  and the access level on the configured project. Not persisted, consistent
  with the existing credentials decision.
- The state is observable. Interested surfaces subscribe and are notified
  when it changes, so a check started in the settings tab updates the
  sidebar panel without either knowing about the other.
- Rewrite the settings tab to publish its result into that state rather than
  own a local string. It keeps the "Test connection" trigger and renders its
  own line from the shared state, so it becomes a reader that also happens
  to hold the trigger.
- Editing any of the three connection fields resets the state to unverified,
  so a verified identity can never be displayed alongside details it was not
  verified against.
- The sidebar panel renders four states from that state: not connected,
  checking, connected, and blocked. **BREAKING** for `plugin-shell`'s
  placeholder-content requirement, which this replaces.
- The panel's not-connected and blocked states offer a control that opens the
  plugin's settings tab, with a fallback message when that is unavailable.
- Access levels are reported using GitLab's own role names, on every surface.

Deferred to later proposals, deliberately and not by oversight:

- Any action the panel might offer once connected — creating a document,
  submitting, sending updates, the review queue, and publishing. The
  connected state shows identity and access only. No inert buttons are added
  ahead of the work behind them.
- Reading the protected branch's merge permissions. Publish rights are not
  inferred from the access level and this change does not read them at all;
  that is milestone 7's call to add.
- Checking the connection automatically when the panel opens. This change
  keeps the existing rule that a check runs only when the author asks for
  one. If details are present but unverified, the panel reports not
  connected, because from the author's point of view they have not connected.
- Invalidating the state on a rejected credential encountered outside the
  connection check. The rule belongs with the first action that can hit one,
  and no such action exists yet.
- Persisting credentials via Obsidian's `secretStorage`, recorded as an open
  spike against the credentials decision in `openspec/config.yaml`.

## Capabilities

### New Capabilities

None. This change adds no capability; it connects two that already exist.

### Modified Capabilities

- `platform-config`: the connection check's result is retained as observable
  session state rather than discarded after rendering, and is readable by
  other surfaces. Adds requirements for resetting that state when the
  details change, for reporting access using GitLab's role names, and for
  opening the settings tab from elsewhere in the plugin.
- `plugin-shell`: the sidebar view's requirement to show fixed placeholder
  content is replaced by a requirement to render the current connection
  state, including a route back to the settings tab when there is nothing to
  show.

## Impact

- `plugin/src/platform-config/` — new connection-state module; `settings-tab.ts`
  rewritten to publish into it instead of holding `statusEl`/`checking` state
  locally; `connection.ts` gains the reset-on-edit path.
- `plugin/src/main.ts` — `DocsPublisherView` gains a constructor dependency on
  the connection state, subscribes on open and unsubscribes on close, and
  renders per state instead of fixed text.
- `plugin/src/git-publishing/` — unchanged. No new remote calls are added and
  the capability boundary is untouched.
- Opening the settings tab programmatically has no public Obsidian API.
  Verified against the `obsidian@1.13.1` typings this project builds on:
  `App` exposes no `setting` member, and no `commands` member either. The
  call therefore requires a cast to an undocumented surface, which can break
  silently on an Obsidian update with no typing error to warn us. Because
  this control is the only exit from the panel's most-seen state, the
  fallback is load-bearing rather than defensive.
- No new dependencies. No change to `manifest.json`, including
  `minAppVersion`.
- No credential reaches disk; the new state is memory-only like the details
  it describes.
