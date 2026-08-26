## Context

`ConnectionSettingTab.testConnection()` reads identity and project access,
renders a sentence into a `<div>` it owns, and keeps nothing. The result
lives in DOM belonging to a modal that is destroyed when the author closes
it. `DocsPublisherView` renders two fixed lines and has no way to learn
whether a connection exists.

Three constraints shape everything below:

- **Credentials are session-scoped by decision**, held in a plain field on
  the plugin instance and never persisted. Anything derived from them has
  the same lifetime and must not outlive a reload.
- **`git-publishing` owns every remote call and classifies every failure,
  but does not decide what the author is told.** This change adds no remote
  calls; it only stops discarding the answers to the two that already exist.
- **Obsidian's settings screen is a full-window modal.** A panel in the right
  sidebar is covered while the author is in settings, so any update the
  panel makes during a check is invisible until the modal closes.

## Goals / Non-Goals

**Goals:**

- One source of truth for "is the plugin connected, as whom, with what
  access", readable by any surface that needs it.
- A check started in the settings tab is reflected in the sidebar panel
  without the two referencing each other.
- The panel always offers a next action, including — especially — when it
  has nothing to show.
- Leave room for the actions later milestones will add, without adding
  placeholders for them now.

**Non-Goals:**

- Any action beyond opening the settings tab. The connected panel reports
  and offers nothing else.
- Reading protected-branch merge permissions, or deriving publish rights
  from an access level. Not read, not inferred, not stored.
- Automatically checking the connection. The existing rule — a check runs
  only when the author asks — is unchanged.
- Persisting anything. No `saveData()` call is added or moved.

## Decisions

### A shared state object with change listeners, over the alternatives

The settings tab writes; the panel reads. They must not know about each
other, because the panel must work when the settings tab has never been
constructed, and the settings tab must work when the panel is closed.

Alternatives considered:

- **Panel re-reads on open.** Simplest, and wrong for the actual scenario:
  the author fills in details with the panel already open, and expects it to
  be right when they close the settings modal. This would leave the panel
  stale until it was manually reopened.
- **Obsidian's workspace event bus.** Works, but publishes plugin-internal
  state onto a global channel other plugins can see and emit on, for no
  benefit at two subscribers.
- **Polling.** No.

Chosen: a small object holding the state, with `onChange(listener)` returning
an unsubscribe function. Roughly twenty lines — a `Set` of callbacks, a
setter that assigns and notifies.

This is the one place worth asking whether we are building speculative
generality for a four-person tool. The answer is that the alternative is not
"less machinery", it is "the panel is wrong until you reopen it", which is a
defect rather than a simplification. A listener set is the boring option
here, not the clever one.

### State is a discriminated union of four kinds; "no access" is not one of them

```
  unverified                                        → panel: not connected
  checking                                          → panel: checking
  verified  { identity, access }                    → panel: connected
  failed    { failure, identity: Identity | null }  → panel: blocked
```

"The author connected fine but their role grants them nothing" is
deliberately **not** a fifth kind. It is `verified` with an access level at
or below Guest, because the connection genuinely succeeded — the credential
is good and the project was reached. Modelling it as a failure would state
something untrue and would throw away the identity, which is exactly the
information that tells the author their credentials are fine and their
*role* is the problem.

This is what lets the panel's header and body be decided independently: the
header renders whenever an identity is known, the body renders from the kind
plus the access level. The blocked appearance is therefore reachable from
two different kinds, with different amounts of information, and that is
correct rather than a special case:

| Situation | Kind | Header | Body |
|---|---|---|---|
| Usable access | `verified`, level ≥ 15 | name + role | connected |
| Role grants nothing | `verified`, level ≤ 10 or null | name + role | blocked, ask admin |
| Project unreachable | `failed`, identity known | name only | blocked, check details |
| Credential rejected | `failed`, identity null | none | blocked, ask admin |

`null` access level is grouped with Guest, not treated as an error: it means
the project was reachable but carries no role for this account. See
`docs/gitlab-roles.md` §2. The threshold sits at 15 because Planner and
Reporter can at least read, per §3 of that document.

### State carries the failure kind, never the message

`git-publishing` already refuses to decide what the author is told, and the
same reasoning applies one level up: the settings tab and the panel need
*different words* for the same failure. The tab's existing copy says "Check
the project ID above", which is meaningless in a sidebar with no fields
above it.

So the state stores the `FailureKind` and each surface maps it to its own
copy. Two message tables, one per surface, neither in the state object.

### The settings tab becomes a reader that happens to hold the trigger

It keeps the "Test connection" button and the in-flight guard, but stops
owning the answer: it writes `checking`, then `verified` or `failed`, and
renders its own line from the state like any other subscriber. Its local
`checking` field goes away, since the state now carries that.

This also fixes an existing wrinkle for free — the tab currently rebuilds
its busy state by hand in `display()` when reopened mid-check. Rendering
from shared state makes that reconstruction unnecessary.

### Editing any field resets the state to unverified

`onChange` on the three inputs writes straight into the shared connection
details. Without a reset, an author can verify against one address, type a
different one, and leave the panel advertising an identity that was never
verified against what is now entered. The reset is unconditional and does
not re-check.

### Opening the settings tab is an undocumented call, so it is guarded

Verified against `obsidian@1.13.1`: `App` exposes no `setting` member and no
`commands` member. There is no public route. The call requires a cast, and
its failure mode is silence — no typing error, no exception, just a button
that does nothing.

That is tolerable on most buttons and not on this one, because it is the
only exit from the state every author sees on every launch. Both methods are
checked before use, and a `Notice` naming the manual path is shown when
either is missing. The tab is addressed by the manifest `id`, which project
decisions already pin as immutable.

### Role names are shown literally

"Developer access", not a translation like "Can submit". A translated label
would assert something the plugin cannot back — the credential's own
permissions are not introspectable, so any capability claim can be wrong.
A role name asserts nothing and therefore cannot lie. Recorded with the
rejected alternative in `docs/gitlab-roles.md` §7.

The consequence is that copy next to a role must say what to **do**, since
the word alone will not tell an author what it means.

## Risks / Trade-offs

- **The undocumented settings call breaks on an Obsidian update** → Both
  methods guarded; `Notice` fallback names the manual path. Degrades to an
  extra sentence, never a dead end.
- **State goes stale mid-session** — a credential expires, or an admin
  changes a role, and the panel keeps showing the last good answer → Not
  solved here. Invalidating on a rejected credential belongs with the first
  action that can encounter one, and none exists yet. Deferred explicitly in
  the proposal so it is not mistaken for an oversight.
- **The panel updates while hidden behind the settings modal** → Not a
  defect. The re-render is correct and simply unseen; the panel is right
  when the modal closes, which is when the author looks.
- **A listener set is more machinery than two readers strictly need** →
  Accepted, with the reasoning above: the cheaper options are wrong, not
  simpler.
- **`verified` with an unusable role looks like a failure to a reader of the
  code** → Mitigated by keeping the mapping table in this document and
  naming the threshold constant rather than writing a bare `>= 15`.
- **Two message tables could drift apart** → Accepted deliberately. They
  describe different surfaces and should differ; a shared table is what
  produced "Check the project ID above" appearing where there is nothing
  above.
