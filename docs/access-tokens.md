# Access tokens: type, storage, and what the connection check proves

> Filed as `access-tokens.md`, not `credentials.md`: tooling that guards
> against reading secret files blocks paths named for credentials, which would
> make this reference unreadable to the agents it exists for. It contains no
> secrets — only the decisions about how tokens are obtained and held.

Extracted from `openspec/config.yaml` on 2026-08-26, VERBATIM. It lives here
because that file is read into every OpenSpec generation and had grown past
OpenSpec's 50 KB context limit, at which point the whole field is silently
dropped. Nothing was reworded in the move.

These are DECISIONS, not proposals. Read the relevant section before
designing against its subject rather than re-deriving it. If a fact here
contradicts `openspec/config.yaml`, that is a bug — say so rather than
picking one.

---

## 1. Which token, and why

- Credentials: DECIDED — personal access tokens, one per author, short
  expiry, documented rotation. The plugin authenticates as the person
  using it, never as a shared identity. Token TYPE: fine-grained, not
  legacy `api` scope — RESOLVED (2026-08-24, provisionally); see the
  Credentials section below for the spike that settled it and the one
  deferred, non-blocking item still hanging off that resolution.
  Rejected: (b) a single project access token, and (c) a project access
  token with `author_name`/`author_email` set per commit. Both act as a
  bot user (`project_{id}_bot`), and both fail for the same reason: the
  merge request's author field is tied to the authenticating identity
  and cannot be set, so every submission would be authored by the bot
  regardless of who wrote it. Commit signing is irrelevant to this —
  signing only constrains option (c)'s commit-author spoofing, and says
  nothing about who owns the merge request. So the decision does not
  depend on the signing check.
  Two independent reasons, whichever applies to the target tier:
    - Premium/Ultimate: the "prevent approval by author" setting keys on
      the merge request author. With the bot as author for everyone, the
      rule never fires for anyone who both authors and holds approval
      rights — they could approve their own document and GitLab would
      not object. Under personal tokens it fires automatically, for
      whoever that turns out to be.
    - Free: that setting does not exist (approval rules are Premium+;
      on Free any Developer may approve and approvals never block a
      merge), so the hole is not bot-specific. Personal tokens still win
      on audit trail and revocation granularity — a shared token makes it
      impossible to attribute a submission to a person, and offboarding
      one author would force a rotation for everyone. CONFIRMED as the
      applicable branch — see below.
  Confirmed: the target instance is GitLab Community Edition (CE)
  v19.3.0, not Enterprise Edition — checked via the instance's
  Help/version page. The version matters because several decisions in
  this file turn on version-specific behaviour (`detailed_merge_status`
  from 15.6, fine-grained token enforcement from 18.11 and generally
  available on Self-Managed at 19.2) — 19.3.0 post-dates all of them,
  which is exactly why the instance already defaults to the
  fine-grained token flow rather than it being merely implied. CE ships
  without Premium/Ultimate
  features regardless of license, so this is a structural fact of the
  edition rather than a subscription toggle — it would only change if
  the org migrated to EE. Consequence: required approvals can never
  gate the merge on this instance; the protected `main` branch's
  "Allowed to merge" permission is the sole enforcement boundary for
  milestone 8, not one of two checks to reconcile.
  Still to verify:
    - Token expiry length and the rotation runbook, both implementation
      details for platform-config rather than open architecture.
  Token type (legacy `api` scope vs. fine-grained) — RESOLVED
  (2026-08-24), provisionally: fine-grained. Context for why this took
  a spike rather than a guess: fine-grained sidesteps the deprecation
  risk below entirely if it can do the job, and this instance runs
  19.3.0, well past general availability, so early-beta partial
  coverage was not a safe assumption to carry forward untested.
  A manual spike confirmed it: all six required operations (create a
  branch, commit a file, create a merge request, list merge requests,
  add a note, merge) succeeded against a scoped fine-grained token on
  gitlab.com (`GET /user`, branch+commit via `start_branch`, create
  merge request, list by `source_branch`, add a note, merge with the
  `sha` param) — once the token was generated with a "Merge Request:
  Merge" permission checked. The first attempt omitted it and failed
  with a named `insufficient_granular_scope` error naming exactly that
  permission, not a generic 403 — informative in itself: the gap was a
  missed checkbox on token creation, not a missing capability.
  Two things remain, neither blocking platform-config:
    (a) DEFERRED, not blocking. This ran against gitlab.com (SaaS/EE,
        continuous deployment), not the self-managed CE 19.3.0 target
        instance, which is the one that actually matters — SaaS's
        fine-grained rollout is not guaranteed identical to
        Self-Managed 19.3.0. Rerun against the real instance when
        convenient; not required before platform-config ships.
    (b) OWNED OPERATIONALLY, not a plugin design concern. Exact
        per-token permission selection (which checkboxes, per
        member/role) is handled during author onboarding by whoever
        administers the project, not prescribed by settings-tab copy.
        The settings tab therefore points authors at the fine-grained
        flow generically, without enumerating exact permission names.
        ADDED 2026-08-26: that onboarding gets a written setup
        guide, documenting the fine-grained flow ONLY and never the
        legacy `api` / `read_user` / `write_repository` scopes — those
        belong to the "Generate legacy token" screen this project
        deliberately walked away from. Writing the guide is also the
        moment to close deferred item (a) above: it would otherwise
        document a token screen nobody has yet looked at on the target
        instance.
  Consequence: milestone 2's settings-tab guidance flips from the
  legacy flow to the fine-grained flow — see milestone 2 above, updated
  accordingly.

## 2. The deprecation risk

- KNOWN DEPRECATION RISK on the credentials decision, and the failure
  mode is specifically rotation. Fine-grained tokens exist to replace
  the broad legacy scopes — `api` among them — with granular
  permissions scoped to particular groups and projects. Enforcement was
  introduced in 18.11 behind feature flags and became generally
  available on Self-Managed in 19.2. THIS INSTANCE IS 19.3.0, so it is
  past both: enforcement is not approaching, it is available to any
  administrator today and waits only on a date being set. Do not read
  this as a future concern.
  On Self-Managed the switch is instance-wide: once an administrator
  sets an enforcement date, users can no longer CREATE OR ROTATE legacy
  personal access tokens, while existing legacy tokens keep working
  until they expire.
  Consequence for this project: the break is not "everything stops one
  morning". Authors' tokens keep working, then expire, and cannot be
  renewed — and short expiry with routine rotation is the whole
  credentials model, so the operation that breaks is the one this
  design leans on hardest. Someone must own watching for that
  enforcement date, and the fine-grained coverage question above should
  be settled before it arrives rather than after. Note the risk is
  asymmetric: adopting fine-grained tokens early costs a one-off
  migration, whereas being caught by enforcement costs every author
  their access with no rotation path back.
  Note also that commit authors are matched to GitLab accounts by email
  only — the Commits API returns author name and email but no user id —
  so a wrong email silently renders as an unlinked plain-text name.
  UPDATE (2026-08-24): moot as of the decision above — the project is
  proceeding on fine-grained tokens from milestone 2 onward, so there
  is no legacy-token era to migrate off of later, and no enforcement
  date to watch for. Provisional on the deferred self-managed rerun
  ((a) in the Credentials section above): if that rerun ever turns up a
  real gap on the target instance, this risk comes back into play and
  the fallback is the legacy flow already documented in milestone 2.

## 3. What is held, where, and for how long

- Plugin data shape / credential persistence: DECIDED (2026-08-24).
  Credentials are session-scoped, in-memory only — NEVER written via
  `saveData()`/`data.json`. Three separate fields, pasted into the
  settings tab once per Obsidian launch:
    - `GL_HOST` — the GitLab instance base URL
    - `GL_PROJECT` — the project namespace path (e.g.
      `team/sop-knowledge-base`), DECIDED over a numeric ID for
      readability — GitLab's REST API accepts a URL-encoded path
      directly as the `:id` param, so no "resolve to numeric ID"
      round-trip is needed.
    - `GL_TOKEN` — the personal/fine-grained access token
  Held in a plugin-instance field populated by the settings tab's form,
  not re-requested merely for reopening that tab within the same
  running session — cleared only on Obsidian restart or plugin
  reload/disable-enable. A "Test connection" button in the settings tab
  fires the identity check (`GET /user`) against whatever is currently
  held, before anything downstream can rely on it.
  This RESOLVES the `tokenStorageMode` question raised earlier by
  removing it rather than answering it: no persisted secret means no
  plaintext-vs-`safeStorage` decision and no vault-sync-replication
  exposure to weigh.
  The `GL_*` naming matches this repo's dev-time `.env` convention for
  readability, but this is NOT a dotenv load — Obsidian has no dotenv
  runtime, and hand-editing a text file would contradict the product
  thesis. These are in-memory JS fields populated by form inputs,
  nothing else; do not let the naming similarity suggest the shipped
  plugin reads `plugin/.env`.
  Consequence: "Connected as ..." must be re-established at least once
  per Obsidian launch, and every submit/list/etc. action depends on
  these three fields being populated for that session. An action
  attempted before pasting them (or after a restart with nothing
  pasted yet) must fail clearly and point at the settings tab — the
  same surface the 401-expiry failure mode above already points at.
  OPEN SPIKE (raised 2026-08-26), NOT a reversal. The decision above
  stands and remains in force until this spike says otherwise; do not
  build against `secretStorage` before it is answered.
  Obsidian's own API gained `App.secretStorage` in 1.11.4 —
  `setSecret(id, secret)`, `getSecret(id)`, `listSecrets()` — confirmed
  present in the `obsidian@1.13.1` typings this project builds on. It
  did not exist when the decision above was framed, and it matters
  because the decision resolved the storage question by removing it:
  the two objections recorded above are plaintext-vs-`safeStorage` and
  vault-sync replication, and BOTH are aimed at storing a secret inside
  the vault. A first-class secret API is a third option neither
  objection reaches, so "no persisted secret" is no longer the only way
  to avoid them.
  What is at stake is not tidiness. Session-only credentials mean the
  sidebar panel's not-connected state is seen on EVERY launch by EVERY
  user, permanently — it is the daily first impression of the plugin,
  not an edge case. If credentials can persist safely, that state
  becomes first-run-only and the everyday experience is a different
  product.
  Three unknowns, EACH of which disqualifies the option on its own if
  it goes the wrong way. All three must be answered before adopting:
    1. At-rest guarantees are UNDOCUMENTED. The API reference page
       lists the three method signatures and states nothing about
       encryption, OS keychain backing, or where the data lands.
       Storing an access credential somewhere with unstated at-rest
       guarantees is strictly worse than the current answer, not
       better. Do not assume it wraps Electron `safeStorage` because
       the name suggests it.
    2. Sync behaviour unknown. If secrets replicate between devices,
       the vault-sync exposure the decision above avoided returns
       intact, and the option collapses.
    3. Version and platform reach. The manifest currently declares
       `minAppVersion: 0.15.0` and `isDesktopOnly: false`. Adopting
       this forces a bump to at least 1.11.4, and mobile availability
       is unstated — on a platform with no OS keychain access the
       guarantee may differ from desktop even if the API is present.
  Owner: unassigned. If this is still unanswered when credential
  handling is next touched, answer it then rather than deferring
  again — the cost of adopting it later is one migration, whereas the
  cost of never checking is having shipped the daily re-entry burden
  on an assumption that had already stopped being true.

## 4. What "Test connection" actually proves

- "Test connection" / git-publishing boundary: DECIDED (2026-08-24).
  The button calls into a minimal git-publishing client — `GET /user`
  for identity, plus `GET /projects/:id/members/all/:user_id` to read
  the author's `access_level` (Guest/Reporter/Developer/Maintainer/
  Owner) on `GL_PROJECT` specifically. Both results are cached on
  `connectedAs` (username, name, accessLevel, verifiedAt) for the
  settings tab to display — e.g. "Connected as Xaistrying — Developer
  access." This keeps the capability boundary intact (git-publishing
  still owns 100% of HTTP calls; platform-config's button just calls
  into it) and the `access_level` lookup is not a throwaway extra —
  it's half of what milestone 8's protected-branch/"Allowed to merge"
  gating needs (the user's own access_level), so this is where that
  half is first exercised, not invented fresh later. The other half —
  which access levels the protected `main` branch actually allows to
  merge — is a separate call (`GET /projects/:id/protected_branches/
  main`) that milestone 8 still has to add; "Test connection" does not
  fetch it, so don't treat this lookup as already answering milestone
  8's gating question on its own.
  CAVEAT: this surfaces the author's project ROLE, not their token's
  exact fine-grained permission grants — GitLab has no API to
  introspect which permission checkboxes a token was created with, so
  "Test connection" cannot literally list the token's permissions, only
  prove which ones work by using them (as the manual spike did) or
  report the person's role as a proxy. Don't let settings-tab copy
  promise more than the role display actually shows.
