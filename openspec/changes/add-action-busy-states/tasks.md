## 1. The slot

- [x] 1.1 Add a small in-memory holder beside `main.ts` recording the running write action as `{ action, target } | null`, with `current`, `onChange`, and `run(action, target, work)`: refuses with the notice "Still finishing your last action. Try again in a moment." when the slot is taken, otherwise takes it, awaits `work`, and clears it in `finally` (design.md decision 1). Mark the single-slot ceiling with a `ponytail:` comment.
- [x] 1.2 One test in `plugin/tests/` for it: a second `run` while the first is pending does not call its `work`; the slot is free again after a `work` that throws.

## 2. Route the four actions through it

- [x] 2.1 Hold one instance on the plugin. Wrap the async bodies of `resetDocument`, `restoreDocument` and `importAllDocuments` in `run`, after their authoring gate and with nothing reordered (target: note path, `doc_id`, empty).
- [x] 2.2 Pass the holder into `submitForReview` (`submit-document.ts`): refuse with the busy notice before opening the dialog when the slot is taken, and wrap each of its three `performSubmit` calls in `run('submit', file.path, …)`.

## 3. The panel

- [x] 3.1 Hand the holder to `DocsPublisherView`, subscribe to its `onChange` via `scheduleRender`, and render the Submit, Reset, Restore and Import all buttons per design.md decision 4: busy label and disabled when the slot matches that action and target, normal label and disabled when the slot holds anything else. Busy labels: "Sending…", `CHECKING_LABEL`, "Restoring…", "Importing…".
- [x] 3.2 `npm test` and `npm run build` pass.

## 4. Observable checks (target instance, then record in `docs/ce-verification.md` §D0c)

- [ ] 4.1 Open a note under review. Press Reset: it reads "Checking…" at once and cannot be pressed; the confirmation appears. Press Cancel: the button reads "Reset" again and the note is unchanged. Double-click Reset: one confirmation appears, not two.
- [ ] 4.2 Edit a note under review and press "Send update", confirm the dialog: the button reads "Sending…" until "Your update was sent…" appears, then its normal label returns. While it reads "Sending…", Reset and "Import all" are greyed and do nothing.
- [ ] 4.3 While a submit is sending, run "Submit for review" from the command palette: no dialog opens and "Still finishing your last action. Try again in a moment." is shown.
- [ ] 4.4 Delete a note under review, Refresh, and press Restore on its row in "Documents you can restore": that row reads "Restoring…" until "This document is back in your vault." appears.
- [ ] 4.5 With two or more documents listed to import, press "Import all" twice quickly: it reads "Importing…", each document arrives once, and one batch notice appears.
- [ ] 4.6 Turn off the network and press Reset: the failure notice appears and the button reads "Reset" and is pressable again.
