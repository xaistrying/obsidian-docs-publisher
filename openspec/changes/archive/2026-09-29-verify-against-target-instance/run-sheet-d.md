# Closing sheet — 3 tasks left, 2026-09-29

Replaces the finishing sheet, which is spent. 43 of 46 done. What remains is
one check you can do now and one probe run at the office.

`P` below is `python3 openspec/changes/verify-against-target-instance/probe.py`.

**Record results in `docs/ce-verification.md`**, not here. Triage of the
findings is in `triage.md`.

---

## A. Task 5.6 — D6's third check. At home, ten minutes.

The check: a refresh that FAILS keeps the states a previous refresh resolved.
Two attempts have already been wasted on an invalid baseline, so the order
below is the whole point.

`recordFailure` sets only `outcome` and never touches `statuses`, so the
property holds by construction. What is missing is the observation.

- [ ] **A1. Real token in settings.** The eight from §A2.10.
- [ ] **A2. Refresh, and WAIT.** Do not proceed until BOTH are true:
      - rows carry state labels — "Changes requested" on `test-004` and
        `test-008`, not just names;
      - "Documents you can import" shows a COUNT, not "Not checked yet".

      This is the step both earlier attempts missed. Until labels appear there
      are no last-known states, and a failed refresh afterwards looks identical
      to a successful "kept its states" result. **An invalid baseline is
      indistinguishable from a pass**, which is why it is worth being slow
      here.
- [ ] **A3. Swap in the under-scoped token** — `User: Read` + `Project: Read`,
      nothing else — and Refresh.
- [ ] **A4. Read three things:**
      - the state labels are STILL THERE — this is the check;
      - the section headings say "(check failed)";
      - the message names the permission, "(missing: Merge Request: Read)".

      The second and third already passed on 2026-09-29; only the first is
      outstanding.

### While the narrow token is in, confirm D0g's fix

Not a task — a five-second check that today's fix reached the surface.

- [ ] **A5.** Paste the `Project: Read`-ONLY token (no `User: Read`) and
      Refresh. Before today this said *"That project could not be found, or
      your access does not include it."* It should now say **"Your access token
      doesn't have permission to check your connection (missing: User: Read).
      Ask your admin to add it."**

      If it still names the project, the fix did not reach the surface and
      §D0g should be reopened.
- [ ] **A6.** Put the real token back.

---

## B. Tasks 3.4 and 3.6 — the CE probe run. At the office.

Three items answered on `gitlab.com` and owed on CE, per §0's rule that
evidence does not transfer in that direction. **One command answers all
three**, given a merge request carrying a PUBLISHED thread.

- [ ] **B1. Find the inputs.** Run the plain read pass first:

      P --host https://git.styl.solutions --project ivan/service.doc.kb

      Read off a markdown path from the tree listing, and an OPEN merge
      request's iid from the merge-request listing.
- [ ] **B2. Make sure a thread exists, published.** If that merge request has
      no discussions:

      P --host https://git.styl.solutions --project ivan/service.doc.kb --comment <iid>

      This posts a published resolvable thread in one step, with no way to
      leave it pending — the draft-review trap that cost a round trip on
      2026-09-27 cannot recur.

      It may be refused: creating a note needs a permission NOT in §A2.10's
      eight, because the plugin never comments. A 403 naming it answers §A2's
      operation 5, which has never been exercised anywhere — record the name,
      then leave the thread through the web UI instead.
- [ ] **B3. The run that closes all three:**

      P --host https://git.styl.solutions --project ivan/service.doc.kb \
        --file <the markdown path> --mr <the iid>

- [ ] **B4 → task 3.4.** From `states seen`: `opened` must appear alongside
      `closed` and `merged`, giving three of four on CE. `locked` is a
      transient GitLab holds mid-merge and a poll may never catch it — if it
      cannot be seen, record THAT rather than leaving the item looking un-run.
- [ ] **B5 → task 3.6.** From the `pagination:` line on the MERGE REQUEST read
      — the one tagged `(B6)`, not the ones tagged "not a B6 reading".
      `per-page=100` means CE honours what the loop asks for.
- [ ] **B6 → §B5's CE re-read.** From `note keys seen`: both `resolvable` and
      `resolved`, with `unresolved by the plugin's rule: True`. The RULE is
      already confirmed and transfers; this is the response SHAPE on CE, which
      §0 says does not.

---

## C. Then close the change

- [ ] **C1. Clean up, in this order.** Everything below was created by this
      run and none of it is corpus content.

      **On `git.styl.solutions` (the real corpus — do this one carefully):**
      - merge request **!4** (`doc/probe-test`) carries a probe comment thread
        left by `--comment 4` on 2026-09-29, and its branch holds
        `probe/probe-test.md`. Resolve or delete the thread, close the merge
        request, delete the branch.
      - nothing else was written there. The tree, file and listing reads are
        all reads.

      **On `gitlab.com/styl-group1/kb-docs` (the test project):**
      - merge requests from this run: **!26** through **!32**, plus any left
        from the write probes.
      - branches `doc/probe-*` and `doc/test-0xx` where they survive.
      - the `probe/` folder and `test/test-0xx` files on `main` where they were
        merged.

      **In the vault:** the `probe/` folder, `test/test-0xx` notes and
      `test/img-shared.png` if they are not wanted, and `data.json`'s records
      for them.

      `P --close <iid>` closes a merge request if the token permits it; a 403
      there names the permission, which is worth recording rather than
      working around.
- [ ] **C2.** Decide whether `probe.py` goes with the change or survives it. It
      is the only thing that can answer §A's permission questions, and those
      will be asked again the next time the token set changes.
- [ ] **C3.** `/opsx:archive verify-against-target-instance`.

---

## What is STILL OWED after this archives

Neither blocks the archive; both block a release.

- **The access floor.** Every §D result is Maintainer-as-author. §0 records why
  that cannot stand in for a Developer, and the token screen's own rule —
  "Permissions not included in your assigned role have no effect" — means no
  token narrowing substitutes for the role. Needs a second account at Developer
  on the corpus project.
- **The spec drift.** `specs/plugin-shell` still describes a two-section panel
  that lists every tracked document. The 2026-09-22 narrowing and the
  2026-09-27 renaming both shipped without a delta, so §D1 passes against the
  code and fails against the spec, and no reader can tell which is
  authoritative. Needs a retro-change.

Plus four findings carried elsewhere: **D0c** and **D0d** want milestones that
do not exist yet; **D0e** and **D0f** are `correct-stale-records`.
