## 1. Widen reconciliation's scope

- [x] 1.1 In `refreshDocumentStatuses`, build the work list from the UNION of
      the vault's `doc_id`s and the `doc_id`s of stored records, rather than
      from `listVaultDocuments` alone.
- [x] 1.2 Keep the early return for "nothing to ask about" honest: it must
      now mean no vault documents AND no stored records, not just an empty
      vault. A vault with records but no notes has plenty to ask about.
- [x] 1.3 Confirm `reconcileDocuments` needs no change — it already takes a
      list of `doc_id`s and makes one listing for all of them. If it does need
      one, say why here, because design.md decision 1 assumes it does not.
      DONE: no change. It resolves whatever `doc_id`s it is given against one
      listing.
- [x] 1.4 Confirm `writeBack` still carries `path` and `mtime` forward for an
      orphaned record. This is decision 2, and the failure mode is silent: a
      correction that drops `path` breaks a later Restore while appearing to
      fix a listing.
      DONE: no change. It builds `path: stored?.path, mtime: stored?.mtime`
      whether or not a note exists. Pinned by 4.2.

## 2. Make the restore list self-emptying, as it always claimed to be

- [x] 2.1 No code change expected in `restorableDocuments` — correcting the
      records it reads is the whole fix. Verify that, and if a change IS
      needed, treat it as a sign the diagnosis was wrong rather than patching
      the symptom.
- [x] 2.2 Update `restorableDocuments`' comment. It currently asserts "Every
      document here leaves on its own", which was false for exactly the
      documents on the list. Say what makes it true now, so the next reader
      does not re-derive the bug.
- [x] 2.3 Verify `discoveryCandidates` needs no change either: once records
      are corrected, a merged document leaves the restore list and stops being
      excluded from the import list by itself.
      DONE: `discoveryCandidates` needed no change. The CALL ORDER did.
      `main.ts` fired both refreshes together, and
      `refreshDiscoverableDocuments` reads `restorableDocuments` before its
      first `await`, which is before reconciliation has corrected anything.
      A merged orphan would have shown up for import only on a SECOND
      Refresh, and 5.1 would have failed. Discover now runs after
      reconciliation finishes. This file is not listed in proposal.md's
      Impact.

## 3. Record before front matter

- [x] 3.1 On the first-submit path in `submit-document.ts`, move the
      `store.save` above `writeSubmissionFrontMatter`.
- [x] 3.2 Keep the edit baseline describing the note AFTER the front-matter
      write — record the document early, then update the baseline with
      `saveEditBaseline` once the note is final (design.md decision 4). Do not
      capture a baseline before the write and do not write the full record
      twice.
- [x] 3.3 Check the resubmit path for the same ordering hazard. It writes no
      front matter on a revision, so it may already be safe; if it is, say so
      rather than leaving the reader to check.
      DONE: safe. `pushUpdate` writes front matter only for an imported
      document's first submit, and that note already carries `doc_id`. If
      the write fails there, reconciliation still finds the note and creates
      its record. The published and closed resubmit paths go through
      `openNewCycle`, so they get the new ordering too.

## 4. Prove it

- [x] 4.1 Unit-test that reconciliation covers a stored record with no note:
      a record left at `pending` whose merge request is merged resolves to
      published and is corrected on disk.
- [x] 4.2 Unit-test that the correction preserves `path` and `mtime`. This is
      the silent one from 1.4.
- [x] 4.3 Unit-test that `restorableDocuments` drops a record once its state
      is corrected — the self-emptying property, asserted rather than assumed.
- [x] 4.4 Unit-test the submit ordering: with the front-matter write made to
      fail, a tracking record still exists afterwards.
- [x] 4.5 `npx tsc --noEmit` and `npm test` clean.

## 5. Observe it, on the case that found it

- [x] 5.1 In a real vault: submit a document, delete its note, merge its merge
      request, Refresh. It leaves "Documents you can restore" and appears
      under "Documents you can import". That exact sequence is §D0f and it
      left a permanent row.
- [x] 5.2 Repeat with the review CLOSED rather than merged. It leaves the
      restore list and appears in neither, since a not-accepted document is
      deliberately offered nowhere.
- [x] 5.3 Confirm an existing stale row is repaired rather than only
      prevented: with a vault already carrying one, the first refresh after
      this change clears it.

## 6. Close what this unblocks

- [x] 6.1 Strike §D0f in `docs/ce-verification.md`, with the date and what
      changed, per that file's own recording rule.
- [x] 6.2 Amend §D0e: the orphaning is prevented, the ROOT CAUSE is not
      diagnosed, and the two should not be conflated when the entry is read
      later.
- [x] 6.3 Note in §E6 that the import check is no longer blocked — a document
      whose note was deleted before its merge can now reach the import list,
      which is the natural way to set that check up.
- [x] 6.4 State plainly, in the change and in §D0e, that documents ALREADY
      orphaned are not recovered by this: their notes carry no `doc_id`, so
      nothing links them to records they never got. The author adds the
      `doc_id` by hand and reconciliation reconnects them, as was done for
      `test-006`. Nobody should go looking for an automatic repair.
      STATED HERE: this change repairs stale records, but it does not repair
      notes that were already orphaned. For those, add `doc_id` by hand.
