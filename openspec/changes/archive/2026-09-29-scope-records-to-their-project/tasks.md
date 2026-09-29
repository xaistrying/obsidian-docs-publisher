## 1. Give a record somewhere to say where it came from

- [x] 1.1 Add the project to `SubmissionRecord` — the platform address and the
      canonical numeric project id — optional, since every existing record
      lacks it. Document what ABSENT means in the field's own comment: not
      known, and therefore not the configured project (design.md decision 1).
- [x] 1.2 Widen `ProjectAccess` to carry the canonical numeric `id`. The
      response to `GET /projects/:id` already contains it and the type drops
      it; the connection check already makes that call, so nothing new is
      requested (design.md decision 2).
- [x] 1.3 Add one comparison used everywhere — "does this record belong to the
      configured project" — so no surface writes its own. It answers FALSE for
      an absent project, which is the whole point.

## 2. Stamp on evidence

- [x] 2.1 In `writeBack`, stamp a matched record with the configured project.
      A match means reconciliation found its `doc_id` on that project, which is
      the evidence decision 1 requires.
- [x] 2.2 Leave unmatched records exactly as they are — `writeBack` already
      `continue`s past them. Do not stamp, do not clear, do not delete. An
      unmatched record may belong elsewhere, and guessing is what this change
      removes.
- [x] 2.3 Record the project on submit, both paths (`submit-document.ts`),
      since a successful write establishes the project as firmly as a match
      does.

## 3. Stop the fallback resurrecting a foreign state

- [x] 3.1 `renderDocumentRow`: apply `status.submission?.state ?? stored?.state`
      ONLY when the record belongs to the configured project. The fallback
      exists for imported documents and stays for them.
- [x] 3.2 `renderSubmitSection`: derive the label and the action from the same
      answer as the row, not from `resolveSubmission(file)` directly. This is
      the specific line that said "Send update" while the row said nothing.
- [x] 3.3 Check every other surface that reads a stored state — the partition,
      the restore list, discovery's exclusion — and make each consult the same
      comparison. If any is left out it becomes the next §D0h.
- [x] 3.4 A document whose record is foreign or unstamped still offers a FIRST
      submission. Submitting into the configured project is something the
      author can genuinely do, and refusing it would strand them.

## 4. Prove it

- [x] 4.1 Unit-test the comparison: same project by id and by path both match;
      same path on a different host does not; an absent project does not.
- [x] 4.2 Unit-test stamping: a matched record gains the project; an unmatched
      one is untouched; a record already stamped with a different project is
      not silently overwritten by a match — decide and assert which, because
      that case is reachable and the spec does not name it.
      DECIDED: not overwritten — `doc_id` is repo-scoped, so a match is not
      evidence against a record that already names another project, and left
      whole it is intact on pointing back (`tests/project-scope.test.ts`).
      OBSERVED 2026-09-29 in the running plugin: `test-009` stamped with
      project 1 while its merge request is open here; a Refresh that was
      forced to write (another record's state corrected in the same pass) kept
      it at project 1. The row shows the live state regardless — silent only
      while a refresh is in flight. COST: such a record never heals by
      itself — no stored fallback, never offered for Restore — until the next
      submit rewrites it. Reachable only by a real submission to another
      project under the same `doc_id`, i.e. the collision the proposal puts
      out of scope.
- [x] 4.3 Unit-test resolution: an imported document whose record belongs here
      still reads published; one whose record belongs elsewhere reads as no
      state.
- [x] 4.4 Unit-test that the resubmit action is withheld for a foreign record
      and that a first submission is still offered.
- [x] 4.5 `npx tsc --noEmit` and `npm test` clean.

## 5. Observe it, on the case that found it

- [x] 5.1 In a real vault: submit documents to project A, refresh so they are
      stamped, then point the plugin at project B and refresh. No document
      shows a state, none offers a resubmit action, and none reads "Send
      update" — which is exactly what §D0h saw.
- [x] 5.2 Point back at project A and refresh. Everything returns. The records
      were never destroyed, only disregarded while they did not apply.
- [x] 5.3 On a vault whose records predate this change, confirm ONE refresh
      stamps them and nothing looks different afterwards. Time how long the
      window lasts where documents show no actions — design.md calls that the
      whole visible cost in the common case, and it is worth knowing whether
      that is true.
      OBSERVED 2026-09-29: stamps stripped from all 19 records; one Refresh
      rewrote `data.json` byte-identical to the pre-strip backup (16 stamped,
      the same 3 unstamped), panel matched the before screenshot. 28 s from
      backup to restamp, INCLUDING restarting Obsidian and Test connection.
      design.md's "one refresh" is wrong about what bounds the window: nothing
      refreshes on a verified connection, so it lasts until the author presses
      Refresh. The 3 left unstamped are `test-1`/`test-123` (pre-change imports,
      never stampable) and `probe-test` (presumably no merge request on this project — not yet
      checked in GitLab).
- [x] 5.4 Confirm a document with a foreign record can still be submitted into
      the configured project, and that its record afterwards names the new one.

## 6. Decide the message, once the inert state can be seen

- [x] 6.1 design.md's open question: should the panel SAY why a document has no
      actions? "This document belongs to a different project" is true and
      useful, and it is a new message on a surface this change otherwise only
      removes things from. Decide it after 5.1, when the silence can be judged
      rather than imagined.
      DECIDED 2026-09-29, from the running panel (`test-1` stamped with
      another project beside unstamped `test-123` — indistinguishable): mark
      a record naming ANOTHER project, with no live answer here, "In another
      project" (row and open-note status line); leave an UNSTAMPED record
      unmarked, since "another project" would assert what nothing
      established. The silence cost was concrete: the foreign row sits in
      Needs you beside a "Submit for review" that submits into the configured
      project. `inAnotherProject` in `document-status.ts`; spec delta amended.

## 7. Close what this settles

- [x] 7.1 Strike §D0h in `docs/ce-verification.md` (archived under
      `openspec/changes/archive/2026-09-29-verify-against-target-instance/`),
      with the date and what changed.
- [x] 7.2 Re-run `correct-stale-records`'s tests if that change has landed.
      The two touch `reconcile.ts` and `document-status.ts` in common and do
      not contradict, but whichever lands second should verify rather than
      assume (design.md Risks).
