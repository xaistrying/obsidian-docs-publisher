## Context

Milestone 4 writes and never reads back. `SubmissionStore` holds one record
per `doc_id` with a `state` field that only ever receives `pending`, and
`resolveSubmissionRecord` answers from that store alone. The panel renders
whatever it finds, so a published document and a rejected one are both
displayed as awaiting review indefinitely.

The remote read surface does not exist yet in any general form. What exists
is `findOpenMergeRequest`, added by the interrupted-submit change: one
narrow query against `GET /projects/:id/merge_requests` filtered to a single
source branch and `state=opened`. This milestone generalizes that endpoint
rather than introducing it, and inherits its permission classification —
that change established that fine-grained credentials gate reads, and
`classifyScopedStatus` already routes a refused read to
`insufficient-permission` with GitLab's own permission name attached.

Binding constraints, taken from the reference docs rather than re-derived:

- `docs/document-identity.md` §2 fixes the reconciliation algorithm: query
  by `source_branch = doc/<doc_id>`, **all** states, newest first; an open
  merge request wins; otherwise the most recent one decides; none means
  never submitted. It explicitly forbids filtering to open merge requests
  only, because that reports a rejected document as never submitted and the
  author's next submit then collides with the branch still sitting there.
- The same section fixes the shape of the work: "Reconcile by listing merge
  requests once and matching every orphan against that result locally — one
  call total, not one per note."
- Reconciliation keys off front-matter `doc_id`, never a file path and never
  a local record, so a note carries its identity between machines.
- `openspec/config.yaml`: the remote is the source of truth and plugin data
  is a local cache of it. Submission state never enters front matter.
- Author-facing vocabulary ban, in full. This milestone is almost entirely
  author-facing surface.

## Goals / Non-Goals

**Goals:**

- A document's displayed state is the remote's answer, not the last thing
  the plugin wrote locally.
- A note reconciles from its own front matter with no local record at all —
  second machine, restored vault, reinstalled plugin.
- One remote listing per refresh, not one per document.
- A refresh that fails leaves the author with what was last known plus an
  explanation, never a blank list or a wrong state presented as fresh.
- Milestones 6, 7 and 7a can ask "what state is this document in" and get a
  trustworthy answer.

**Non-Goals:**

- Any action that changes a state. This milestone is read-only.
- Any write to the remote, to front matter, or to a note's body.
- Polling, background refresh, or notification.
- Pulling remote content into the vault.
- The reviewer surface (milestone 8).

## Decisions

### 1. One listing, matched locally — never one query per document

A refresh makes a single `GET /projects/:id/merge_requests` across all
states, ordered newest first, and matches every known `doc_id` against the
result in memory by `source_branch`.

This is `docs/document-identity.md` §2's explicit instruction, and the
reason is not merely call count: a per-document query multiplies the failure
surface by the size of the corpus, so a partial failure leaves some
documents fresh and others stale with nothing distinguishing them on screen.
One call is one outcome — the refresh either succeeded or it did not.

`findOpenMergeRequest` becomes a caller of the general listing with a
narrower filter rather than keeping its own query construction.

### 2. Pagination is bounded, and the bound is visible

The listing is paged at 100 per page and followed to a cap. A `doc_id` not
found within the cap is treated as never submitted, per §2's rule for no
matches.

That rule is correct for a document that genuinely has no merge request and
wrong for one whose merge request sits past the cap, and the two are
indistinguishable from inside the plugin. Rather than pretend otherwise: the
cap is set high enough that a four-person team's corpus cannot reach it
(1,000 merge requests), and reaching it at all is logged and surfaced as a
refresh that could not complete, not as a set of documents that were never
submitted. A silent wrong answer here would send an author to submit a
document that already exists, which is the collision the pre-flight now
catches — but after a confusing round trip.

### 3. State resolution follows §2 exactly, with one addition

Per matched `doc_id`, newest first:

- An open merge request wins if one exists. At most one can.
- Otherwise the most recent decides: merged is Published, closed is Not
  accepted.
- No merge requests at all is Not submitted yet.

The addition: an open merge request resolves to **Changes requested** rather
than Waiting for review when it carries unresolved review threads. This is
the only state not readable from merge-request state alone, and decision 4
is how it is read.

### 4. "Changes requested" comes from unresolved threads, with a cheap gate
and a spike behind it

Chosen over a reviewer-applied label and over "any comment from a
non-author". A label is a workflow a reviewer must remember, and forgetting
it leaves the author reading the wrong state with nothing to notice. Comment
presence cannot distinguish "please fix this" from "looks good, merging",
and nothing ever flips it back.

The mechanism has a preferred form and a fallback, and which one ships is a
spike this change carries rather than an assumption:

- **Preferred:** `blocking_discussions_resolved` on the listing entry. Costs
  nothing extra and keeps decision 1 intact.
- **Fallback:** read discussions for a merge request, gated on the listing's
  `user_notes_count` being greater than zero. A document nobody has
  commented on cannot have an unresolved thread, so the extra call is made
  only for documents that actually have discussion — bounded by review
  activity rather than by corpus size, which respects §2's intent even
  though it technically exceeds one call.

The spike exists because GitLab documents `blocking_discussions_resolved` in
terms of the project setting requiring all threads to be resolved before
merging, and does not show the field in its listing examples. Whether it is
present and meaningful on the target CE 19.3.0 instance cannot be settled
from documentation — and this project has now been wrong twice about
assuming gitlab.com's behavior carries over (the `insufficient_granular_scope`
body shape, and reads being scope-gated at all). If the field requires that
project setting, enabling it is a configuration step this milestone owns and
states plainly.

**RESOLVED 2026-09-11, and NOT by the spike: the fallback ships.** Tasks 1.1
and 1.2 need a live CE 19.3.0 instance and a merge request carrying a real
unresolved thread, neither of which implementation could reach. Rather than
assume the preferred form, the mechanism chosen is the one that is correct
under every outcome the spike could have returned: the per-merge-request
discussions read, gated on `user_notes_count`. It does not care whether
`blocking_discussions_resolved` exists, and it does not care whether the
project's "all threads must be resolved before merging" setting is on — so
that setting is NOT a prerequisite of this milestone.

The runtime-adaptive option — use the field when the response carries it,
fall back when it does not — was considered and rejected. It handles an
absent field but cannot detect a field that is present and permanently
`true`, which is precisely what the spike existed to rule out, and that
failure is silent: every document would read "Waiting for review" and the
milestone's headline state would never appear.

`blocking_discussions_resolved` is deliberately NOT parsed today. Wiring in a
field nothing reads would look like a working preference and be untested.

**The spike did not disappear; it moved.** It is now
`docs/ce-verification.md` §C, alongside every other behaviour this project
established on gitlab.com and has never confirmed on the target instance —
which is where it belongs, since it is a question about an instance rather
than about this change. That file states the decision rule for each possible
answer and notes that switching touches exactly one call site,
`hasUnresolvedThreads`. Confirming the field is an optimization worth one
request per discussed document, not a correctness gap.

Consequence for failure handling: the refresh is no longer one request, so a
threads read that fails fails the whole refresh rather than resolving that
one document optimistically — see decision 8 and the git-publishing spec's
rule that a failed check must not return "no threads are unresolved".

### 5. Rendering from cache and refreshing from the remote are separate

The panel already re-renders on `file-open`, on `active-leaf-change` and on
every `metadataCache` change. None of those may make a network call.

A refresh happens on exactly two triggers: the panel being opened, and the
author pressing Refresh. Everything else renders the last known result. This
is stated as a decision because the existing render path is event-driven and
chatty, and wiring the remote read into `render()` is the natural-looking
mistake — it would put a request behind every keystroke that touches front
matter.

### 6. Which documents are listed: those carrying a `doc_id`

The list is built from the vault — every markdown note whose front matter
carries a `doc_id` — not from `data.json`.

Building it from stored records would defeat the milestone: a note with no
local record is precisely the case reconciliation exists to solve, and it
would be invisible in the list that is supposed to show it.

Notes with no `doc_id` are not listed. They have never been submitted, they
are the overwhelming majority of a vault, and listing them would bury the
documents the panel is for. The currently open note keeps showing its own
state whether or not it has a `doc_id`, which is the existing behaviour and
where "Not submitted yet" is seen.

### 7. The remote decides; the cache is overwritten, not merged

After a successful refresh, each matched document's record is written with
the resolved state. A stored state that disagrees with the remote is
replaced, never reconciled into some third answer, and a document with no
stored record gains one.

This is what makes the milestone self-healing, including for the narrow case
the interrupted-submit change left open: a submission whose remote calls
succeeded but whose local record failed to save shows correctly after the
next refresh instead of offering Submit forever.

Records whose `doc_id` matches no note in the vault are left untouched rather
than deleted. A note may be temporarily absent — not yet synced, moved
outside the vault — and deleting its record would discard the only local
trace of a real submission to save a few bytes.

### 8. A failed refresh degrades to the last known answer, labelled

The list keeps rendering the last known states and says the refresh did not
succeed. It does not blank, and it does not present stale states as fresh.

A refused read surfaces the permission by name, which the classification
built by the interrupted-submit change already supplies — the author is told
which permission to ask for rather than being told to check their
connection. `Merge Request: Read` is the one this milestone needs and it is
already recorded in `docs/access-tokens.md` §1.

### 9. Capability boundary: transport in `git-publishing`, meaning in
`submission-tracking`

`git-publishing` gains the listing and the discussions read, and knows
nothing about what any state means. The resolution rules from decision 3 —
open wins, newest decides, none means unsubmitted, unresolved threads mean
changes requested — live in `submission-tracking`, which owns the state
machine. The panel renders what it is given and decides nothing.

Deliberately not a `getDocumentStates()` method in `git-publishing` that
returns resolved states: it would put this project's identity and state
rules inside the capability whose job is to be swapped out for GitHub or
Gitea later.

## Risks / Trade-offs

**The listing returns every document's merge requests, including other
authors'** → Accepted and in fact required: reconciliation matches by
`source_branch`, and a document authored by someone else that this vault
also holds must resolve to its true state. The filtering is local and by
`doc_id`, so no document appears that the vault does not have.

**The refresh cost grows with the project's merge-request history, not with
the author's document count** → Accepted for a four-person internal tool
with a bounded corpus, and bounded explicitly by decision 2. If it ever
becomes a problem the answer is a server-side filter, not a per-document
query — the latter is what §2 forbids.

**A document could sit in "Changes requested" after the reviewer's point is
addressed but before the thread is resolved** → Accepted, and arguably
correct: the thread is the reviewer's to close, and a state that flipped
back the moment the author replied would tell the author they are done when
the reviewer has not agreed. Worth saying in the setup guide.

**`blocking_discussions_resolved` may not exist or may not mean what is
needed on CE 19.3.0** → Sidestepped rather than resolved: the mechanism that
shipped is correct under every answer, so the question costs an extra call
per discussed document instead of costing correctness. It is carried as
`docs/ce-verification.md` §C for whenever a real instance is available.

**Still no automated tests** → The state-resolution rules in decision 3 are
pure logic over a list of merge requests, with five outcomes and an explicit
precedence order, and they are the first thing in this codebase that is both
purely functional and genuinely intricate. If any single unit of this project
should be tested, it is this one. Called out, not smuggled in: test
infrastructure remains its own decision.

## Open Questions

- Does `blocking_discussions_resolved` appear in the merge-request listing on
  CE 19.3.0, and is it meaningful without the project's "all threads must be
  resolved" setting? MOVED OUT of this change to `docs/ce-verification.md`
  §C. The fallback shipped, so the answer no longer gates anything here — it
  decides only whether a later change can drop one request per discussed
  document.
- **A contradiction in `openspec/config.yaml`, surfaced by this milestone
  but not blocking it.** Line 340 says the author-facing label for
  `unsubmitted` is "Not submitted yet"; line 699 says "'Draft' survives as
  an author-facing DISPLAY label for the `unsubmitted` submission state."
  Both describe the same state's label and they disagree. This change does
  not have to resolve it — `unsubmitted` is the absence of a record rather
  than a stored state, the list shows only documents carrying a `doc_id`,
  and the open note shows a Submit control rather than a label — so nothing
  here renders it. It is raised because this is the milestone that makes the
  state vocabulary visible, and a contradiction found now is cheaper than
  one found by whichever milestone first has to print the word.
  Recommendation: "Not submitted yet", because the same
  file rejects `draft` as a state name precisely to avoid colliding with
  GitLab's own Draft merge requests, and using it as the display label
  reintroduces that ambiguity for the author who sees it.
- `SUBMISSION_STATE_LABELS` currently maps `closed` to "Closed", while
  `openspec/config.yaml`'s author vocabulary gives "Not accepted". The
  labels for the states milestone 4 could not reach were written as
  placeholders and marked as such; this milestone makes them visible and
  should adopt the config's vocabulary. Flagged rather than assumed, since
  it changes a shipped string.
