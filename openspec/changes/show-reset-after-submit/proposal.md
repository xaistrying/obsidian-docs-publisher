## Why

Right after a submit, the panel labels the open note "Waiting for review" and
offers no Reset until the author presses Refresh, with nothing saying why
(`docs/ce-verification.md` §D0d). The label falls back to the stored record;
Reset is gated on a state resolved in this session, which only a refresh
fills in. The gate is correct and stays. What is missing is that the submit
itself already knows the answer and doesn't record it: it has just opened the
review, so the remote certainly holds an open one with no threads on it.

Resubmitting a published or not-accepted document is worse than §D0d
describes. The resolved state still says "Published" or "Not accepted", and
it wins over the stored record, so until a refresh the open note keeps that
old label and still offers "Submit a new version" or "Submit again" for a
review that is now open.

## What Changes

- When a submit opens a new review, the plugin records that document as
  resolved "Waiting for review" in the session's in-memory resolved states.
  That covers a first submit, a document with no review on the remote, and a
  new version of a published or not-accepted document. Reset then appears at
  once through the gate it already has, and the label, the row and the
  resubmit button all read "Waiting for review" / "Send update" straight
  away.
- "Send update" on a document under review records nothing. Pushing a
  revision resolves no review thread, so writing "Waiting for review" there is
  the optimistic flip `openspec/config.yaml` (milestones 6/7/7a) rejected. A
  state resolved before the update stays as it was. A state that was not
  resolved stays unresolved, and the author sees today's behaviour: the stored
  label, no Reset, and the existing notice "Your update was sent. Refresh to
  see where the review stands."
- Restore is unchanged. Since `correct-stale-records`, every refresh resolves
  every stored record, including one whose note was deleted. So after a
  refresh in this session a restored note already shows Reset. Before any
  refresh has succeeded, withholding Reset is correct, because nothing has
  resolved that document. The §D7 observation (2026-09-27) predates that
  change.
- No new author-facing text. No new failure mode: a submit that fails records
  nothing, exactly as today.

## Deferred

- **The "Open in GitLab" link for the new review.** The recorded state carries
  no link, because creating the review returns only its number to the plugin.
  The row's link appears on the next refresh. For a new version of a published
  document, this also removes the stale link to the old review until then.
- **Restore before any refresh has succeeded.** A restore writes nothing to
  the remote, and its content read shows only that the document's branch
  exists, not whether its review is still open or has threads. It can't
  honestly resolve a state, so Reset waits for a refresh, as it does today.
- **Recording Send update's pre-push answer.** Before it pushes, the resubmit
  reads the document's state from the remote. That is a genuine resolved
  answer and recording it would not be a flip. It is left out because this
  change records only what the session's own write makes certain (design.md
  decision 4).
- **Saying why Reset is absent** in the unresolved case (§D0d's third option).
  After this change that case is rare: the first refresh failed, the
  connection changed, or Send update ran on a document nothing had resolved.
  The Send update notice already points at Refresh.
- **A refresh in flight when the submit completes** can replace the recorded
  state with an answer read before the review existed. That removes Reset
  until the next refresh, the same as today, and can never show a wrong Reset.
  The race between a refresh and a submit writing the stored record is older
  than this change and is not addressed here.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `submission-tracking`: adds one requirement. A review opened by this
  session's own successful submit counts as resolved "Waiting for review" for
  the rest of the session, and nothing else a submit does changes a resolved
  state.
- `plugin-shell`: the Reset requirement gains scenarios for Reset straight
  after a submit, after Send update, and after Restore. The rule itself, that
  Reset needs a resolved state, is unchanged.

## Impact

- `plugin/src/submission-tracking/document-status.ts`: one method on
  `DocumentStatusHolder`.
- `plugin/src/doc-authoring/submit-document.ts`: the holder is passed down to
  `openNewCycle`, which is the only place a review is opened and the only
  place that calls the new method. `pushUpdate` is untouched.
- `plugin/src/main.ts`: `submitForReview` passes the holder, and
  `renderResetAction`'s comment is corrected.
- `plugin/tests/submit-ordering.test.ts`: `openNewCycle`'s new argument, plus
  assertions for it.
- No remote calls, no persisted data, no dependencies.
