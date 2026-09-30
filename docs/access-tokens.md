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
  Confirmed: the target instance is GitLab Community Edition (CE), not
  Enterprise Edition — checked via the instance's Help/version page.
  VERSION CORRECTED 2026-09-22: that page reads **19.4.0**. This sentence
  said 19.3.0, and every document in this project inherited that number
  from here. The instance was most likely upgraded on GitLab's monthly
  cadence since the original check — which is the useful lesson, not the
  digit: the target version MOVES, so any finding recorded as "confirmed
  on CE 19.3.0" describes an instance that is no longer running. Record
  the date beside the version, and see `ce-verification.md` §0, which is
  now the authority for this row. The version matters because several decisions in
  this file turn on version-specific behaviour (`detailed_merge_status`
  from 15.6, fine-grained token enforcement from 18.11 and generally
  available on Self-Managed at 19.2) — 19.4.0 post-dates all of them,
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
  19.4.0, well past general availability, so early-beta partial
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
        continuous deployment), not the self-managed CE target
        instance, which is the one that actually matters — SaaS's
        fine-grained rollout is not guaranteed identical to
        Self-Managed. Rerun against the real instance when
        convenient; not required before platform-config ships. The rerun
        is now a written checklist — `docs/ce-verification.md` §A — which
        also carries every other gitlab.com-only finding in this file.
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
  OBSERVED PERMISSION NAMES, added 2026-09-09 while implementing
  fix-interrupted-submit. Item (b) above leaves exact permission
  selection to onboarding and says the setup guide will document it.
  This is the raw material for that guide: each name below is one
  GitLab named ITSELF in an `insufficient_granular_scope` refusal, not
  a name read off the token screen and assumed. Discovered by removing
  permissions one at a time and reading what the plugin reported.
    - `Merge Request: Read`   — reading whether a merge request is open
                                for a branch (the submit pre-flight)
    - `Merge Request: Create` — opening the merge request
    - `Branch: Delete`        — deleting an abandoned branch
  `Merge Request: Create` is separate from `Merge Request: Read`, and a
  token can hold either without the other — an author with Create but
  not Read submits successfully the first time and then cannot submit
  again, which reads as an intermittent fault rather than a missing
  checkbox. Worth stating explicitly in the guide.
  `Branch: Delete` is newly required as of fix-interrupted-submit and
  was needed by nothing before it. Any token issued before that change
  will lack it, and the failure surfaces only on a resubmit.
  Not yet mapped: the permissions covering branch READ and commit
  creation, both of which the tested tokens happened to hold throughout.
  ADDED 2026-09-11 while implementing add-document-status, which brought
  two new calls. Kept to the same standard as the three above — a name is
  only listed as observed when GitLab named it itself:
    - Listing the project's merge requests across all states
      (`GET /projects/:id/merge_requests?state=all`) is the SAME endpoint
      as the submit pre-flight, so it is covered by the already-observed
      `Merge Request: Read` and adds no new checkbox.
    - Reading a merge request's discussions
      (`GET /projects/:id/merge_requests/:iid/discussions`) is a NEW call
      and its permission is NOT OBSERVED. It was not exercised against a
      token missing it, so no refusal has ever named it. `Merge Request:
      Read` is the expectation, not a finding — the discussions endpoint
      is a sub-resource of the merge request and nothing suggests a
      separate permission, but that reasoning is exactly the kind this
      section exists to distrust. Confirm it the same way the three above
      were confirmed: remove permissions one at a time and read what the
      plugin reports.
  Consequence if that expectation is wrong: the document list's refresh
  fails for any document that carries comments, while documents with none
  resolve normally — an author would see most of their documents update
  and the discussed ones fail, which reads as intermittent rather than as
  a missing checkbox. The same trap `Merge Request: Create` versus
  `Merge Request: Read` sets, and worth the same explicit note in the
  setup guide.
  CAVEAT, the same one as (a): observed on gitlab.com, NOT on the
  self-managed CE target. The names are what CE should be checked
  against, not what it is known to use — `docs/ce-verification.md` §A3
  and §A4 are how to check them.
  ADDED while implementing add-document-recovery, which brought two more
  reads. NEITHER has ever been exercised against a token missing it, so
  neither name below is observed — both are expectations, kept to the
  same standard as A4 above:
    - Reading a file's raw content at a path and ref
      (`GET /projects/:id/repository/files/:file_path/raw`) — used by the
      submit path-collision pre-flight and by recovery's content fetch.
      Expected to be gated the same way `branchExists` is (repository
      content), but that repository-read permission has never itself been
      isolated — see A5 below, which this inherits rather than resolves.
    - Reading which path a merge request's commit changed
      (`GET /projects/:id/merge_requests/:iid/changes`) — used only by
      recovery's merge-request-fallback path lookup. Expected to be
      covered by the already-observed `Merge Request: Read`, being a
      sub-resource of the merge request exactly as the discussions read
      above is — same caveat: that reasoning is exactly what A4 exists to
      distrust, and this has the same gap.
  ALL FOUR EXPECTATIONS ABOVE ARE NOW CONFIRMED, 2026-09-22, on the target
  instance (CE 19.4.0) from a token narrowed to `Project: Read` alone. Each
  name below is one CE reported ITSELF in an `insufficient_granular_scope`
  refusal, which is the standard this section has always held:
    - discussions read            → `Merge Request: Read`  (as expected)
    - merge-request `/changes`    → `Merge Request: Read`  (as expected)
    - raw file read               → `Repository: Read`
    - repository tree             → `Repository: Read`
  The sub-resource reasoning this section twice flagged as "exactly the kind
  to distrust" was right both times. Recording that it was right is the point:
  the reasoning was still worth distrusting, because the two occasions it was
  wrong cost more than these four cost to check.
  Newly named at the same time, neither previously mapped anywhere:
    - `GET /user`                 → `User: Read`   — a USER-tab permission
    - `GET /projects/:id`         → `Project: Read`
    - branch read                 → `Branch: Read` — distinct from
      `Repository: Read`, so reading a branch and reading a file are two
      checkboxes, not one.
  `User: Read` deserves its own line in the setup guide: it is on the token
  screen's User tab rather than Group and project, so an author ticking
  project permissions carefully will still miss it — and `getCurrentUser` is
  the FIRST call "Test connection" makes, so the whole plugin fails at step
  one without it.

  READ-ONLY PASS AGAINST THE TARGET INSTANCE, 2026-09-22
  (`git.styl.solutions` / `ivan/service.doc.kb`, via
  `openspec/changes/archive/2026-09-29-verify-against-target-instance/probe.py`). What it
  settles, and what it pointedly does not:
    - SETTLED: the refusal BODY has the shape this project parses, on CE
      and not only on gitlab.com. `/api/v4/version` refused with
      `{"error":"insufficient_granular_scope","error_description":"Access
      denied: This operation requires a fine-grained personal access token
      with the following instance permissions: [Metadata: Read]."}` and
      `extractPermissionDetail` pulled `Metadata: Read` out of it. The
      author WOULD be shown which box to tick. Note CE says "instance
      permissions" where gitlab.com said "project permissions"; the parse
      reads the brackets and is indifferent.
    - SETTLED: the instance is CE — `/api/v4/license` answers 404, which
      EE serves.
    - NOT SETTLED, and item (a) above therefore stays open: EVERY
      permission name in this section is still gitlab.com-only. The run
      used an un-narrowed token on a MAINTAINER account, so every call
      succeeded and nothing was refused. A call that succeeds names no
      permission. Narrowing a token on a DEVELOPER account is the only
      instrument, and remains the outstanding work.
    - NOT SETTLED: the discussions read (A4), the raw file read (A6), the
      merge-request-changes read (A7) and the repository-tree read (E5)
      all returned 200, so all four expectations above are still
      expectations. `/merge_requests/:iid/changes` IS still served on this
      version, which retires the separate worry that it had been
      deprecated.

  DISCREPANCY WITH `docs/ce-verification.md` §0 — RESOLVED 2026-09-22,
  against this file. Help → Version reads CE **19.4.0**; the v19.3.0 above
  was stale, and every other document inherited it from here. Corrected in
  place at the top of this section. `ce-verification.md` §0 is now the
  authority for edition and version, and records the reading with its
  date — because the number moves and a dateless version is worse than no
  version. Nothing in this project's decisions turns on 19.3 versus 19.4.

## 2. The deprecation risk

- KNOWN DEPRECATION RISK on the credentials decision, and the failure
  mode is specifically rotation. Fine-grained tokens exist to replace
  the broad legacy scopes — `api` among them — with granular
  permissions scoped to particular groups and projects. Enforcement was
  introduced in 18.11 behind feature flags and became generally
  available on Self-Managed in 19.2. THIS INSTANCE IS 19.4.0, so it is
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
  AMENDED 2026-09-30 (persist-connection-settings, raised by that day's
  release-readiness review as a v1 blocker). The decision above is now
  narrowed to the TOKEN alone; the text above is kept as written, and this
  note governs where they differ:
    - `GL_HOST` and `GL_PROJECT` now PERSIST. They are written to
      `data.json` under an optional `connection: { host, projectId }` key
      when the author selects "Test connection" with all three fields
      filled in, as typed and whatever the check's outcome, and filled back
      into the settings tab at start-up. Neither is a credential: neither
      carries any authority on its own. The address does name an internal
      host, accepted as low sensitivity — `data.json` is already plaintext
      by the storage decision, and anyone who can read the vault can read
      the documents, which say more than the server's name.
    - `GL_TOKEN` is UNCHANGED: in memory for the session only, never
      written to `data.json` or any other file. This is enforced
      structurally, not by care — the saved shape (`SavedConnection`) has
      no field that could hold it, and `SubmissionStore.saveConnection`
      builds the object from the two named properties rather than
      spreading `ConnectionDetails`. A unit test asserts on the serialized
      output (`plugin/tests/connection-settings.test.ts`).
    - The daily burden is now ONE field, the token. "Connected as ..."
      must still be re-established once per launch: start-up with saved
      values begins not checked, and nothing checks automatically,
      because no token is present to check with.
    - `SubmissionStore` stays the only writer of `data.json`; see that
      change's design.md decision 1 for why a second writer was rejected.
  THE SPIKE BELOW IS DELIBERATELY LEFT OPEN, 2026-09-30, against its own
  "answer it when credential handling is next touched" instruction. Why:
  this change did not touch where the token is stored — it reads the
  token exactly as before and only stops re-asking for the two values
  that are not secret. The spike stays open, unassigned, and after v1.
  Recorded here so the deferral is a decision rather than an oversight.
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
