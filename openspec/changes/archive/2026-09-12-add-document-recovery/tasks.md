## 1. The two new reads in git-publishing

- [x] 1.1 Add `getFileContent(details, { path, ref })`:
      `GET /projects/:id/repository/files/:file_path/raw?ref=<ref>`, URL-
      encoding `file_path`. Return the three-way answer design.md decision 2
      requires — exists-with-content, absent (only on an explicit 404),
      failed — mirroring `branchExists`'s shape exactly, including reading
      the raw status the way `branchExists` does rather than trusting
      `classifyScopedStatus` alone to distinguish them.
- [x] 1.2 Classify through `classifyScopedStatus`. Record whatever
      permission name a refusal reports in `docs/access-tokens.md` §1 and
      `docs/ce-verification.md`, in the same observed-not-assumed form as
      the existing entries — this is a new, unobserved permission.
- [x] 1.3 Add `getMergeRequestChangedPath(details, iid)`:
      `GET /projects/:id/merge_requests/:iid/changes`. Return the single
      changed path when there is exactly one; report "could not be
      determined" for zero or more than one, per design.md decision 1 —
      never guess among several.
- [x] 1.4 Confirm nothing in this capability decides whether a document IS
      recoverable, or what a document's remote path SHOULD be. It returns
      content and paths as facts; that decision lives in submission-tracking.

## 2. Recovery resolution in submission-tracking

- [x] 2.1 Add `path` to `SubmissionRecord`, optional, captured at submit
      time going forward. Confirm `isPluginData`-style guards still accept
      records that lack it — every record persisted before this change does.
- [x] 2.2 Add `recover.ts`, alongside `reconcile.ts` and not inside it (see
      design.md decision 6). Given a `SubmissionStore` and the set of
      `doc_id`s the vault currently has notes for, resolve the complement —
      records with no matching note — to one of: recoverable-with-path,
      recoverable-via-merge-request-fallback, or not-recoverable.
- [x] 2.3 The fallback: for a record with no stored path, call
      `findOpenMergeRequest` for its branch (unchanged, already built) and,
      if one is open, `getMergeRequestChangedPath` for its `iid`. Anything
      other than exactly one path resolves as not-recoverable, never as a
      guess.
- [x] 2.4 Add the actual content fetch, called only when recovery is
      requested for one specific record — never as part of resolving which
      records are recoverable. See tasks 4.2 and design.md decision 7.
- [x] 2.5 OPEN QUESTION FROM DESIGN.MD: decide whether a record recovered
      via the merge-request fallback has its `path` backfilled once recovery
      succeeds. Decide it here, at the point the write path's actual shape
      is known, not before.
      DECIDED: yes. `main.ts`'s `recoverDocument` backfills `path` onto the
      stored record immediately after a successful write, whenever the
      record it recovered from had none — it costs one extra `store.save`
      only in that case, and the discovered path is already in hand.

## 3. The collision pre-flight and the recovery write in doc-authoring

- [x] 3.1 In `submit-document.ts`, insert the new check between deriving
      `docId` and the existing `clearPreviousAttempt` call, gated on
      `readDocId` having returned null (design.md decision 5) — a document
      that already carries a `doc_id` never runs this check against itself.
- [x] 3.2 The check: `getFileContent(details, { path: file.path, ref:
      <default branch> })`. Exists → refuse the submit, write nothing,
      surface the content for the recovery offer in task 3.3. Absent →
      proceed to the existing pre-flight unchanged. Failed → refuse the
      submit; never read a failed check as absence (design.md decision 2,
      the same mistake `branchExists`'s own design note warns against).
- [x] 3.3 Wire the refusal to the SAME recovery write task 3.4 builds, so
      the author's next action from either path — the panel's orphaned-
      record list, or a blocked first submit — is identical.
- [x] 3.4 Add the recovery write, alongside `create-document.ts`: given a
      path and content, refuse outright if a note already exists at that
      exact path (design.md decision 3); otherwise create the note there
      verbatim. Never appends a disambiguating suffix the way
      `createDocument`'s `freePath` does — a recovered note's path is not
      incidental.
- [x] 3.5 Vocabulary check every string this task adds: no "branch",
      "commit", "merge request", "MR", "conflict", or "main". "Open in
      GitLab" is the existing sanctioned escape-hatch wording and stays
      for the not-recoverable case.

## 4. The panel

- [x] 4.1 Add the "Documents you can recover" section: `SubmissionStore`'s
      keys minus `listVaultDocuments`'s keys, resolved through
      `recover.ts`'s local-only classification (task 2.2) — no remote call
      to render this list (spec: "Recovery fetches content only when the
      author asks for it").
- [x] 4.2 Recoverable rows get a Recover button that fetches content for
      THAT record only, then calls the write from task 3.4. Non-recoverable
      rows get the explanation and the existing "Open in GitLab" link,
      built from the record's `mrIid`/`branch` exactly as the main list
      already does.
- [x] 4.3 Confirm this section renders from local data on every normal
      render pass (same render/refresh split as the main list) and issues a
      request only on a Recover press — watch the network while the panel
      re-renders from an unrelated note edit, the same check
      add-document-status's 4.4 already established the habit of running.

## 5. Documentation

- [x] 5.1 Record the new permission(s) in `docs/access-tokens.md` §1 and
      `docs/ce-verification.md`, per task 1.2 — this file's own rule that an
      unrecorded fact will not be found applies here too.
- [x] 5.2 Update `openspec/config.yaml`'s milestone list if this lands as
      its own milestone rather than folded into an existing one — decide at
      implementation time which numbering this occupies; not decided here to
      avoid a second silently-wrong cross-reference the way milestone 5's
      text once was.
      DECIDED: numbered `5a`, on the same convention as `4a`/`7a` — it
      extends milestone 5 rather than sitting between two other milestones.

## 6. Closing the change

- [x] 6.1 Type checker and production build both clean. Both run
      2026-09-11: `npm run typecheck` and `npm run build` succeed with no
      errors (one incidental fix needed along the way — `SubmissionStore
      .allRecords()` used `Object.values`, which this project's `tsconfig`
      lib target does not declare; rewritten as `Object.keys` plus a map).
- [x] 6.2 Observable check — RECOVER, FAST PATH. Submit a document after
      this change ships (so its record carries a stored path), delete its
      note, confirm the panel offers Recover, and confirm recovering it
      recreates the note at its original path with its original content.
- [x] 6.3 Observable check — RECOVER, LEGACY FALLBACK. Using a record from
      before this change (no stored path) whose merge request is still
      open, confirm the panel still offers Recover via the merge-request
      fallback and it succeeds.
- [x] 6.4 Observable check — NOT RECOVERABLE. Using a record whose merge
      request has since merged or closed and which carries no stored path,
      confirm the panel states recovery is not available and offers only
      "Open in GitLab".
- [x] 6.5 Observable check — REFUSE, DON'T OVERWRITE. With a note already
      occupying a recoverable document's exact path, attempt to recover it
      and confirm nothing is overwritten and the refusal is stated plainly.
- [x] 6.6 Observable check — THE COLLISION FIX. From a second, unrelated
      local vault (or a fresh note with no `doc_id`), submit a document
      whose filename matches one already published on the remote. Confirm
      the submission is refused before any write, the author is told a
      document already exists, and the offered recovery action retrieves
      the actual published content.
- [x] 6.7 Observable check — NO FALSE COLLISION. Confirm an ordinary
      revision of a document this vault already tracks (has its own
      `doc_id`) is never blocked by the new check.

### Pre-existing bug found and fixed, discovered manually testing beyond 6.2-6.7

Found 2026-09-11, testing "recover a MERGED document, then revise it" — a
sequence none of 6.2-6.7 as worded actually covers (6.2 recovers a document
whose merge request is still open; 6.6 is a collision from a different
vault, not a revision of one's own recovered document). Worth adding as its
own observable check before this change is archived: recover a document
whose merge request has already merged, edit it, click Submit for review,
and confirm it proceeds as an ordinary revision rather than refusing.

`performSubmit` (`submit-document.ts`) has always read a note's content
BEFORE `writeSubmissionFrontMatter` runs, since that write is deliberately
deferred until after the remote write succeeds (`doc_id` has no rollback
path). Consequence, present since milestone 4 and invisible until now: a
document's FIRST commit never carried `title`, `category` or `doc_id` — only
a note's own later local edit did, and nothing ever read that commit's
content back to notice. This silently contradicted `docs/document-identity.md`
§2 ("doc_id is committed with the note"), and recovery is the first thing
that actually depends on that guarantee: a recovered document that was never
revised again comes back with NO `doc_id`, which (a) `listVaultDocuments`
then never lists in "Your documents", and (b) makes the next submit's
`existingDocId` read null, re-triggering the path-collision pre-flight
against the author's OWN document.

FIXED: `front-matter.ts` gained `withSubmissionFrontMatter`, a pure string
merge (touches no file) used only on a first submit
(`existingDocId === null`) to compute what gets COMMITTED, so the remote copy
carries the same three fields the local note gets moments later. The local
write's timing and its no-rollback safety property are unchanged.

NOT retroactively fixed: a document already merged before this landed is
permanently missing these fields in that historical commit. Recovering one
recreates a note with no `doc_id`; manually adding `doc_id: <its own
filename, without the extension>` to that note's front matter (it already
sits at its correct, original path per recovery's own guarantee) unblocks
its next submit as an ordinary revision.
