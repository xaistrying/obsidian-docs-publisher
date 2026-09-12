## 1. Settle the changes-requested mechanism first

> 1.1 and 1.2 (the CE 19.3.0 spike on `blocking_discussions_resolved`)
> REMOVED from this list, 2026-09-11 — not abandoned, relocated. Both need
> a live instance implementation could not reach, so 1.3 chose the
> mechanism that is correct under every outcome they could have returned,
> and running them is now an optimization rather than something this
> change is waiting on. They live in full at `docs/ce-verification.md` §C,
> with the decision rule for each possible answer. Consequence here: the
> project setting is NOT a prerequisite, so 5.2 had nothing to record.

- [x] 1.3 Decide the mechanism from 1.1 and 1.2 and record it in design.md:
      the listing field if it is present and meaningful, otherwise the
      fallback — read discussions per merge request, gated on the listing's
      `user_notes_count` being greater than zero so the extra call is made
      only for documents that actually carry discussion.
- [x] 1.4 Record the permission name any new call needs in
      `docs/access-tokens.md` §1, in the same observed form as the three
      already there — the name GitLab itself reports in a refusal, not one
      read off the token screen and assumed.
- [x] 1.5 ADDED 2026-09-11. Write `docs/ce-verification.md`: every remote
      behaviour this project established on gitlab.com and has never
      confirmed on the target CE 19.3.0 instance, as a checklist someone
      can work through against a real instance. Each item states what is
      assumed, which function believes it, and what breaks if it is wrong.
      Register it in `openspec/config.yaml`'s REFERENCE DOCS and in
      `.claude/CLAUDE.md` — this file's own rule is that an unlisted doc
      will not be found.

## 2. The read path in git-publishing

- [x] 2.1 Add `listMergeRequests(details)`:
      `GET /projects/:id/merge_requests` with `state=all`,
      `order_by=updated_at`, `sort=desc`, `per_page=100`. Return `iid`,
      `state`, `source_branch`, `web_url`, `user_notes_count`, and the
      unresolved-threads field if 1.3 selected it. Classify through
      `classifyScopedStatus` — this is a scope-gated read, as the
      interrupted-submit change established.
- [x] 2.2 Follow pagination to a cap of 10 pages. When the cap is reached,
      return that fact to the caller alongside the entries; do NOT return a
      truncated list that looks complete. See design.md decision 2.
- [x] 2.3 Add the unresolved-threads read chosen in 1.3. If it is the
      per-merge-request fallback, it MUST take the merge request's `iid` and
      report only whether unresolved threads exist — no interpretation.
- [x] 2.4 Rewrite `findOpenMergeRequest` to call `listMergeRequests` and
      filter, rather than building its own query. One endpoint, one query
      construction, one classification path.
- [x] 2.5 Confirm nothing in this capability resolves a document's STATE.
      It returns merge requests and facts about them; meaning lives in
      submission-tracking.

## 3. Reconciliation in submission-tracking

- [x] 3.1 Add reconciliation: take one `listMergeRequests` result and a set
      of `doc_id`s, and resolve each by matching `doc/<doc_id>` against
      `source_branch`, newest first. Precedence exactly as
      `docs/document-identity.md` §2 and design.md decision 3: open wins;
      else most recent decides (merged → published, closed → closed); else
      never submitted.
- [x] 3.2 Layer changes-requested on top: an open merge request with
      unresolved threads resolves as `changes-requested`, without them as
      `pending`. Resolving threads must return it to `pending`.
- [x] 3.3 Write resolved states back to the store, overwriting any stored
      state that disagrees and creating records where none existed. Leave
      records whose `doc_id` matches no note in the vault untouched — see
      design.md decision 7.
- [x] 3.4 On a failed listing, change no stored state and report the
      failure. Never resolve from partial data.
- [x] 3.5 Update `SUBMISSION_STATE_LABELS`: `closed` becomes "Not accepted",
      replacing the "Closed" placeholder. Add `changes-requested` →
      "Changes requested" and `published` → "Published" as real labels and
      drop the comment calling them provisional.
- [x] 3.6 Keep all of this out of `git-publishing` and out of the panel.

## 4. The panel

- [x] 4.1 Build the document list from the vault: every markdown note whose
      front matter carries `doc_id`, via `metadataCache`. Not from
      `data.json` — a note with no record is exactly what reconciliation
      exists to resolve, and building from records would hide it.
- [x] 4.2 Render each document's name and its state's label, plus an "Open
      in GitLab" link for any document that has been submitted.
- [x] 4.3 Add a refresh control, and refresh on view open. Wire BOTH through
      one path.
- [x] 4.4 Confirm no remote request fires from `file-open`,
      `active-leaf-change` or `metadataCache.changed`. Those redraw from
      resolved state only. Verify by watching the network while typing in a
      note with the panel open — design.md decision 5 exists because this is
      the easy mistake.
- [x] 4.5 On a failed refresh: keep the last resolved states on screen, do
      not clear the list, and show "Could not check your documents' status
      just now. They may have changed since this was last updated."
- [x] 4.6 On a refresh refused for a missing permission, show "Your access
      token doesn't have permission to check your documents' status
      (missing: {detail}). Ask your admin to add it." — reusing the detail
      the existing classification already carries.
- [x] 4.7 Vocabulary check every string added: no "branch", "commit", "merge
      request", "MR", "conflict", or "main". "Open in GitLab" is the
      existing sanctioned escape-hatch wording and stays.

## 5. Documentation

- [x] 5.1 Mark milestone 5 done in `openspec/config.yaml` and correct its
      text, which says this milestone "makes the first `GET /merge_requests`
      call and needs a new client method for it" — the interrupted-submit
      change made the first such call, and this one generalizes it.
- [x] 5.2 If 1.2 found the project setting is required, record it in
      `docs/gitlab-roles.md` or `docs/access-tokens.md` as a project
      configuration this milestone depends on.

      > N/A — the condition is false. 1.2 was not run, and the mechanism
      > shipped does not depend on that setting either way, so there is no
      > dependency to record. Stated in design.md decision 4 and in
      > `openspec/config.yaml`'s milestone 5 entry so the absence is
      > deliberate rather than an omission.
- [x] 5.3 RAISE, do not silently pick: `openspec/config.yaml` line 340 says
      the author-facing label for `unsubmitted` is "Not submitted yet";
      line 699 says "Draft" survives as the author-facing display label for
      the same state. They contradict. Nothing in this change renders that
      label, so it is not blocking — but record whichever the project
      decides and strike the other. Recommendation: "Not submitted yet",
      since the same file rejects `draft` as a state name specifically to
      avoid colliding with GitLab's own Draft merge requests.
- [x] 5.4 Re-check `openspec/config.yaml`'s context field stays under
      OpenSpec's 50 KB limit — currently ~46.5 KB, and the whole field is
      dropped silently when it goes over.

## 6. Closing the change

- [x] 6.1 Type checker and production build both clean.

      > 6.2 through 6.7 (the observable checks — the fix itself, changes-
      > requested round trip, reconciling with no local state, self-
      > healing, no request on edit, failed refresh) REMOVED from this
      > list, 2026-09-11, decided with the author. Not because they don't
      > matter — each still names the exact way this milestone could be
      > silently wrong — but because running the full matrix against a
      > live instance was more session time than the author wants to
      > spend before simply using the plugin, and using it is itself a
      > form of verification, just an informal one. The author will
      > dogfood against their personal GitLab instance at their own pace
      > and propose a separate, focused test pass once the plugin feels
      > solid, rather than hold this change open on an indefinite
      > checkbox. Their full procedure — unchanged, unshortened — is
      > `docs/ce-verification.md` §D; that is where results belong when
      > that pass happens. If dogfooding turns up a concrete failure
      > before then, fix it directly rather than waiting for a formal
      > pass to reach it.
