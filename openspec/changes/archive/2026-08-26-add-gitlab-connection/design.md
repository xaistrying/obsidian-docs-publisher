## Context

`plugin-shell` shipped a plugin that loads, registers one sidebar view, and
opens it from two entry points. It persists nothing and talks to nothing. This
change adds the first credential handling and the first remote calls in the
project, so several decisions made here set precedents every later milestone
inherits: where credentials live, who is allowed to make HTTP calls, and how a
rejected credential is described to an author.

Two constraints shape everything below. First, the capability boundary:
`git-publishing` owns all remote interaction, so the settings tab cannot call
GitLab itself even though it is the only thing that needs a call in this
milestone. Second, the product thesis: an author who pastes a bad token must
get a sentence they can act on, not an HTTP status.

## Goals / Non-Goals

**Goals:**
- A settings tab with three fields (host, project path, token) and one button
  that tells the author whether those values work.
- Credentials that exist only in memory for the running session, so there is
  no stored secret anywhere in the vault.
- A remote-access client that is the single place any HTTP call happens, with
  exactly two methods — enough to serve this milestone's button and no more.
- One shared way of classifying a failed call, so "expired access" reads the
  same here and in every later capability that reuses it.

**Non-Goals:**
- Any write operation. No branch, no commit, no merge request, nothing that
  changes state on the remote.
- Persisting credentials, or a "remember me" affordance. Deliberately absent.
- A general-purpose GitLab client. Two methods, both reads, both needed by the
  button that ships in this change.
- The protected-branch merge-permission lookup. This change reads the author's
  own role; the comparison against branch settings is a later milestone's work.
- Multi-platform abstraction. The client is GitLab-shaped because GitLab is
  the only platform; a second one is out of scope per the capability boundary,
  not merely deferred.

## Decisions

**Credentials live in a plugin-instance field, never in plugin data.**
The three values are held on the plugin object, populated by the settings tab's
inputs, and read from there by anything that needs them. `saveData()` is never
called with them. Consequence: closing and reopening the settings tab within a
session keeps them; quitting Obsidian or reloading the plugin discards them.

Alternatives considered and rejected: writing them to `data.json` in plaintext
(the vault-default, but puts a live token in a file that vault sync replicates
to every device and that sits in the working tree of this very repo), and
`electron.safeStorage` (encrypts at rest, but is desktop-only while the
manifest deliberately allows mobile, and still does not protect against sync
replication — it defends against local disk access only). Holding nothing
removes the question rather than answering it, which is the cheaper outcome
for a four-person tool.

**`requestUrl`, not `fetch`.**
Obsidian's `requestUrl` bypasses the browser request path. A self-managed
GitLab does not send permissive CORS headers, so `fetch` fails there — but
gitlab.com does send them, so `fetch` would appear to work in a spike against
SaaS and then break against the real target instance. Recorded explicitly
because that failure is asymmetric and easy to introduce later by someone
reaching for the more familiar API.

**The client exposes two reads, and the settings tab calls only the client.**
`getCurrentUser()` for identity and `getProjectMembership(userId)` for the
author's `access_level` on the configured project. The settings tab imports the
client; it does not import `requestUrl` and does not know any endpoint path.
This is what keeps the capability boundary real rather than nominal — the test
for whether it holds is whether `requestUrl` appears in exactly one file.

Alternative considered: letting the settings tab make the call directly, since
`git-publishing` has no other caller yet. Rejected because the boundary is
easiest to establish while there is one call to place and hardest to reclaim
after several capabilities have grown their own.

**Two calls, not one, because identity and authorization are different
questions.** `GET /user` answers "whose token is this" and is what proves the
credential works at all. The membership lookup answers "what can that person
do on this project", which is what catches the case where a token is perfectly
valid but points at a project the author has no access to — a plausible typo
in the project path, and one that a bare identity check would report as
success. The membership call needs the user id from the first, so they are
sequential, not parallel.

**Failure classification lives in the client, phrased by the caller.**
The client distinguishes the cases the plugin must treat differently —
rejected credential (401), insufficient access or wrong project (403/404),
and everything else (network, timeout, unexpected status) — and returns that
distinction. The settings tab turns each into author-facing text. Rationale:
the classification is about the remote's behavior and belongs with the code
that knows the protocol, while the wording is UI and belongs with the UI. Later
capabilities reuse the classification and supply their own wording for their
own surfaces.

**Project identified by namespace path, URL-encoded per call.**
`GL_PROJECT` holds `group/project`. GitLab's API accepts a URL-encoded path
wherever it accepts a numeric id, so no resolution step is needed. The path is
readable in the settings field, which is the point — an author checking their
own configuration can recognize it.

**Nothing is verified implicitly.**
The connection check runs only when the author clicks the button. The plugin
does not verify on settings-tab open, on plugin load, or on a timer. There is
nothing to verify at load time (credentials are empty until pasted), and a
background check would spend an author's token on a call they did not ask for
and cannot see the result of.

## Risks / Trade-offs

- [Re-pasting three values at every Obsidian launch is friction, and the token
  is the awkward one — it comes from a password manager or a GitLab page, not
  from memory] → accepted deliberately. Short-expiry tokens already make
  re-entry routine, and the alternative is a stored secret in a synced folder.
  Worth revisiting only if authors report it, and the answer then is a better
  paste flow, not persistence.
- [An author performs an action in a later milestone with empty credentials
  after a restart, and gets a confusing failure] → every entry point that
  needs credentials checks for their presence first and says so, pointing at
  the settings tab. This change establishes that message; it costs nothing here
  because the settings tab is the only surface, but it is the reason the check
  is written as a reusable guard rather than inline in the button handler.
- ["Connected as X — Developer access" reads as though the plugin verified the
  token's specific permissions] → it did not, and cannot: GitLab has no API to
  introspect which fine-grained permission checkboxes a token carries. The role
  shown is the person's project membership, which is a proxy. The settings tab
  must not claim more than that, and a token with a valid identity but a
  missing permission will still fail later at the operation that needs it.
- [Two sequential calls make the button feel slower than one] → acceptable at
  human scale for a button clicked once per session, and the second call is
  what catches a wrong project path. Not worth parallelizing when the second
  call depends on the first's result.
- [The client's error classification is written against three cases and a
  later capability meets a fourth] → likely, and fine. The classification is
  additive; the point is that later capabilities extend one shared
  classification rather than each inventing their own reading of a status code.

## Migration Plan

Not applicable. Nothing exists to migrate: no stored credentials, no persisted
data, no remote state touched by this change. Rollback is disabling the plugin,
which discards the in-memory credentials by definition.

## Open Questions

- Whether a fine-grained token behaves identically on the self-managed CE
  19.3.0 target instance as it did on gitlab.com, where all six operations this
  project needs were confirmed. Deliberately not blocking: this change makes
  two reads, both of which are the least likely to differ, and the settings tab
  points at the fine-grained flow generically. If the rerun ever turns up a
  gap, the fallback (legacy token flow) is already documented.
- Exact wording for the non-401 failures. The expired-access sentence is fixed
  by a standing decision; the wording for "that project could not be found or
  you do not have access to it" and for network failures is settled in the
  specs for this change rather than here.
