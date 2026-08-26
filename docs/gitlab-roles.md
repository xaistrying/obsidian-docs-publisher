# GitLab roles, and what they mean for this plugin

Reference for how GitLab's access levels map onto the actions Docs Publisher
performs. Written against the target instance: **GitLab Community Edition
(CE) 19.3.0, self-managed**, project visibility **private**. Facts that
depend on either of those are marked.

Verified 2026-08-26 against <https://docs.gitlab.com/user/permissions/>.

---

## 1. Role is not permission

"Test connection" reads the author's **project role**. That is one of three
independent gates, and it is the weakest of the three.

| # | Gate | Readable via API? | Answers |
|---|------|-------------------|---------|
| 1 | **Project role** (`access_level`) | Yes — `GET /projects/:id` → `permissions` | "could this *person* do it, in theory" |
| 2 | **Credential permissions** (fine-grained) | **No API exists** | "can this *credential* do it, in practice" |
| 3 | **Protected branch** (`Allowed to merge`) | Yes — `GET /projects/:id/protected_branches/main` | "may this level publish" |

All three must pass for an action to succeed. Consequences:

- **Gate 2 cannot be introspected at all.** GitLab has no endpoint that
  lists which permission checkboxes a fine-grained credential was created
  with. It is only ever discovered by attempting the operation. A
  Maintainer holding a read-only credential reports "Maintainer access"
  and still fails to submit.
- **Therefore role-derived UI is optimistic, never authoritative.** It may
  decide which sections of the panel *exist*. It may never be treated as
  proof that a call will succeed. Every action must still fail gracefully.
- **Gate 3 is the only real control on the publish action**, and it is a
  separate call that `Test connection` does not make. See §5.

---

## 2. The access levels

`GET /projects/:id` returns `permissions.project_access.access_level` and
`permissions.group_access.access_level`; either may be absent. The
effective level is the higher of whichever are present.

| Level | Role | Available on CE? |
|------:|------|------------------|
| 0 | No access | — |
| 5 | Minimal Access | **No** — Premium/Ultimate only. Cannot occur here. |
| 10 | Guest | Yes |
| 15 | Planner | Yes — introduced in GitLab 17.7 |
| 20 | Reporter | Yes |
| 30 | Developer | Yes |
| 40 | Maintainer | Yes |
| 50 | Owner | Yes |

**`null` is a real, non-error outcome.** The project is reachable but
carries no role for this account — a public project, or an instance
administrator reaching it without membership. It is not a failure and must
not be reported as one; it means the same thing as level 0 for our
purposes.

---

## 3. What each role can do, for the operations this plugin performs

Private project, self-managed CE.

| Level | Role | View code | See review queue | Submit | Publish |
|------:|------|:---------:|:----------------:|:------:|:-------:|
| 0 | none | ✗ | ✗ | ✗ | ✗ |
| 10 | Guest | ✗ | ✗ <sup>1</sup> | ✗ | ✗ |
| 15 | Planner | ✓ <sup>2</sup> | ✓ | ✗ | ✗ |
| 20 | Reporter | ✓ | ✓ | ✗ | ✗ |
| 30 | Developer | ✓ | ✓ | ✓ | ✗ <sup>3</sup> |
| 40 | Maintainer | ✓ | ✓ | ✓ | ✓ <sup>3</sup> |
| 50 | Owner | ✓ | ✓ | ✓ | ✓ <sup>3</sup> |

<sup>1</sup> Guests cannot view merge requests in a **private** project on
self-managed GitLab. They can on public and internal projects. Since this
project is private, a Guest sees nothing at all.

<sup>2</sup> Planner gained repository code viewing in **18.7**. The target
instance is 19.3.0, so this holds. On an older instance it would not.

<sup>3</sup> **Default only, and defaults are not guarantees.** See §5.

Mapping to internal operations: "Submit" is create-branch + commit +
create-merge-request, which requires push to a *non-protected* branch —
Developer is the floor. "Publish" is merge into protected `main`.

---

## 4. The three bands

```
  0 ──── 10  │  15 ──── 20  │  30 ──── 40 ──── 50
  ───────────┼──────────────┼─────────────────────
    LOCKED   │  READ-ONLY   │       AUTHOR
             │              │        └─ + REVIEWER at 40+
   sees      │ sees queue,  │ sees queue + own documents,
   nothing   │ can comment  │ can submit
```

- **LOCKED** — levels 0, 10, and `null`. Connected successfully and still
  cannot see anything. Distinct from a *failed* connection: the next
  action is "ask your admin for access", not "check your details".
- **READ-ONLY** — levels 15 and 20. Can read published documents and the
  review queue, and can comment. Cannot submit.
- **AUTHOR** — level 30 and above. Everything read-only can do, plus
  submitting and sending updates.
- **REVIEWER** — level 40 and above *by default*, but this band is
  provisional and must be confirmed by gate 3, not assumed from the level.

**These bands are additive, not exclusive.** A Maintainer is a Developer
plus more. On this team the L2 both authors and reviews, so the panel must
render capability sections independently rather than switching between
per-role layouts.

---

## 5. Why publish is different

The default for a protected default branch is **Allowed to merge:
Maintainers**, and **Allowed to push: Maintainers**. Both are freely
configurable per project — a project may allow Developers to merge, or
restrict merging to a named user.

The plugin therefore **must never infer publish rights from the access
level**. It reads `GET /projects/:id/protected_branches/main` and checks
the author's own level against the returned `merge_access_levels`. This is
recorded as an architecture decision in `openspec/config.yaml` and is
scheduled for milestone 7; `Test connection` deliberately does not make
this call today.

**Self-merge is a separate concern and CE cannot enforce it.** Approval
rules are Premium-and-above, so nothing server-side prevents whoever holds
merge rights from publishing their own document. If the plugin declines to
offer Publish on a document the current user authored, that check is the
only one that exists anywhere in the system — it is load-bearing despite
living in the UI, and must not later be removed as redundant with GitLab.
The governance question of whether to make that check at all is still
open.

---

## 6. Staleness

The role is a point-in-time snapshot taken when the author last pressed
"Test connection". It goes stale when:

- the credential expires mid-session — the credentials model uses short
  expiry, so this is routine, not an edge case;
- an admin changes the person's role or the protected-branch settings;
- the credential is revoked.

Rule: **a 401 from any call anywhere in the plugin invalidates the cached
connection state** and returns the panel to its failed state, pointing at
the settings tab. Without this, the panel keeps advertising capabilities
the credential lost an hour ago.

---

## 7. Vocabulary

**DECIDED (2026-08-26): role names are shown literally, everywhere.** The
settings tab and the sidebar panel both say "Developer access", not a
translation like "Can submit".

Considered and rejected: translating the role in the panel while keeping it
literal in the settings tab. The argument for translating was the product
thesis — GitLab role names are jargon authors never learn. The argument
against won on two counts, and both are about the same word meaning one
thing:

- A translation would have to be **invented per band**, and the bands are
  provisional. "Can submit" is a claim the plugin cannot actually back:
  gate 2 may still refuse. A role name claims nothing, so it cannot lie.
- Someone whose access is wrong has to **relay it to an admin**, and the
  admin's word for it is the only one that resolves the conversation. If
  the panel and the settings tab disagree on what to call the same thing,
  that hand-off gets harder for no gain.

Consequence: a reader who does not know what "Developer" means must be able
to find out from the surrounding copy, not from the word itself. The
message beside a blocked role therefore says what to *do* ("ask your admin
for access") rather than relying on the role name to convey it.

Note this is narrower than it looks — it settles what to call the *role*.
It does not settle whether git vocabulary (branch, commit, merge) is
allowed in action labels; see the specs vocabulary rule in
`openspec/config.yaml`.
