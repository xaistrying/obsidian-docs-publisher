## 0. Before starting

- [x] 0.1 Archive `fix-edited-baseline`. This change's `plugin-shell` delta
      restates a requirement that change modified, and is written on top of
      its version.

## 1. The rule

- [x] 1.1 Add `panelSection(state, edited)` to `document-status.ts`, built
      from `needsAuthor` (design.md decision 1): `needs-you`, then
      `waiting-on-reviewers` for pending and untouched, else `null`.
- [x] 1.2 Unit-test it in `needs-author.test.ts`, covering every state ×
      edited combination. The cases that matter most:
      - pending and untouched gives `waiting-on-reviewers`;
      - unresolved (`null`) gives `needs-you`;
      - published and untouched gives `null`.

## 2. The panel

- [x] 2.1 `partitionDocuments` returns three groups using `panelSection`. The
      `null` group is used only to choose the "Needs you" empty state.
- [x] 2.2 Rename `DOCUMENTS_HEADING` to "Needs you". Replace
      `NO_OPEN_DOCUMENTS_MESSAGE` as that section's empty state with "Nothing
      needs you right now.", keeping "Nothing submitted yet…" for a vault
      with no tracked notes.
- [x] 2.3 Render "Waiting on reviewers" after "Needs you", through
      `renderCollapsibleHeader` with a new section key seeded into
      `collapsed`. Its rows use `renderDocumentRow`. Its expanded empty state
      is "Nothing is waiting for review right now." Its header gets the
      statuses' outcome, so a failed refresh reads "(check failed)".
- [x] 2.4 Update the comments that describe the old two-way split: the
      `NO_OPEN_DOCUMENTS_MESSAGE` block, `partitionDocuments`, and the
      2026-09-22 "Other documents" remarks near the restore constants.
- [x] 2.5 `npx tsc --noEmit` and `npm test` pass cleanly.
- [x] 2.6 A one-line description under each heading, shown whether or not
      the list has rows, matching the restore and import sections. For
      "Needs you": "Documents waiting on you: not sent yet, sent back by a
      reviewer, or changed since you last sent them." For "Waiting on
      reviewers", when expanded: "Sent and unchanged. Nothing to do until a
      reviewer responds." Added 2026-09-27 after the author could not tell
      from the heading alone why a row was in "Needs you".
- [x] 2.7 `SubmissionStore.onChange`, fired from `saveMany`, subscribed by the
      view. Added 2026-09-27 after 4.3: Send update writes nothing to the
      note, so its new baseline triggered no render and the document stayed
      in "Needs you" until Refresh — the refresh-dependent list decision 1
      rejects. Every store write now re-renders the panel. No remote call.

## 3. The docs

- [x] 3.1 `docs/ce-verification.md`:
      - §D0a: the disappearing-on-submit behaviour is replaced by the move
        between sections. Record the date and this change.
      - D9's "Your documents holds work owed" check: update its headings and
        both empty-state strings.
- [x] 3.2 `docs/panel-tracking-scope.md`: update the "Your documents" wording
      and the section map to describe the panel as built.

## 4. Observe it

Run `npm run build` BEFORE `install.sh`, which copies `main.js` without
building it.

- [x] 4.1 Submit a new document and don't touch it. It leaves "Needs you", and
      the "Waiting on reviewers" count goes up by one. This is the check that
      closes the change.
- [x] 4.2 Expand "Waiting on reviewers". The row shows its name, "Waiting for
      review" and "Open in GitLab".
- [x] 4.3 Type in that note. It moves to "Needs you" with "Unsent edits".
      Press Send update, and it moves back.
- [x] 4.4 With nothing owed but something under review, "Needs you" reads
      "Nothing needs you right now."
- [x] 4.5 Reload the view. "Waiting on reviewers" opens collapsed.
- [x] 4.6 Before any Refresh, both descriptions explain their list: a row
      showing only "Unsent edits" reads as belonging under "Needs you".
