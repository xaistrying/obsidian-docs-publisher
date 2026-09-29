## 1. Give the baseline an owner

- [x] 1.1 Add one function that captures a note's edit baseline from
      `app.vault.adapter.stat(file.path)` — the filesystem, not `TFile.stat` —
      and returns it, answering "no baseline" rather than guessing if the read
      fails or the path has moved (design.md decision 1).
- [x] 1.2 Make it the ONLY way the baseline reaches a stored record, so a
      write path added later cannot quietly skip it (design.md decision 2).
      If the field can still be set directly, this task is not done.
- [x] 1.3 Add a store operation that updates a record's baseline and nothing
      else — not state, not branch, not path. Reset needs it, and needs it to
      be incapable of touching the rest.

## 2. Route every write through it

- [x] 2.1 `submit-document.ts`, first-submit path: take the baseline from the
      new helper instead of `file.stat.mtime`.
- [x] 2.2 `submit-document.ts`, revision path: the same.
- [x] 2.3 `import-document.ts`: the same, which also settles design.md's first
      open question by making it moot rather than by answering it.
- [x] 2.4 `reset-document.ts`: record the baseline after the overwrite, and
      after the create path's write too. Keep everything else it does not do —
      no state, no branch, no path, no front matter.
- [x] 2.5 Check no other code writes a note the plugin tracks. If one exists,
      it belongs in this list; if none does, say so in the change rather than
      leaving the reader to re-derive it.

      **Checked 2026-09-27: none.** The other vault writes are
      `create-document.ts` (a new note with no `doc_id` and no record, so
      nothing tracks it yet) and `vault-attachments.ts` (images, not notes).
      Front-matter writes (`writeSubmissionFrontMatter`) happen only inside
      the two submit paths above, before their baseline is taken.

## 3. Make the row say both things

- [x] 3.1 `renderDocumentRow`: render the state label whenever a state is
      resolved, and the edited marker alongside it rather than instead of it
      (design.md decision 4).
- [x] 3.2 Decide what the marker reads as now that it sits beside a state
      rather than standing alone — design.md's second open question.
      "Edited — not sent yet" was written to be the row's only label and is
      long for a second one at sidebar width.

      **Decided: "Unsent edits"**, in the warning colour
      (`.docs-publisher-document-edited`). First shipped in the accent
      colour, which in the author's theme is the link colour, so it looked
      like a second "Open in GitLab" (observed 2026-09-27).
- [x] 3.3 Confirm the row does not wrap or clip at panel width with both
      labels present. `docs-publisher-document-state` does not wrap, and a
      clipped label was already fixed once on the restore section.

      OBSERVED 2026-09-27, first build: nothing clipped, but at default
      width the row wrapped BETWEEN the state and the marker, leaving
      "Unsent edits" on the link's line. Fixed by wrapping both in one
      `nowrap` unit (`.docs-publisher-document-labels`). Second build,
      observed at two widths: one line when wide; when narrow the state and
      marker drop together to the next line and the link below them.
- [x] 3.4 A document with no resolved state still shows the marker and no
      state label, rather than inventing one.

## 4. Prove it

- [x] 4.1 Unit-test `hasLocalEdits` against a baseline written by the new
      helper: unchanged note reads not-edited, edited note reads edited,
      absent baseline reads not-edited.
- [x] 4.2 Unit-test the reset path: after a reset the document reads
      not-edited, and after an edit following a reset it reads edited.
      These are the two the bug got wrong, so they are the two that matter.
- [x] 4.3 Unit-test that the baseline update leaves state, branch and path
      untouched — the property the `doc-authoring` spec turns on.
- [x] 4.4 `npx tsc --noEmit` and `npm test` clean.

## 5. Observe it, because the bug was invisible to tests

- [x] 5.1 In a real vault: submit a document, do not touch it, refresh. Its
      row shows its state and NO edited marker. This is the symptom that
      started the change and no unit test would have caught it — the
      staleness was in Obsidian's stat cache, not in the comparison.
- [x] 5.2 Reset a document under review, refresh. Its row shows its state and
      no edited marker.
- [x] 5.3 Edit a submitted document, refresh. Its row shows its state AND the
      marker, both readable at panel width.
- [x] 5.4 Confirm a settled, untouched document now partitions as settled —
      `needsAuthor` returns false once `edited` is false, so the "nothing is
      waiting for review" empty state becomes reachable for the first time.

      **§5 OBSERVED 2026-09-27** on `gitlab.com/styl-group1/kb-docs`, vault
      build of this change:
      - 5.1: `test-002` submitted, untouched — not listed. Stored baseline
        `1790500471804` equals the note's disk mtime to the millisecond, so
        it was taken after the front-matter write.
      - 5.2: `probe-review` reset — not listed; baseline recorded.
      - 5.3: then edited — listed as "Waiting for review" + "Unsent edits".
      - 5.4: after the reset, "Nothing is waiting for review right now".
      Note: the first attempt ran the 09-22 build, because `install.sh`
      copies `main.js` without building it. Run `npm run build` first.

## 6. Close what this unblocks

- [x] 6.1 Strike §D0b and §D0c's severity note in `docs/ce-verification.md`,
      recording the date and what was fixed, per that file's own recording
      rule.
- [x] 6.2 Correct §D0a, which currently explains the disappearing-on-submit
      behaviour as `needsAuthor` working correctly AND records that the
      explanation is unreliable because the race makes it timing-dependent.
      With the race gone it is simply the design, and the entry should say so.
- [x] 6.3 Note in `verify-against-target-instance`'s tasks.md that D1, D8 and
      D9 are now readable — they were blocked on the list being unable to
      report a state.
