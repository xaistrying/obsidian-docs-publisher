## Why

The plugin shell loads and opens, but it cannot reach GitLab at all — nothing
downstream (creating documents, submitting for review, seeing status) can be
real until an author can hand the plugin a credential and get told, in plain
language, whether it works. This is also the first place a wrong or expired
credential can be caught cheaply, at the moment someone pastes it, rather than
surfacing later as an unexplained failure in the middle of submitting a
document.

## What Changes

- A settings tab for the plugin with three separate fields: the GitLab host,
  the project namespace path, and an access token.
- Credentials are held for the running session only. Nothing is written to
  plugin data, so restarting Obsidian clears them and they are pasted again.
  This is deliberate, not a limitation to fix later.
- A "Test connection" button that verifies the pasted values and reports back
  who the plugin connected as and what access that person has on the project.
- Guidance in the settings tab pointing authors at the fine-grained token
  flow, without enumerating exact permission checkboxes (those are assigned
  per member during onboarding, outside the plugin).
- The first, deliberately minimal remote-access surface: an identity check and
  a project-role lookup, and the rule that every other part of the plugin goes
  through it rather than making its own calls.
- A single shared failure message for expired or rejected access — "Your
  access has expired — ask your admin to set it up again" — pointing at the
  settings tab, established here because every later capability will reuse it.

## Capabilities

### New Capabilities
- `platform-config`: the settings tab, session-scoped credential handling,
  the connection check and how its result and failures are presented to the
  author.
- `git-publishing`: the remote-access surface. Only the two reads this change
  actually needs (identity, project role) plus the boundary rule that nothing
  outside this capability performs remote calls. Deliberately narrow — this is
  the floor, not the finished client.

### Modified Capabilities
None. `plugin-shell` is unchanged: its view, ribbon icon, command, and
single-panel behavior all keep working exactly as specified, and this change
adds a settings tab alongside them rather than altering them.

## Impact

- `plugin/src/main.ts` gains a settings tab registration; the existing view,
  ribbon icon, and command activation path are untouched.
- New source files for the settings tab and the remote-access client, keeping
  the boundary between them explicit rather than inlining calls in the tab.
- No new runtime dependencies. Remote calls use Obsidian's own `requestUrl`
  rather than `fetch`, since a self-managed GitLab does not send permissive
  CORS headers and `fetch` would fail there while appearing to work against
  gitlab.com.
- No change to `data.json`, `.gitignore`, or the manifest. Nothing new is
  persisted by this change.

### Deferred to later proposals
- Creating documents, front matter, and templates (`doc-authoring`).
- Submitting, updating, listing, or merging anything — every write operation
  and the merge-request reads (milestones 4-7).
- Persisting submission state (`submission-tracking`).
- The protected-branch "allowed to merge" lookup. This change reads the
  author's own project role only; comparing that against what the protected
  branch permits belongs to the review-and-merge milestone.
- Token expiry length and the rotation runbook — an operational decision, not
  plugin behavior.
- Re-running the fine-grained token check against the self-managed target
  instance. Confirmed on gitlab.com; explicitly not blocking this change.
