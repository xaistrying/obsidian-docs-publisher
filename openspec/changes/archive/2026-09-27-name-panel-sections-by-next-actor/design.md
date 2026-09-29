## Context

The panel's document list is built by `renderDocumentList` (`main.ts`) from
`partitionDocuments`, which splits every vault note carrying a `doc_id` into
two groups using `needsAuthor(state, edited)`:

- the `open` group, which is rendered as "Your documents";
- the `finished` group, which is not rendered at all since 2026-09-22.

Its only remaining use is choosing between the two empty-state messages. The
state is read as the remote's answer, falling back to the stored state; the
fallback exists for imported documents.

The `finished` group mixes two kinds of document that the author sees
differently:

- documents waiting for review and untouched, where the next move is a
  reviewer's;
- published and untouched documents, which have no next move at all.

The first kind is the one that "vanishes on submit". The second kind is the
roll-call that 2026-09-22 deliberately removed.

`fix-edited-baseline` has made `edited` trustworthy. That is a precondition
here: a split driven by `edited` is only as honest as the baseline behind it.

## Goals / Non-Goals

**Goals:**

- Every listed document sits in exactly one section, and the section's
  heading says who acts next.
- Submitting a document moves it from one section to another in view,
  rather than removing it.
- The primary list stays the work the author owes, and is visually the one
  that matters.

**Non-Goals:**

- Changing `needsAuthor`. "Needs you" holds exactly what "Your documents"
  holds today.
- Listing published documents again.
- Remembering collapsed sections across sessions.
- The stale "Documents you can restore" spec text. That is a separate
  spec-only retrofit.

## Decisions

### 1. One classifier, next to `needsAuthor`

Add `panelSection(state, edited): 'needs-you' | 'waiting-on-reviewers' | null`
to `document-status.ts`, built from `needsAuthor` rather than beside it:

- if `needsAuthor` returns true, the answer is `needs-you`;
- otherwise, a `pending` state gives `waiting-on-reviewers`;
- anything else gives `null`, meaning not listed.

`partitionDocuments` calls it and returns three groups instead of two. This
keeps the rule a pure function, which `needs-author.test.ts` already tests
without a view. The alternative, branching inside `partitionDocuments`, would
put the one new rule in the one place with no test.

An unresolved document (state `null`) goes to `needs-you` by way of
`needsAuthor`, as it does today. Putting it under "Waiting on reviewers" would
assert that it is under review, and nothing established that.

REJECTED: keeping a just-submitted document in the primary list until the
next Refresh. It would fix the moment after a submit, but it makes the list's
contents depend on when the author last pressed a button. The baseline race
`fix-edited-baseline` removed was exactly that kind of unpredictability.

### 2. "Waiting on reviewers" is collapsed by default, and always present

It uses the existing `renderCollapsibleHeader`, with a new key seeded into
the view's `collapsed` set at construction.

- **Why collapsed:** the primary list stays the focal one, and the heading's
  count still moves on every submit. That count is the whole of the feedback
  this change exists to add. Expanded by default was rejected: an expanded
  list of other people's pending work directly under the author's own would
  compete with it, and the 2026-09-22 narrowing was about removing that
  competition.
- **Why always present,** even at zero: every other collapsible section in
  the panel is always present and reports its count. A section that appeared
  only after a first submit would be a fourth pattern for an author to learn.

Its heading reports "(check failed)" after a failed refresh, the way its
siblings do. That keeps the rule already recorded for collapsible headings:
collapsing hides a list, never which case applies.

### 3. Empty states follow the rename

| Section | Case | Message |
|---|---|---|
| Needs you | nothing tracked at all | "Nothing submitted yet. Documents you submit will be listed here." (unchanged) |
| Needs you | documents tracked, none needing the author | "Nothing needs you right now." (new) |
| Waiting on reviewers | expanded and empty | "Nothing is waiting for review right now." |

The last message is the existing `NO_OPEN_DOCUMENTS_MESSAGE`. It moves to the
section where it is now true.

Every string here uses author vocabulary only: no "branch", "commit", "merge
request", "MR", "conflict" or "main".

### 4. Placement

The order becomes:

1. Needs you, which keeps the Refresh control
2. Waiting on reviewers
3. Documents you can restore
4. Documents you can import

The two lists of documents already in the vault come first. The two lists of
documents the vault lacks come after them.

## Risks / Trade-offs

- **An author may never expand "Waiting on reviewers" and miss a review that
  has gone quiet** → Accepted. A document that needs them moves to "Needs you"
  once a reviewer comments or declines it. A reviewer who does nothing is not
  something the panel can act on.
- **"Needs you" can look like a demand on a vault with unresolved states** →
  Unchanged from today. Unresolved documents are already in the primary list,
  for the reason in decision 1.
- **The rename invalidates wording in two docs** → The tasks update
  `docs/ce-verification.md` (§D0a and D9) and `docs/panel-tracking-scope.md`
  in the same change, so the docs and the panel don't disagree.

## Migration Plan

None. No stored data changes. The rename takes effect on the next render.
Rolling back means reverting the change.

## Open Questions

- None blocking. Whether published documents should ever come back as a
  third, reference-only section is deliberately left alone. It was decided
  against on 2026-09-22, and this change does not reopen it.
