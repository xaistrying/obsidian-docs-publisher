## Why

The plugin tells every author the same thing about every document they have
ever submitted, forever: "Waiting for review". There is exactly one write of
a submission state in the codebase and it always writes `pending`; nothing
anywhere transitions it. A document that was published last month, one that
was rejected, one a reviewer has asked for changes on — all three read as
still awaiting review. The state is not merely incomplete, it is wrong, and
it is wrong silently.

This is also the milestone that unblocks the rest of the roadmap. Milestones
6, 7 and 7a all act on a document's current state, and none of them can be
built while the plugin cannot read one. Milestone 4 only writes; this is
where the read path is built, and it must be scoped as though the remote
read surface does not exist, because it does not.

Two things make it cheaper now than it would have been a week ago. The
interrupted-submit change already built a merge-request lookup against the
right endpoint, with the query building, the permission classification and
the array parsing in place — this widens it rather than starting it. And
that same change proved the hard way that fine-grained credentials gate
READS as well as writes, so the classification this milestone's calls need
already exists instead of being rediscovered as a mystery failure.

## What Changes

- The panel lists the author's own documents with each one's current state,
  read from the remote rather than from what the plugin last wrote locally.
- A document's state becomes real and can change: Not submitted yet,
  Waiting for review, Changes requested, Published, Not accepted.
- A document reconciles from its own front matter, so a note pulled onto a
  second machine — or into a vault restored from backup, or after a plugin
  reinstall — shows its true state with no local record at all. Plugin data
  stops being the thing that knows, and becomes a cache of what the remote
  said.
- Refreshing is an explicit action the author takes, plus a refresh when the
  panel opens. Nothing polls.
- "Changes requested" is derived from unresolved review threads: while a
  reviewer has left a thread unresolved the document reads as needing work,
  and it returns to "Waiting for review" when the threads are resolved.
- An "Open in GitLab" link per document, which is the existing escape hatch
  and the only thing a reviewer-side action needs from this milestone.
- A submission whose local record was lost — including the one narrow case
  the interrupted-submit change left open, where the remote succeeded but
  the local record did not save — heals on the next refresh instead of
  leaving the panel permanently wrong.

### Deferred, deliberately

- **Acting on any state.** Sending updates after "Changes requested" is
  milestone 6; resubmitting after "Not accepted" is 7a; revising a published
  document is 7. This milestone is read-only from the author's point of
  view: it shows state and offers no action that changes one.
- **The reviewer surface and the Merge action** stay with milestone 8.
- **Attachments** stay with 4a. Nothing here commits.
- **Polling, background refresh, and notifications.** The author refreshes;
  the plugin does not watch.
- **Pulling remote content into the vault.** Reading a document's STATE is
  not reading its CONTENT, and `openspec/config.yaml`'s no-CI decision
  leaves a pull mechanism optional and unbuilt. Nothing here writes to a
  note's body.

## Capabilities

### New Capabilities

None. Every subject here belongs to a capability that already exists.

### Modified Capabilities

- `submission-tracking`: states other than `pending` become reachable and
  are resolved from the remote. Gains reconciliation — matching a note to
  its merge request through its front-matter `doc_id` — and the rule that
  the remote decides, with plugin data as a cache that may be rebuilt or
  found stale.
- `git-publishing`: gains a listing of the project's merge requests across
  all states, and a way to read whether a merge request has unresolved
  review threads. Both are reads and both are gated per-resource by a
  fine-grained credential.
- `plugin-shell`: the panel gains a list of the author's documents and their
  states, plus a refresh control and a per-document link out to GitLab.
  Today it shows a state only for the note that happens to be open.

## Impact

- `plugin/src/git-publishing/gitlab-client.ts` — a merge-request listing
  across all states, and a discussions read. `findOpenMergeRequest` becomes
  a narrow caller of the general listing rather than its own query.
- `plugin/src/submission-tracking/` — reconciliation, and records that can
  hold every state rather than only `pending`. The stored shape gains
  nothing new; `SubmissionState` already types all five.
- `plugin/src/main.ts` — the panel grows a document list, a refresh control,
  and the states it renders.
- No change to submitting, to front matter, to `doc_id`, or to any write.
  This milestone adds no write of any kind.
- `data.json` is read and written in its existing shape. Records written by
  milestone 4 are valid input; no migration.

### No project setting is required, and here is why that was not obvious

Deriving "Changes requested" from unresolved threads could have depended on
the target project having "All threads must be resolved before merging"
enabled, because GitLab's per-merge-request flag for it —
`blocking_discussions_resolved` — is documented in terms of that setting and
does not appear in its listing examples. Whether the flag exists on CE 19.3.0
and whether it means anything without that setting cannot be settled from
documentation.

It is settled by not depending on it. The mechanism that ships reads a merge
request's discussions directly, gated on the listing's comment count, and is
correct whether the flag exists or not and whether the setting is on or not.
**So this milestone adds no project configuration step.**

The flag remains worth confirming, because adopting it would remove one
request per discussed document. That question is now carried in
`docs/ce-verification.md` §C rather than by this change — along with
everything else this project established on gitlab.com and has never
confirmed against the self-managed CE 19.3.0 target. It is an optimization
with a stated decision rule, not an open risk.
