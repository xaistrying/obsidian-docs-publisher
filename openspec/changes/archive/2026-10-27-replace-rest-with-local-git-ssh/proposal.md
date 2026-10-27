## Why

Every author-facing action today goes through GitLab's REST API with a personal
access token the author must create, paste again on every launch, and keep
alive. The plugin's real job — publish a note for review, bring in what
reviewers merged — is plain git: push a branch, fetch. Replacing the token and
REST client with the author's own SSH key and the local `git` binary removes
the daily re-entry, the role pre-checks, and ~4k lines of API plumbing, and it
adds what the REST design could never do: bring remote changes back into the
vault.

## What Changes

- **BREAKING** The plugin talks to GitLab only through `git` over SSH. No token, no
  REST call, no `requestUrl`. The vault holds a real `.git` folder (inside the
  vault; ignore rules in `.git/info/exclude`). This reverses the architecture
  decision "no local git binary, no `git init`, no SSH keys, no `.git` folder
  in the vault ever" and the NO CI PIPELINE objection that nothing pulls remote
  content back.
- **BREAKING** The plugin becomes desktop-only (`isDesktopOnly: true`); mobile
  authors lose it. The token-only REST submit path is removed, not kept as a
  fallback.
- **Setup checklist as the panel's first screen**, five steps: git installed →
  project address → SSH key (use an existing key, or create a dedicated
  `docs-publisher_ed25519`; copy it; open GitLab's key page; Test) → connect
  this vault → name and email → ready. Name and email come last because
  saving them writes the vault's own git settings, which need the repository
  that connecting creates; an author who already has a machine-wide identity
  never sees that step. The settings tab mirrors the same checklist. One
  "Project address" field replaces address + project ID + token.
- **Connect this vault**: `init` + `fetch` + `reset --mixed` against the default
  branch, which never touches a working file. Every difference becomes a
  per-note state the panel already knows how to show. A vault that is already a
  repository is adopted only if its origin is this project; otherwise the
  plugin refuses and changes nothing.
- **Publish** (one button): builds the commit for the note and its embedded
  images with git plumbing — the vault's working tree and index are never
  touched — pushes it to `doc/<doc_id>` with merge-request push options, and
  reports "Waiting for review". It opens a review request and never merges.
  Falls back to GitLab's printed link when no request appears.
- **Get updates** (git-pull semantics, one direction, never uploads): fetch,
  then apply the whole repository per file against the vault's last synced
  version — take theirs when the note is unchanged, do nothing when identical,
  auto-merge non-overlapping edits, and prompt in plain words (Keep mine / Use
  theirs / Keep both) only when edits overlap. A recoverable copy of the author's
  text is kept before any replacement. Never conflict markers, never a
  half-merged state, never `.obsidian/`.
  Plain `git pull` is not used: it aborts even when the note is byte-identical
  to the merged text.
- **Git is the database**: document state is derived from git, not stored. The
  plugin's data file stops being a record store.
- **Name and email**: Save writes `--local`; the field is prefilled from the
  effective value (local wins, machine-wide fills the gap). Advanced git
  settings rows (tick = set in this vault, untick = inherit, Back to default)
  arrive last.
- **Lost on purpose, recorded in one place** (design.md, "What this removes"):
  the "Changes requested" state; the Developer/Reporter role pre-check;
  reviewer Merge (milestone 8 — retired, reviewers merge in GitLab); Recover,
  Import and Discover (collapsed into Get updates); stored submission records.
- **Reverses a standing rule, on the record**: `openspec/config.yaml` (NO CI
  PIPELINE) says any implicit or whole-project pull must baseline on the last
  content submitted from this vault and refuse while a document is awaiting
  review. Get updates is author-triggered and decides per file, so the risk that
  rule guards — silent loss — is handled differently (design D9: take theirs
  only when the note is unchanged, keep a recoverable copy before any
  replacement, ask otherwise) and it does **not** refuse while a review is open.
- Housekeeping that must not be skipped: shrink `openspec/config.yaml`'s
  context block *first* (≈48.5 KB of parsed context against a 50 KB limit, about
  2.7 KB of headroom — going over silently drops the whole field), replace
  `docs/access-tokens.md`, mark the superseded reference docs, tag
  `pre-git-pivot` before deleting the REST code.

**Prerequisite:** the four open changes (`self-service-token-messages`,
`add-action-busy-states`, `show-reset-after-submit`, `guard-plugin-data`) must
be archived first. Their deltas add or modify requirements this change removes
or modifies; archiving in the other order makes this change's deltas fail to
apply.

## Why one change

The project rule is one minimal vertical slice per proposal. This is bundled on
purpose: the old and new paths share one first screen, one write gate
(`requireAuthoringGate`, 12 callers) and one connection state
(`ConnectionState`, 40 callers), so there is no seam where token-based Publish
and SSH Publish can both be live. Splitting would leave `main` between
proposals with a plugin that cannot publish, and would leave `openspec/specs/`
contradicting the code. The project already bundles when pieces share a seam
(`add-resubmission-lifecycle`). The risk is handled by ordering: the five task
groups each end in something a person can click. Spawning `git`/`ssh` from
Obsidian on a Windows machine is the one thing that could sink the rest; its
check was planned as a gate after group 1 and is run instead as part of the
whole-plugin test at the end (task 1.11, 5.7).

## Capabilities

### New Capabilities

- `vault-sync`: connecting a vault to the project (adopt without touching
  files), getting updates (git-pull semantics, per-file rule, auto-merge,
  plain-words conflict choices), what the plugin never writes (`.obsidian/`,
  `.git/`), and the invariant that the plugin never runs a git command that
  writes working-tree files.

### Modified Capabilities

- `git-publishing`: from "sole boundary for HTTP requests" to "sole boundary for
  `git`/`ssh` processes and the remote's address". Removes every REST
  requirement; adds hermetic process execution, typed failure classification
  (never raw stderr), working-tree-free commit building, push with
  review-request options, three-way reads from the fetched copy, SSH key
  creation/test.
- `platform-config`: from token + address + project ID to project address, SSH
  key, identity and the setup checklist's readiness state; the settings tab
  mirrors the checklist; no secret is stored by the plugin.
- `submission-tracking`: from stored records reconciled against merge requests
  to state derived from git, keyed by `doc_id` (Waiting for review / Published /
  Not accepted + an edited marker; "Not submitted yet" is unreachable and
  dropped). Removes records, recovery, discovery and project-scoping
  requirements.
- `plugin-shell`: the first screen becomes the setup checklist; the panel gains
  Get updates and "N updates available"; the Import, Discovery and Recovery
  sections go.
- `doc-authoring`: `owner:` comes from the key test; the connection/role gates
  become the readiness gate; Publish and resubmission are git-based; the
  first-submit path check is redefined so editing a pulled document works; Reset
  reads from the fetched branch; Import and Recovery requirements are removed.

## Deferred (not in this change)

- Background or automatic Get updates — manual, plus a fetch-only count on panel
  open.
- Switching a connected vault to a different project in place — refused with a
  plain message; use another vault.
- Passphrase-protected keys via an agent; pinned host-key fingerprints (the
  first connect accepts the host key, trade-off recorded in design.md).
- Listing edited notes that carry no `doc_id` (legacy documents) in "Needs you";
  Publish still works on the open note.
- Any platform other than GitLab (push options are GitLab-specific, which is why
  they stay inside `git-publishing`).
- A stage/commit/branch UI, and showing git history. Not goals.

## Impact

- **Code**: `plugin/src/git-publishing/` (1,579 lines) replaced by a git runner,
  publisher and syncer; `plugin/src/submission-tracking/` (1,830) mostly
  replaced by derivation from git; `plugin/src/platform-config/` (555)
  rewritten as setup; `plugin/src/doc-authoring/` (3,007) mostly kept —
  `submit-document`, `import-document`, `fetch-attachments`, `reset-document`
  and `create-document`'s owner source change; `plugin/src/main.ts` first screen
  and sections. About 4k of 8.9k lines are replaced, and the tests tied to them.
- **Specs**: delta specs across five capabilities (116 existing requirements,
  plus the four the open changes add); one new capability.
- **Packaging**: `manifest.json` (`isDesktopOnly`), `versions.json`,
  `plugin/install.sh` (keeps preserving `data.json`), `plugin/README.md` author
  guide for key setup.
- **Docs**: `openspec/config.yaml` (shrink first), `docs/access-tokens.md`
  (replaced), `docs/gitlab-roles.md`, `docs/ce-verification.md`,
  `docs/resubmission-lifecycle.md`, `docs/panel-tracking-scope.md` (marked
  superseded or updated).
- **Dependencies**: none added; requires `git` and an `ssh` client on the
  author's machine, detected and reported by the checklist.
- **Compatibility**: `doc/<doc_id>` branch names are unchanged, so reviews
  already open at cut-over survive. `data.json` is ignored, not deleted.
- **Unverified on the target instance** (each has a fallback and is exercised in
  groups 1 and 3): the push option opens the merge request; `ssh -T` prints the
  username line; `merge_request.create` is harmless when a request is already
  open.
