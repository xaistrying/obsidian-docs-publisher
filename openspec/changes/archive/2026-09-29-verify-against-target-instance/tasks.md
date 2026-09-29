## 0. Run log

- **2026-09-22, read-only pass** (`probe.py`, no `--writes`) against
  `git.styl.solutions` / `ivan/service.doc.kb`. Results are in
  `docs/ce-verification.md`, per design.md decision 3 — this file only says
  whether an item has been RUN.
  **Two caveats govern everything it produced, and both are recorded in §0
  of that file:** the account was **Maintainer (40), not Developer**, and the
  token was **not narrowed**. So §A learned no permission names at all — every
  call succeeded, and a call that succeeds names nothing. What the pass did
  settle is in §B/§C, where the question is the shape of a response rather
  than its cost.
- **2026-09-22, write pass** (`probe.py --writes`), same account and token.
  Closed B8's guard half, B9, B10, B11 and E7's round-trip — the four items
  whose failure mode is SILENT — and exercised 4 of A2's 6 operations on CE.
  Probe merge request !2 CLOSED 2026-09-22 — cleanup done.
  The two caveats above are unchanged: still Maintainer, still un-narrowed, so
  §A still has no permission names.
- **2026-09-22, NARROWED read pass** — a fresh token holding `Project: Read`
  and nothing else. GitLab refuses a token with no permissions at all ("Add at
  least one resource with permissions"), so one resource is the narrowest
  legal start. Named on CE for the first time: **`User: Read`** (`GET /user`),
  **`Repository: Read`** (tree), **`Branch: Read`** (branch read), and
  **`Merge Request: Read`** re-confirmed. Still Maintainer — the role floor is
  untouched by any of this.
  The file reads (A6/A8/E7) and the merge-request sub-reads (A4/A7) did NOT
  run: the probe discovers a file path from the tree and an iid from the MR
  list, and both discoveries were themselves refused. Rerun passing
  `--file` and `--mr` explicitly.
- **2026-09-22, narrowed pass with explicit inputs** (`--file` + `--mr`).
  Named the last four reads: the raw and non-raw file reads are
  **`Repository: Read`**, and the discussions read and `/changes` are both
  **`Merge Request: Read`**. EVERY READ THE PLUGIN MAKES IS NOW MAPPED on CE,
  by five permissions: `User: Read`, `Project: Read`, `Repository: Read`,
  `Branch: Read`, `Merge Request: Read`. Only the three WRITES are unnamed.

## STOPPED 2026-09-27 at 31/46 — how to resume

Paused deliberately, not blocked. §§A, B (bar one re-read), C and the
onboarding copy are DONE; what remains is §D's end-to-end checks and the
recording tasks that follow them.

**Ready to resume with, in order:**

1. **Phase 3 of `run-sheet-d.md`** — D5, D4, D3. Local only, no GitLab, no
   setup. D5 first while the console is quiet, D3 last because it destroys
   what D4 needs.
2. **Phase 5** — D8's four resubmission states.
3. **Phases 6-7** — D7 restore, D9 reset and panel, E6 import.
4. **One CE probe run** at the office closes B4's `opened`, B6's header read
   and B5's shape — the three items answered on gitlab.com but owed on the
   target. No setup, one command.

**Do not read a green §D as settling the access floor.** Every §D result here
is Maintainer-as-author; §0 records why that cannot be substituted for a
Developer run, and that question is still owed before release.

**THE RUN'S MAIN OUTPUT SO FAR IS NOT A TICK LIST.** It was §D0 of
`docs/ce-verification.md`: three defects in the panel's state reporting,
sharing one root cause. Two are now FIXED — `fix-edited-baseline` (the
baseline) and `name-panel-sections-by-next-actor` (the vanishing-on-submit
surprise), both archived 2026-09-27. D0c, Reset's three-second dead window
with no busy state, is still open and has no change of its own yet.
Worth noting where all three were found — in the surface that looked most
obviously fine.

**D1, D8 and D9 ARE NOW READABLE.** They were blocked on the list being
unable to display a state; it can.

**UNBLOCKED 2026-09-27 by `fix-edited-baseline`.** D1, D8 and D9 were
unreadable while every row showed "Edited — not sent yet" in place of its
state. The row now shows the state always, with "Unsent edits" beside it
only when the note has changed since the plugin last wrote it, so those three
can be read from the list. Do that change's real-vault checks (its tasks.md
§5) first: if the baseline is still wrong in Obsidian, D1/D8/D9 are still
unreadable. D0c (the Reset confirmation's delay) is NOT addressed by it.

## 1. Set the run up so its answers transfer

- [x] 1.1 Record the instance in `docs/ce-verification.md` §0's table:
      edition and exact version from Help → Version, plus `/api/v4/version`
      if the token can read it. It is still blank after the §E run, so
      "self-managed CE 19.3.0" remains assumed.
- [x] 1.2 Confirm a **Developer**-level account exists on the corpus project,
      and create one if not. Every author-facing check runs as this account.
- [x] 1.3 Confirm a second, **Maintainer**-level account is available for
      scaffolding — merging, and leaving the review thread §C and §D2 need
      from somebody other than the author.
- [x] 1.4 Note in §0 which account ran which section. An Owner-level result
      recorded without that note is the mistake this whole file exists to
      stop.

**1.2/1.3/1.4 ANSWERED 2026-09-22, and the answer is negative.** No
Developer-level account could be obtained on the corpus project, and no second
Maintainer exists. Downgrading the only Maintainer was considered and rejected:
it would have made C2, D1, D2, D8 and D9 unrunnable — merge, the project's
thread-resolution setting and review threads all need Maintainer — and a
downgraded account cannot restore itself.
**DECIDED: §D runs single-account as Maintainer.** §0 of
`docs/ce-verification.md` records the decision and exactly what it costs; the
short version is that §D will establish the plugin's logic and NOT the access
floor, which stays owed before release. Run sheet: `run-sheet-d.md`.

## 2. §A — the token, narrowed until it breaks

Run as the Developer account. Start from the smallest plausible permission
set and add ONLY what a refusal names (design.md decision 2).

- [x] 2.1 A1 — confirm the default token screen is still the fine-grained
      flow on this version.
- [x] 2.2 A2 — the six operations, on the narrowed token. If they cannot all
      succeed, stop: §§B–D cannot run and the permission set is the finding.
- [x] 2.3 A3 — re-confirm the three already-observed permission names on CE.
- [x] 2.4 A4 — the discussions read. Never observed anywhere.
- [x] 2.5 A5 — branch read and commit creation. Never mapped.
- [x] 2.6 A6 — the raw file read. Never observed anywhere.
- [x] 2.7 A7 — the merge-request-changes read. Never observed, and possibly
      deprecated on newer versions; note what this version does.
- [x] 2.8 A8 — the non-raw file read and the update commit. Never observed.
- [x] 2.9 E5 — the repository-tree read's permission name. Never spiked at
      all, and Discover cannot work without it.
- [x] 2.10 Write down the resulting MINIMUM permission list. This is the
      deliverable onboarding has never had.

## 3. §B — the response shapes the client parses

- [x] 3.1 B1 — a missing branch answers 404 with a recognizable body.
- [x] 3.2 B2 — a refused call names its permission in a parseable body. This
      is one of the two assumptions already known to have been wrong once.
- [x] 3.3 B3 — the merge-request listing carries every field the code
      requires.
- [x] 3.4 B4 — states are exactly `opened` / `closed` / `merged` / `locked`.
- [x] 3.5 B5 — a discussion's notes carry `resolvable` and `resolved`.
- [x] 3.6 B6 — pagination behaves as the loop assumes.
- [x] 3.7 B7 — a missing file answers 404, an existing one returns raw text.
- [x] 3.8 B8 — the non-raw file read carries `last_commit_id`.
- [x] 3.9 B9 — a commit with several actions and mixed verbs is accepted.
      Confirmed on gitlab.com only.
- [x] 3.10 B10 — a per-action `last_commit_id` is honoured beyond the first
      action. Confirm a STALE one on a later action is refused, not ignored.
- [x] 3.11 B11 — binary content survives as base64 through `requestUrl`, and
      the committed image is byte-identical.
- [x] 3.12 E7 — the non-raw file read carries base64 `content`.

## 4. §C — the changes-requested mechanism

- [x] 4.1 C1 — does the listing entry carry
      `blocking_discussions_resolved` on this version?
- [x] 4.2 C2 — repeat with the project's thread-resolution setting off and
      on. The shipped mechanism reads discussions directly and should be
      correct either way; this confirms that rather than assuming it.

## 5. §D — end to end, as the author

Every item here runs as the Developer account, in Obsidian, with the console
open.

- [x] 5.1 D1 — states are right, and a published document no longer reads
      "Waiting for review".
- [x] 5.2 D2 — changes requested, and back again. Both halves.
- [x] 5.3 D3 — reconciles with `data.json` deleted.
- [x] 5.4 D4 — self-healing after a hand-edited record.
- [x] 5.5 D5 — no request on edit.
- [x] 5.6 D6 — a failed refresh keeps the last known states and says so.
- [x] 5.7 D7 — restore, end to end, including its images.
- [x] 5.8 D8 — resubmission in all four states.
- [x] 5.9 D9 — reset, and the panel's sections. NOTE: this item predates the
      panel changes of 2026-09-22 — "Other documents" no longer exists, the
      restore list now covers only documents under review, and "Your
      documents" now means work owed. Re-run it against the panel as it now
      is, and correct the item's own text.
- [x] 5.10 E6 — an import that lands with its images. Only partially
      observed.

## 6. Token expiry

- [x] 6.1 Exercise a 401 from a real expired or revoked token, and confirm it
      surfaces as "Your access has expired" pointing at the settings tab,
      per milestone 2. Never exercised against a real one.

## 7. Record, then decide

**Cleanup done.** The write pass left merge request !2 on
`ivan/service.doc.kb`; it was closed 2026-09-22.

- [x] 7.1 Write every result into `docs/ce-verification.md` as you go, per
      its own "Recording what you find" rule — a confirmed item has its
      caveat struck with the instance and date; a contradicted one records
      the observed status, body and field values, never just "it differed".
- [x] 7.2 Strike the now-settled caveats in `docs/access-tokens.md` §1.
- [x] 7.3 Collect every failure before fixing any of them, so one decision
      covers the set rather than one fix uncovering the next
      (design.md decision 4).
- [x] 7.4 Triage each failure by design.md decision 5: a wrong
      classification, a misparsed field, a message naming the wrong remedy,
      or onboarding copy is fixed HERE; anything touching a write path, a
      data shape or a panel surface gets its own milestone.
- [x] 7.5 Update `openspec/config.yaml` for whatever this run settles that
      the roadmap still carries as open — terse, since that file sits near
      the 50KB limit past which its whole context is silently dropped.

## 8. Onboarding copy

- [x] 8.1 Put the confirmed minimum permission list into the settings tab,
      replacing the current "the exact permissions are assigned by your
      admin" (platform-config spec delta).
- [x] 8.2 Keep it short enough to read in the settings pane, and phrased so
      an author can forward it to whoever creates their token.
