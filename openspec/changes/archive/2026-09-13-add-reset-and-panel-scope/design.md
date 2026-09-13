## Context

Two surfaces already exist and this change reshapes both.

`renderDocumentList` (`plugin/src/main.ts`) lists every vault note carrying
a `doc_id`, in every state, rendering name + state label + an "Open in
GitLab" link per row. No row carries an action. The resubmit actions
milestones 6/7/7a shipped live in `renderSubmitSection`, keyed to the
CURRENTLY OPEN note, not to any row — which is why narrowing this list
strands nothing (see proposal's corrected premise).

`fetchRecoveryContent` (`plugin/src/submission-tracking/recover.ts:136-159`)
already reads a document's content three-way (found / absent / failed),
trying the record's own branch first and falling back to the default
branch. `recoverDocument` (`doc-authoring/recover-document.ts`) writes that
content to a local note, refusing when a note already occupies the path.

Reset is the same read with the opposite write guard. The binding
constraint it inherits is not technical: `openspec/config.yaml`'s NO CI
PIPELINE decision, as amended 2026-09-12, exempts Reset from "a pull
mechanism must refuse while a document is awaiting review" ONLY on the
condition that it confirms before every overwrite. That amendment is what
makes this change legal at all, and its condition is load-bearing.

## Goals / Non-Goals

**Goals:**

- An author who has edited a document under review can get back to what
  reviewers are actually looking at, deliberately and with the loss made
  explicit before it happens.
- "Your documents" means something: the documents with an open review
  cycle, the ones an author can act on right now.
- Published and not-accepted documents stay visible somewhere, so
  narrowing costs nothing in what the author can see.

**Non-Goals:**

- Reset for published or closed documents (proposal).
- Any change to `renderSubmitSection`'s resubmit actions — they are
  correct where they are.
- Any change to "Documents you can recover", which keeps listing orphans
  in every state.
- Milestone 9, and whether "Other documents" eventually folds into it.

## Decisions

### 1. Reset reads the tracked branch ONLY — never the default-branch fallback

`fetchRecoveryContent`'s default-branch fallback exists for one case:
recovering a document that has since been published, whose branch was
auto-deleted. Reset cannot encounter that case — it applies only to
pending and changes-requested, both of which have a live branch by
definition.

DECIDED: Reset uses a read that asks the document's own tracked branch and
stops there. A branch that answers `absent` means the document's state
resolution is stale (it merged or closed since the panel last refreshed),
and Reset SHALL refuse and say so rather than silently falling back to the
default branch.

REJECTED: reusing `fetchRecoveryContent` unchanged. Its fallback would
turn "your review branch vanished while you were working" into a silent
reset to whatever is on the default branch — content the author never
asked for, from a different cycle. The fallback is correct for recovery
and wrong here, which is why this is a separate read rather than a shared
one with a flag.

### 2. Reset is offered for the OPEN note, not per row

The Reset control renders in `renderSubmitSection`, beside the resubmit
action, for whichever note is currently open — not as a button on every
row of "Your documents".

Two reasons, and the second is the real one:

- Consistency: `renderSubmitSection` is already where this panel puts
  actions for the document at hand, and `renderDocumentRow` has never
  carried an action.
- Safety: Reset destroys local work. Requiring the note to be open means
  the author is looking at what they are about to discard. A row of Reset
  buttons in a list makes a misclick cheap and the thing destroyed
  invisible.

REJECTED: per-row Reset buttons. They would let an author reset a document
they cannot see, which is the opposite of what the confirmation
requirement is for — the confirmation would be the only thing standing
between a misclick and lost work, rather than the second thing.

### 3. The confirmation names what is lost and cannot be skipped

DECIDED: a modal, not a `Notice` with a button. It states that local
changes to this note will be replaced by the version under review, and it
is dismissible without acting. There is no "don't ask again", no setting
that disables it, and no code path to the overwrite that does not pass
through it.

Obsidian offers no "unsaved changes" signal the plugin can read to skip
the prompt when nothing would be lost, and inventing one by diffing local
content against remote before prompting was REJECTED: it would make the
prompt conditional, and a conditional prompt is one refactor away from the
silent path the amendment forbids. Always asking costs one click in the
case where nothing is lost and is the entire safety property in the case
where something is.

### 4. "Other documents" is a filter on data the panel already holds

Both sections are built from `listVaultDocuments` plus
`this.statuses.statusFor`, partitioned by resolved state:

```
Your documents      → submission is null (never submitted)
                      OR state is pending / changes-requested
Other documents     → state is published / closed
unresolved (null)   → Your documents
```

A document nothing has resolved yet (`statusFor` returns null — the
first-refresh-failed case) stays in "Your documents". Moving it to "Other
documents" would assert it is published or closed, which is precisely the
silent wrongness `add-document-status` exists to prevent.

Neither section makes a remote call. "Other documents" is absent entirely
when empty, the same way "Documents you can recover" already is, rather
than showing a competing empty state.

### 5. Reset does not touch the tracking record or front matter

Reset replaces the note's body. It writes no `SubmissionRecord`, changes
no state, and does not re-assert front matter — the content it writes IS
the remote's, front matter included, so the note lands byte-identical to
what is under review. This matches what add-resubmission-lifecycle
established in the other direction (task 9: nothing rewrites front matter
after the read).

A Reset therefore leaves the document's resolved state exactly where it
was, which is correct: resetting local content changes nothing about the
review.

## Risks / Trade-offs

**An author resets and loses work they wanted** → Mitigated by decision 3
(always confirm, naming the loss) and decision 2 (the note is open, so
they are looking at it). Beyond that, Obsidian's own File Recovery core
plugin is the backstop, which `openspec/config.yaml` already names as the
reason not to build local versioning here.

**The tracked branch answers `absent` mid-Reset** → Refused with its own
message per decision 1, rather than falling back. Costs the author a
refresh; never substitutes content from another cycle.

**"Other documents" grows unbounded instead** → Accepted, and it is the
point: the growth moves off the list the author checks for work. If it
becomes unwieldy, milestone 9 is where a browsable surface belongs.

## Open Questions

- Exact confirmation copy, vocabulary-checked (no "branch", "commit",
  "merge request", "MR", "conflict", "main") — specs/tasks, not fixed
  here.
- Whether "Other documents" is the shipped heading or a working name.
  It reads as a leftovers bin; something like "Published documents" is
  more accurate today but wrong the moment a not-accepted document lands
  in it. Left to whoever writes the copy.
