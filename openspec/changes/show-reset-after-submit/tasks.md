## 0. Order relative to other open changes

- **`add-action-busy-states`: independent, and either can go first.** This
  change is the smaller one, so do it first unless busy-states is already in
  progress.
  - **No overlap in behaviour.** That change controls whether a write control
    can be pressed. This one controls whether Reset is shown. With both
    applied, Reset appears the moment `openNewCycle` records the new review,
    while the Submit control still reads "Sending…". Under busy-states'
    decision 4, it appears with its normal label and disabled until the
    submit settles, then becomes pressable. Neither change's spec says
    otherwise. Busy-states also lists §D0d as deferred to its own change,
    and this is that change.
  - **Textual overlap only.** Both add a parameter to `submitForReview` in
    `submit-document.ts` and edit `main.ts`'s `submitForReview` call.
    Whichever lands second adds its parameter beside the other's.
- **`persist-connection-settings` (implemented, not committed).** It touches
  `main.ts` `onload` and the not-connected note, neither of which this change
  edits. Find the edit sites below by symbol, not by line number.

## 1. Record a new review as resolved

- [x] 1.1 Add `recordNewReview(docId: string, mrIid: number)` to
  `DocumentStatusHolder` (`submission-tracking/document-status.ts`). It sets
  `{ docId, submission: { state: 'pending', mrIid, webUrl: null } }` for that
  one entry, notifies, and leaves `lastOutcome` untouched. Its comment should
  say why `pending` is hard-coded and why no other submit path may call it
  (design.md decisions 1 and 3).
- [x] 1.2 Pass the holder down the submit path next to `store`:
  `submitForReview` → `performSubmit` → `performResubmit` / `openFreshCycle`
  → `openNewCycle`. In `openNewCycle`, call
  `statuses.recordNewReview(params.docId, mergeRequest.value.iid)`
  immediately after the existing `store.save`. Leave `pushUpdate` unchanged.
- [x] 1.3 In `main.ts`, the plugin's `submitForReview` passes
  `this.documentStatuses`. Correct `renderResetAction`'s comment: the gate
  and its reason stay, the claim that "its row shows no label" goes, and one
  line says that a review opened by this session's own submit counts as
  resolved.

## 2. Tests

- [x] 2.1 `tests/submit-ordering.test.ts`: give the existing `openNewCycle`
  call a `DocumentStatusHolder`, then assert:
  - after a successful run, `statusFor('Setup')` is pending with the returned
    number;
  - when creating the review fails, `statusFor('Setup')` is still `null`.
- [x] 2.2 One holder test (next to `tests/states-survive-failure.test.ts`):
  `recordNewReview` leaves `lastOutcome` as it was, and a later
  `recordSuccess` without that document removes the entry.
- [x] 2.3 `npm test` and `npm run build` pass.

## 3. Observable checks (target instance)

Record the results in `docs/ce-verification.md` §D0d and §D7, not here.

- [ ] 3.1 **First submit.** Create a new note and press "Submit for review",
  then confirm. When "Waiting for review" appears, do **not** press Refresh.
  The open-note section reads "Waiting for review", the button reads "Send
  update", and Reset is shown next to it. The note's row also reads "Waiting
  for review". Press Reset: the confirmation appears.
- [ ] 3.2 **New version of a published document.** Open a published
  document, edit it, and press "Submit a new version". Without Refresh, the
  label changes from "Published" to "Waiting for review", the button reads
  "Send update", and Reset is shown.
- [ ] 3.3 **Not accepted.** Same as 3.2, starting from a document that was not
  accepted and pressing "Submit again".
- [ ] 3.4 **Send update, state already resolved.** Take a document you have
  refreshed and that is under review, edit it, and press "Send update". The
  notice reads "Your update was sent. Refresh to see where the review
  stands." The label and Reset are unchanged. For a document in "Changes
  requested", it still reads "Changes requested", not "Waiting for review".
- [ ] 3.5 **Send update, nothing resolved, and reload.** With the panel
  open, reload Obsidian. The token is not kept, so the panel's opening refresh
  finds no connection and resolves nothing. Connect again in settings with
  "Test connection", but do **not** press Refresh. Open a note under review:
  it shows its stored label and no Reset, so nothing from before the reload
  was carried over. Press "Send update". You get the notice "Your update was
  sent. Refresh to see where the review stands." and still no Reset. Press
  Refresh: Reset appears.
- [ ] 3.6 **Restore (§D7 re-run).** Delete a note under review, press
  Refresh, then press Restore on its row. When "This document is back in your
  vault." appears, Reset is shown for the restored note with no further
  Refresh.
- [ ] 3.7 **Nothing persisted.** Compare `data.json` before and after 3.1:
  the only difference is the submit's own record for the new document, the
  same as before this change.
