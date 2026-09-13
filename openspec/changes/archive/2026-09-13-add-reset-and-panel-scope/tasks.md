## 1. submission-tracking: the reset read and its eligibility rule

- [x] 1.1 Add a branch-only content read for reset — the document's path
      on its own tracked branch, three-way (found / absent / failed), with
      NO default-branch fallback (design.md decision 1).
- [x] 1.2 Confirm `fetchRecoveryContent` is left exactly as it is: its
      fallback is correct for recovery and wrong here, which is why this
      is a separate read rather than a shared one with a flag.
- [x] 1.3 Add the resettable rule: pending and changes-requested only;
      published, not-accepted, never-submitted and unresolved all report
      not-resettable.

## 2. doc-authoring: the overwrite write path

- [x] 2.1 Add the reset write alongside `recover-document.ts` — replaces
      an EXISTING note's content, the opposite guard from
      `recoverDocument`'s refuse-when-occupied.
- [x] 2.2 Write the remote's content verbatim, front matter included; no
      tracking-record write, no state change, no front-matter re-assertion
      (design.md decision 5).
- [x] 2.3 Refuse and report when the read answers absent or failed — never
      substitute content from another ref.
- [x] 2.4 Gate it the same way `recoverDocument` and `createDocument` are
      (`requireAuthoringGate`), so hiding the control is never what
      enforces the gate.

## 3. doc-authoring: the confirmation

- [x] 3.1 Add the confirmation modal: names that local changes to this
      note will be replaced by the version under review, dismissible
      without writing anything.
- [x] 3.2 Confirm every route to the overwrite passes through it — no
      setting, no option, no second code path (design.md decision 3, and
      the condition `openspec/config.yaml`'s amended NO CI PIPELINE
      decision makes this change conditional on).
- [x] 3.3 Vocabulary-check the copy: no "branch", "commit", "merge
      request", "MR", "conflict", or "main".

## 4. plugin-shell: the two sections

- [x] 4.1 Partition `renderDocumentList`'s entries by resolved state:
      never-submitted and unresolved and pending and changes-requested to
      the primary section; published and closed to the secondary one.
- [x] 4.2 Add the secondary section, absent entirely when empty — the
      same way "Documents you can recover" already is.
- [x] 4.3 Confirm an unresolved document lands in the primary section, not
      the secondary (design.md decision 4 — placing it there would assert
      a settled state nothing established).
- [x] 4.4 Add the secondary section's lower-prominence styling in
      `plugin/styles.css`.
- [x] 4.5 Settle the secondary section's heading copy — "Other documents"
      is a working name (design.md open question).

## 5. plugin-shell: the Reset control

- [x] 5.1 Add Reset to `renderSubmitSection`, beside the resubmit action,
      for the currently open note only.
- [x] 5.2 Offer it only when that note's resolved state is pending or
      changes-requested; render nothing for any other state.
- [x] 5.3 Confirm no row in either document list carries a Reset control
      (design.md decision 2).
- [x] 5.4 Confirm `renderSubmitSection`'s existing resubmit action is
      unchanged by this work.

## 6. Verification

These need a real instance and a running vault. Recorded as `D9` in
`docs/ce-verification.md` per that file's own rule — run and record them
there, and tick these off from what it says.

- [x] 6.1 Reset a document with local edits in each of pending and
      changes-requested against the real instance; confirm the note
      afterwards matches the branch's content byte for byte, front matter
      included.
- [x] 6.2 Confirm dismissing the confirmation writes nothing.
- [x] 6.3 Confirm a document whose review ended between the last refresh
      and the Reset refuses cleanly, leaving the note untouched, rather
      than pulling default-branch content.
- [x] 6.4 Confirm the two sections partition correctly across all five
      states, including a document with no resolved state.
- [x] 6.5 Confirm the resubmit actions shipped by add-resubmission-
      lifecycle still work for published and not-accepted documents after
      the narrowing — they render for the open note and are unaffected by
      which section that document is listed in.

## 7. Documentation upkeep

- [x] 7.1 Mark milestone 5b done in `openspec/config.yaml`, keeping the
      entry terse — that file is at ~45KB against a 50KB limit past which
      the whole context field is silently dropped.
- [x] 7.2 Update `docs/panel-tracking-scope.md`'s 5b half to describe
      shipped behaviour, leaving the milestone 9 half untouched.
