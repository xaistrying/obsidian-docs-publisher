## Why

Every author re-types all three connection values — GitLab address, project
ID and access token — on every Obsidian launch, so the panel's "Not connected
yet" state is the daily first impression of the plugin
(`docs/access-tokens.md` §3). Two of those three values are not secrets. The
address and the project ID are the same on every launch, carry no authority
on their own, and are what an author is most likely to mistype. Remembering
them cuts the daily step down to pasting one token. The security posture is
unchanged, because the token itself is still never written anywhere.

Raised by the 2026-09-30 release-readiness review as a v1 blocker. Decided
the same day: persist the address and project ID only, and keep the token
session-only.

## What Changes

- **What is remembered.** The GitLab address and project ID are saved to the
  plugin's own data file (`data.json`) and filled back into the settings tab
  when Obsidian starts.
- **When they are saved.** The two values are saved when the author selects
  "Test connection" with all three fields filled in, whatever the check's
  outcome. That is the moment the author commits to them. Saving on every
  keystroke would rewrite `data.json`, including every tracking record, once
  per character typed.
- **The token.** It stays session-only and is never written to `data.json`
  or any other file. The saved shape has no field that could hold it.
- **The connection check.** It is still required once per session before any
  write. A start-up with saved values begins in the not-checked state, and
  nothing checks automatically, because no token is present at start-up.
- **Copy.** The settings tab's intro and the panel's not-connected note are
  reworded so neither claims that all three values are re-entered after a
  restart.
- **Records.** The storage decision in `docs/access-tokens.md` §3 and
  `openspec/config.yaml`'s credentials entry are amended to say which values
  now persist and why. This is the explicit flag that config.yaml's "flag
  before persisting anything else" rule asks for.

### Deferred, deliberately

- **Token persistence, and the `secretStorage` spike
  (`docs/access-tokens.md` §3).** `docs/access-tokens.md` §3 says to answer
  that spike "when credential handling is next touched". This change does not
  touch where the token is stored. It reads the token exactly as before and
  only stops re-asking for the two values that are not secret. The spike
  stays open, unassigned, and after v1. The decision is recorded here so the
  deferral does not go unnoticed.
- **A "Forget these details" control.** Testing different values overwrites
  the saved ones, which covers switching projects. Add a control like this
  only if someone asks to clear the values without replacing them.
- **Checking automatically at start-up.** It cannot happen without a stored
  token.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `platform-config`: "Connection details are kept for the session only" is
  split. The access token stays session-only, and the address and project ID
  persist across restarts once tested. The settings tab's intro text changes
  to match.
- `plugin-shell`: the not-connected state's note "You enter these once each
  time you start Obsidian." is reworded to mention only the access token.

## Impact

- **Code:**
  - `plugin/src/submission-tracking/submission-store.ts`: the `data.json`
    shape gains an optional `connection: { host, projectId }`. This store
    stays the file's only writer.
  - `plugin/src/platform-config/settings-tab.ts`: saves on Test connection,
    and the intro copy changes.
  - `plugin/src/main.ts`: fills in the saved values at `onload`, and the
    panel note and a comment change.
  - `plugin/src/platform-config/connection.ts`: a comment changes.
- **Data:**
  - Existing `data.json` files load unchanged, since the new key is optional.
  - `data.json` sits inside the vault, so vault sync replicates the address
    and project ID along with the records it already holds. Neither value is
    a credential.
  - The address does name an internal host. This is accepted as low
    sensitivity: `data.json` is already plaintext by the storage decision.
    Anyone who can read the vault can read the documents themselves, which
    are more revealing than the server's name.
- **No new dependency.** No GitLab call is added or changed, and nothing in
  git-publishing is affected.
