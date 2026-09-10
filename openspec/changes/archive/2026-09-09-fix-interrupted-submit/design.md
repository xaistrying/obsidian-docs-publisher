## Context

`performSubmit` in `plugin/src/doc-authoring/submit-document.ts` runs two
remote writes that cannot be made atomic: create the branch with its first
commit, then open the merge request. Front matter and the tracking record
are written only after both succeed — deliberately, so a failed attempt
freezes no `doc_id`. That ordering is right and this change keeps it.

What is missing is what happens on the next attempt. Nothing reads the
remote before writing, so a second submit re-issues the same create against
a branch that now exists, GitLab answers 400, `classifyWriteStatus` maps it
to `unexpected`, and the author gets `SUBMIT_FAILED_MESSAGE` — whose advice
is to rename the file. Renaming re-derives `doc_id` from the new filename,
so the document acquires a second permanent identity and the first attempt
is orphaned where no reconciliation query will find it.

Constraints that shape the solution rather than being weighed against it:

- Every remote call belongs to `git-publishing`. The new reads and the
  delete go there; the policy that decides between them does not.
- `docs/document-identity.md` §5 already settled the analogous problem for
  resubmissions: closed-without-merge is terminal, the fresh cut comes from
  current `main`, and the plugin deletes the abandoned branch itself. This
  change is the same shape one milestone earlier, and must not invent a
  second answer to it.
- The remote is the source of truth; plugin data is a local cache of it
  (`openspec/config.yaml`). A design that answers "was there a previous
  attempt" from local state alone is reasoning from the cache.
- Author-facing strings carry the git-vocabulary ban in full.
- `last_commit_id` is milestone 6's and may not be used here.

## Goals / Non-Goals

**Goals:**

- Pressing "Submit for review" again after an interrupted submit completes
  the submission, with no new control and nothing new for the author to
  understand.
- What reaches the remote is the note's content at the moment of the
  successful submit, never content left by an earlier attempt.
- A submission that is genuinely awaiting review is never overwritten or
  deleted, and the author is told so in their own vocabulary.
- No author is ever advised to rename a file as the remedy for an
  interrupted submit.

**Non-Goals:**

- The duplicate-`doc_id` check with reconciliation behind it (milestones 6
  and 7). This change refuses to clobber an open submission; it does not
  implement the check.
- `last_commit_id` and updating a file that exists in `main` (milestone 6).
- Attachments (milestone 4a) — the sequence still commits one file.
- The author-facing flows for resubmitting after "Not accepted" (7a) or
  revising a published document (7). Both reuse the delete introduced here;
  neither is built here.
- Automatic retry, queueing, or any attempt the author did not click.
- Repairing a tracking record that was never written. Local self-healing is
  milestone 5's reconciliation.

## Decisions

### 1. Read the remote before writing, not after failing

A pre-flight step ahead of the first write establishes which of three
states the target `doc/<doc_id>` is in: absent, present with nothing open
for it, or present with an open submission. The sequence then branches once
on that answer.

*Rejected: writing a local "in flight" marker before the first call* and
reading it back on retry. It is the obvious-looking design and it is worse
on both counts. It adds a persisted state the submission enum does not
have, needing its own rule for when a stuck marker is cleared; and it still
cannot answer for a target that exists for a reason this vault never
recorded — the same author on a second machine, or a colleague. It reasons
from the cache about a question the source of truth answers directly.

*Rejected: attempting the create and recovering from its failure.* GitLab's
400 for an existing branch is a message shape, not a documented code, and
`docs/access-tokens.md` records that this project has already been bitten
by assuming a self-managed instance's error bodies match gitlab.com's. A
pre-flight read asks the question directly.

### 2. A failed lookup is not an absent branch

The lookup is tri-state — exists, absent, or *lookup failed* — and only an
explicit 404 means absent. Any other failure aborts the submit with a
message and writes nothing.

This is the decision most easily got wrong. `classifyStatus` folds 403 and
404 together into `not-reachable`, which is right for the connection check
but fatal here: a token that cannot read the branch would be read as "no
branch exists", the create would be attempted, and the author would land
back in the exact dead end this change removes. Collapsing three states
into a boolean reintroduces the bug through the back door.

### 3. Delete and cut fresh; never resume the existing branch

When the target exists with nothing open for it, the plugin deletes it and
proceeds through the normal create-then-open sequence.

*Rejected: opening a merge request on the branch as it stands.* It looks
like the cheap fix and it publishes whatever that branch holds. An author
who edited the note between attempts — the normal case, since they were
just told the submit failed — would have the stale version submitted with
no indication. Making it correct means comparing or replacing the remote
content, which needs `last_commit_id`, which is milestone 6's.

*Rejected: committing the current content onto the existing branch.* The
commit action for a file already present there is `update`, which again
requires `last_commit_id`.

Delete-and-recut needs neither, and it is the same mechanism
`docs/document-identity.md` §5 already chose for resubmissions, so this
change adds no pattern the project had not already accepted. Its safety
argument transfers intact: with nothing open for the target, nothing
reviewable is destroyed — only a draft the author is in the act of
replacing.

### 4. Delete first, then create — the ordering is the safety property

If the delete succeeds and the create then fails, nothing is in the way and
the next attempt is an ordinary first submit. If the delete fails, the
submit stops before any write. Every failure leaves the remote in a state a
plain retry can complete, which is the whole point of the change.

### 5. "Nothing open for it" is the test, not "no merge request ever"

The pre-flight asks whether an *open* submission exists for the target, not
whether one ever existed. A closed one means the previous cycle ended
without publishing and nothing is under review, so the target is clear to
reclaim.

This is deliberate rather than incidental: it makes the mechanism here the
same as the one milestone 7a needs, so 7a supplies the author-facing state
and action and reuses this path rather than adding a second one. It also
means this change must not be read as implementing 7a — the mechanical
half converging is not the milestone.

### 6. A frozen `doc_id` wins over the live filename

When the note's front matter already carries `doc_id`, submit uses that
value; it re-derives from the filename only when there is none.

`docs/document-identity.md` §3 already requires this — the branch derives
from the frozen value and never from the live filename — and the shipped
code does not honour it, because the panel only offers Submit for notes
with no record and nothing else enforced it. The command palette entry has
no such condition.

It is load-bearing for *this* change rather than adjacent to it: without
it, the refusal added by decision 7 is bypassed by renaming the file, which
re-derives a different `doc_id`, finds an absent target, and submits the
document a second time under a second identity — the precise corruption
this change exists to prevent, reachable by following the old advice.

### 7. Refuse an open submission, and say so without git words

When something is open for the target, the plugin writes nothing and shows:

> "A document with this file name is already waiting for review. If that's
> this document, there's nothing more to do. If it's a different one,
> rename the file and submit again."

Both readings are addressed because the plugin cannot always tell them
apart, and it must not claim to. Renaming is the correct advice *here* —
for a genuinely different document it is how that document gets its own
identity — which is exactly why removing it from the interrupted case
matters: the same sentence was previously given for both, where it was
right for one and destructive for the other.

The real duplicate-`doc_id` check, with reconciliation behind it and
ordered ahead of the path-mismatch check, stays with milestones 6 and 7.

### 8. Policy stays in `doc-authoring`; only calls go to `git-publishing`

`git-publishing` gains three primitives — does this target exist, is
anything open for it, delete it — and no knowledge of when any of them
should be used. The branch on the pre-flight answer lives in
`submit-document.ts`.

Deliberately *not* a single `prepareTarget`-style method that performs the
lookups and the delete behind one call. It would read as tidier and it
would move the decision of what to destroy into the capability whose job is
transport, leaving the sequence's actual policy invisible from the file
that owns the sequence.

### 9. The undifferentiated failure message becomes honestly undifferentiated

`SUBMIT_FAILED_MESSAGE` currently names a cause ("another document is
already using this file name") and prescribes a remedy for it. The
pre-flight now handles that cause explicitly, so the message keeps only
what is true of every remaining failure and advises the action that is
always right:

> "Submit didn't go through. Check your connection and submit again."

Clearing a previous attempt is failure-classified separately, because the
author's situation differs:

> "Submit didn't go through while clearing up an earlier attempt. Check
> your connection and submit again."

The `insufficient-permission` message is unchanged.

### 10. A lookup refused for a missing permission says so

Found while running this change's own observable check 6.2, which is why it
is recorded as evidence and not as a preference. The pre-flight's
`findOpenMergeRequest` was refused with HTTP 403 and a named body:

> `insufficient_granular_scope` — "requires a fine-grained personal access
> token with the following project permissions: [Merge Request: Read]"

The abort was correct — nothing was written and nothing deleted, exactly as
decision 2 requires. What was wrong was what the author was told. A read's
403 went through `classifyStatus`, which folds it into `not-reachable`, and
produced "Submit didn't go through. Check your connection and submit again."
The connection was fine; the token was missing a permission, and no number
of retries would ever have changed that.

The premise that failed is stated in `gitlab-client.ts` itself: that
`insufficient-permission` belongs to writes because "the two read methods
have nowhere a fine-grained token's scope can bite". True of the connection
check's two reads. False of the two reads this change adds, because a
fine-grained token grants read permission per-resource, and these read
resources — a branch, a merge request — that a token can be denied
individually.

So the classifier is chosen by whether a fine-grained token's permissions
gate the call, not by the HTTP verb. `classifyWriteStatus` is renamed
`classifyScopedStatus` and now serves the writes, the delete, and both
pre-flight lookups. `classifyStatus` is left exactly as it was and still
serves the connection check, where a 403 genuinely does mean "not visible to
you" rather than "permission not granted".

*Rejected: changing `classifyStatus` itself.* It would have been the smaller
diff and it would have silently rewritten what the settings tab's "Test
connection" reports, which belongs to milestone 2 and is out of scope here.

**A second defect surfaced in the same response and is fixed with it.**
`extractPermissionDetail` read `body.message`, but the real body carries
`error` and `error_description` and no `message` at all — so the permission
name was always discarded, including on the write path where milestone 4
meant it to appear. Its regex also expected a snake_case identifier while
GitLab sends the name as the token screen spells it, `[Merge Request: Read]`,
which is the form the author actually has to go and tick. Both are corrected.
Pre-existing rather than introduced here, but this change is what produced
the first real response body to check it against.

## Risks / Trade-offs

**A delete is a destructive remote call, and this is the capability's
first** → Scoped as narrowly as it can be: it targets only
`doc/<doc_id>` for the document being submitted, only when the lookup
explicitly reported that target present, and only when nothing is open for
it. A lookup that failed for any other reason never reaches the delete
(decision 2). `main` is protected and is never a candidate; GitLab would
refuse regardless.

**Two authors interrupted on the same filename: the second submit deletes
the first's abandoned attempt** → Accepted. What is lost is a draft that
reached no review, and under this project's identity rules the same
filename at the same path is the same document, so the deeper problem is
the duplicate `doc_id` — which milestones 6 and 7 own. This change does
not make that case worse than the dead end it currently produces.

**A record that fails to save after the submission is open leaves the panel
offering Submit forever** → Not introduced here, and now harmless rather
than corrupting: decision 6 makes the next attempt use the frozen `doc_id`,
which finds an open submission and refuses (decision 7). The display heals
when milestone 5's reconciliation rebuilds records from the remote.

**A submitted note whose filename has drifted still submits as a new
document** → Out of scope and explicitly still open. Decision 6 closes it
for any note carrying `doc_id` in front matter, which is every note the
plugin has submitted since milestone 4. A note whose front matter was
hand-edited to remove `doc_id` is not covered; the path-mismatch check that
covers it properly is milestone 6's and 7's.

**Closing a merge request in GitLab leaves the panel saying "Waiting for
review"** -> Observed during this change's own verification, 2026-09-09, and
NOT a defect introduced here. Nothing reads remote state back into the vault
yet: the panel renders the local record, this milestone only ever writes
`pending`, and `pending`'s label is "Waiting for review". Making the panel
reflect a closed merge request is milestone 5's reconciliation, and the
author-facing action on it is 7a's.

Recorded because the stale display is easy to mistake for this change's bug
when the two are met together, and because what it costs the author changed
here. The panel offers no Submit while a record exists, but the command
palette does, and that path now completes: frozen `doc_id`, branch found,
nothing open against it, branch cleared, fresh cut, record overwritten. The
same sequence before this change hit the branch-already-exists dead end and
advised a rename. So the staleness went from trapping the author to being
cosmetic -- which is also a hand-verification that 7a's mechanism works
ahead of 7a building its button on it.

**More calls on the happy path** → One extra read when the target is
absent, which is every ordinary first submit; three when recovering. Submit
already spends two reads re-fetching the default branch once per write
call, so the marginal cost is small and the redundancy is the better target
— best folded into milestone 4a, which rewrites this payload anyway.
Consolidating it here would be scope creep with no author-visible effect.

**Nothing here is tested automatically, as nothing in the plugin is** →
The pre-flight's three-way branch and the tri-state lookup are the first
logic in this codebase where a wrong branch silently destroys remote data,
which is a stronger case for unit tests than anything shipped so far.
Called out rather than smuggled in: test infrastructure is its own change,
and this design does not assume it.

## Open Questions

- Does `GET /projects/:id/repository/branches/:branch` answer 404 for an
  absent branch on the target CE 19.3.0 instance, rather than 403 or a 200
  carrying an error body? Decision 2 makes anything other than an explicit
  404 abort safely, so a surprise here degrades to "cannot submit" rather
  than to data loss — but it should be confirmed against the real instance
  during implementation, not assumed from gitlab.com.
- ~~Whether the abort message for a failed lookup should differ from the
  general failure message.~~ ANSWERED 2026-09-09, by evidence rather than
  argument — see decision 10. It must differ when the lookup was refused for
  a missing token permission, because the author's action is NOT identical
  there: "check your connection and submit again" describes something a
  retry fixes, and a fine-grained permission the token was never granted is
  not that. For every other lookup failure the original reasoning holds and
  the general message stands.
