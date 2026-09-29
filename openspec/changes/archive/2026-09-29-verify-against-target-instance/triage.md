# Triage — tasks 7.3 and 7.4

Task 7.3 says collect every failure before fixing any, so one decision covers
the set. This is that set, closed as of 2026-09-29. Task 7.4 triages it by
design.md decision 5:

> **Fix inside this change:** a wrong permission classification, a response
> field parsed under the wrong name, a message that names the wrong remedy,
> onboarding copy.
> **Give it a milestone:** anything that changes a write path, a data shape, or
> a panel surface.

Findings live in `docs/ce-verification.md` §D0. This file records only their
disposition.

## The set

| | Finding | Status | Disposition |
|---|---|---|---|
| D0a | A submitted document vanished from the panel | **Resolved by redesign** | `name-panel-sections-by-next-actor` |
| D0b | Every document read as "Edited — not sent yet" | **Fixed** | `fix-edited-baseline` |
| D0c | Reset's confirmation takes ~3s with no busy state | Open | Milestone |
| D0d | Reset withheld beside a label that contradicts it | Open | Milestone |
| D0e | A submit reached the remote and left no local trace | Open | `correct-stale-records` (proposed) |
| D0f | A document stuck in the restore list forever | Open | `correct-stale-records` (proposed) |
| D0g | The connection check discards the permission name | **Fixed** | This change, 2026-09-29 |
| D0h | Switching projects leaves the old project's states, and offers actions against it | Open | Milestone — **not** covered by `correct-stale-records` |

Two were found and fixed during the run itself. Five remain, of which four are
already carried by a change and one belongs here.

## D0g — fixed here, 2026-09-29

Done as described below. `getCurrentUser` classifies through
`classifyScopedStatus`; `getProjectAccess` keeps its fold; the permission name
rides on `ConnectionState`'s `failed` variant and both surfaces name it.
`plugin/tests/identity-permission.test.ts` covers it, including the 401 path so
the expiry message cannot be disturbed by the reclassification. 128 tests pass.

One judgement call, stated rather than buried: this added an optional `detail`
to `ConnectionState`, and decision 5 sends "a data shape" to a milestone. That
clause is about the plugin's PERSISTED model — records, front matter, what
survives a restart. `ConnectionState` is explicitly session-only and never
persisted, and without somewhere to put the name the message cannot say which
permission is missing, which is the entire finding. Treated as part of the
message fix.

## Why it was the one this change should fix

It qualifies twice over, which is unusual and worth stating rather than
picking the more convenient reading:

- **"a message that names the wrong remedy"** — the panel says "That project
  could not be found, or your access does not include it. Check your details in
  settings." when the project is fine and the token is missing `User: Read`.
- **"a wrong permission classification"** — `classifyStatus` folds 403 into
  `not-reachable`, which is what discards the name. The detail extraction runs
  only for `insufficient-permission`, a kind that function cannot produce.

Neither reading puts it in a milestone. Decision 5 says fix it here.

### Why it matters more than its size suggests

It lands on the first thing a new author does. §A2.10 flags `User: Read` as the
permission most likely to be missed — it is on the token screen's User tab
rather than Group and project, and `getCurrentUser` is the FIRST call "Test
connection" makes. So the single most likely first-run failure produces a
message pointing at the wrong thing, while the instance is telling the plugin
exactly which checkbox is missing.

### The fix, and why it is not just copy

The fold exists for a reason: an invisible project and a missing one should
read the same, so the plugin does not leak which projects exist. That concern
applies to `GET /projects/:id`. **It does not apply to `GET /user`** — there is
no project in that request to leak the existence of.

So: classify the identity read as a scoped read, which already names the
permission and is already what every other per-resource read does. Leave the
project read's fold exactly as it is. That is a few lines, keeps the property
the fold was protecting, and makes the message name the missing permission the
way §D6 showed the document-list refresh already does.

REJECTED: widening the copy to mention both possibilities ("the project may not
exist, or your token may be missing a permission"). It is cheaper and it is
worse — it makes a message that is currently precise-but-wrong into one that is
vague-and-hedged, on the surface where a new author most needs to be told what
to do.

## D0h — found after this triage was first written

Added 2026-09-29, and it changes the count from seven findings to eight.

Pointing the plugin at a different project leaves every document displaying the
state it held on the OLD one, with a resubmit button offering to act on it. The
2026-09-20 guard fires correctly — editing the project id clears the held
states — and is then undone by the next successful refresh, which resolves each
`doc_id` against the new project, finds nothing, and falls back to
`stored?.state`.

**It is a milestone by decision 5**, on both counts: it reaches a write path
(the resubmit action carries a `branch` and `mrIid` belonging to another
project) and a panel surface.

**IT IS NOT FIXED BY `correct-stale-records`, and that is the point of
recording it here rather than assuming it.** That change widens reconciliation
to cover stored records with no note in the vault — records the CURRENT project
knows about. D0h's records belong to a project the plugin is no longer pointed
at, so the new project has never heard of them and reconciling them against it
resolves nothing. The two findings share a family — a record nothing corrects —
and not a fix.

The ambiguity underneath is worth stating for whoever takes it: "no merge
request found for this `doc_id`" is the same observation whether the document
was imported into this project or belongs to a different one, and the record
alone cannot tell them apart. Any fix has to introduce something that can —
most obviously, recording which project a record was written against.

## What is NOT a failure, and should not be triaged as one

- **D9's "never submitted" state being unreachable** from a fresh note. That is
  `createDocument` deliberately not writing `doc_id` until first submit, per
  `docs/document-identity.md`. The check's wording was corrected; the plugin
  was not wrong.
- **`created` on a resubmit's changed-files line** for a document not on the
  default branch. Four readings during §D8, all correct for different reasons.
- **A draft review leaving zero discussions.** The remote genuinely carries no
  feedback until the review is submitted. Worth a line in the setup guide, not
  a fix.

## Carried out of this change, owed elsewhere

- **The access floor.** Every §D result is Maintainer-as-author. §0 records why
  that cannot stand in for a Developer, and the token screen's own rule
  ("Permissions not included in your assigned role have no effect") means no
  token narrowing substitutes for the role. Needs a second account. **Owed
  before release**, not before this change archives.
- **The spec drift.** `specs/plugin-shell` still describes a two-section panel
  that lists every tracked document. The 2026-09-22 narrowing and the
  2026-09-27 renaming both shipped without a delta. §D1 passes against the code
  and fails against the spec, and no reader can tell which is authoritative.
  Needs a retro-change of its own; `correct-stale-records` deliberately does not
  touch it.
- **§D0e's root cause.** `correct-stale-records` makes the failure survivable
  without diagnosing it. The console distinguishes the two candidates and has
  not been read. Worth its own look; not a blocker, since an intermittent fault
  on a write path will outlive any single diagnosis.

## Nothing left to run

All 46 tasks are complete as of 2026-09-29, and no item in
`docs/ce-verification.md` is still marked owed on CE. The last two were §B4 and
§B6, answered on `git.styl.solutions` — §B6 with real pagination, 183 tree
entries across two pages, so the loop's multi-page branch is observed rather
than inferred. §B5's response shape was read on CE in the same sitting.

## Previously still to run

- **§D6's third check** — states survive a failed refresh. Mechanism confirmed
  in code (`recordFailure` never touches `statuses`); the observation needs a
  successful refresh to complete FIRST, which two attempts missed.
- **§B4, §B6, §B5's shape on CE** — one `probe.py` run at the office against a
  merge request carrying a published thread.
