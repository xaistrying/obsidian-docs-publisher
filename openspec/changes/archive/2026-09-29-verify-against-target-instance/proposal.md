## Why

The plugin is feature-complete for its release scope: it typechecks, builds,
and passes 101 tests. What it has never done is run against the instance and
the account it was built for.

Everything in `docs/ce-verification.md` §§A–D was established on
**gitlab.com — SaaS, Enterprise Edition — as an Owner or Maintainer**. The
target is **self-managed Community Edition 19.3.0**, and the authors are L1/L2
staff holding **Developer**. That file's own §0 states plainly that evidence
does not transfer in that direction, and it opens by naming two assumptions
this project already got wrong exactly that way:

- the `insufficient_granular_scope` error body did not have the shape the code
  parsed, so the author never saw which permission to ask for; and
- reads turned out to be scope-gated at all, which the code had assumed they
  were not.

Both were found by running against a real instance, not by reading docs.

§E was run on 2026-09-14 and covers merge rights, the corpus front matter, and
a handful of tree/import findings. **§§A–D — 26 of the 34 items — have never
been rerun.** §0's own instance table still records edition and version as
unconfirmed, so even "self-managed CE 19.3.0" is assumed rather than observed.

This is the last thing standing between the plugin and a release its users can
trust.

## What Changes

**This is a verification pass, not a feature.** Its deliverable is recorded
results. If every item passes, this change ships documentation and nothing
else, and that is a success — the point is to find out, not to build.

- **The instance is identified.** Edition and exact version, from Help →
  Version and from `/api/v4/version` where readable, written into §0's table.
- **§§A–D are run** against the real corpus project: token type and permission
  names (A1–A8), response shapes the client parses (B1–B11), the
  changes-requested mechanism (C1–C2), and the end-to-end checks in the
  running plugin (D1–D9).
- **Run as Developer, not Owner.** The access-floor decision puts creating and
  submitting at Developer (30), and §E1 confirmed merging needs Maintainer on
  this project. An Owner-level run cannot answer the only question that
  matters for release: can an L1/L2 actually submit a document?
- **The minimum token permission set is established empirically**, by
  narrowing a fine-grained token until calls start failing and reading what
  GitLab names. `docs/access-tokens.md` §1 records that no endpoint lists a
  token's permissions, so attempting the call is the only way to learn the
  requirement.
- **Results are recorded** per `docs/ce-verification.md`'s own "Recording what
  you find" rule: a confirmed assumption has its caveat struck and the
  instance and date noted; a contradicted one has the observed status, body
  and field values written down, not merely "it differed".
- **Bugs the run surfaces are fixed here if small**, and recorded as their own
  milestone if not. Which of those applies is not knowable before the run.

### The over-granted token, as a concrete target

The token in use carries 17 group/project permissions. Mapping them against
every endpoint the client actually calls, at least five are never exercised:
`Work Item: Create`, `Merge Request Approval Rule: Read`, `Protected Tag:
Read`, `Repository Tag: Read`, and `Protected Branch: Read` — the last
belonging to milestone 8, which is not built. `Commit: Update` and `Branch:
Create` also look unnecessary: the plugin only POSTs commits, and creates
branches through the commits API's `start_branch` rather than the branches
API.

None of that is confirmed, which is the point. The run replaces a guess with
an observed list that onboarding can tell an author to tick, in place of the
settings tab's current generic "use the fine-grained flow".

### Deliberately exercised, because they are newer than the checklist

- The **repository-tree read's permission name** (§E5) — never observed at
  all.
- The **multi-action commit** with mixed create/update verbs, per-action
  `last_commit_id`, and base64 binary content (B9–B11) — confirmed on
  gitlab.com only.
- **Token expiry**: milestone 2 requires a 401 anywhere to surface as "Your
  access has expired" pointing at the settings tab. Never exercised against a
  token that actually expired.

## Deferred, deliberately

- **Milestone 8 (Merge).** §E1 established that authors hold Developer and
  merging needs Maintainer, so it would ship a control they never see.
- **Milestone 3a** (default directory) and any other new feature.
- **Release packaging** — the zip and GitHub release — which is the author's
  own, handled outside this change.
- **Fixing a large bug this run surfaces.** It gets a milestone, not a rushed
  patch inside a verification pass.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None expected. This change alters no requirement: it establishes whether the
requirements already written are true against the target instance. Should the
run contradict a spec — a permission classified wrongly, a response shape the
client misparses — that spec's delta is written then, as part of the fix, and
this section is corrected to name it.

## Impact

- `docs/ce-verification.md` — §0's instance table, and every §§A–D item that
  the run confirms or contradicts. This is the primary deliverable.
- `docs/access-tokens.md` — §1's permission-name caveats, struck where
  observed.
- `plugin/src/platform-config/settings-tab.ts` — the onboarding copy, if the
  run produces a permission list concrete enough to name.
- `plugin/src/git-publishing/gitlab-client.ts` — only if a classification or a
  parsed response shape turns out to be wrong on CE.
- `openspec/config.yaml` — whatever the run settles that the roadmap still
  carries as open.
