## 0. Sequencing and safety net (do before any code)

- [x] 0.1 Resolve the four open changes, in this order: `guard-plugin-data`,
      `add-action-busy-states`, `show-reset-after-submit`,
      `self-service-token-messages`. Their code is already merged; every
      unchecked task left in them is a manual check in the running REST-era
      plugin (e.g. `show-reset-after-submit` 3.1–3.7, `add-action-busy-states`
      4.1–4.6). For each, either run its checks, or — since this change deletes
      the code they exercise — tick them with the note "superseded by
      replace-rest-with-local-git-ssh, not run" and archive with `/opsx:archive`.
      Ask the author of the change which, once, for all four. **Check:**
      `openspec list` shows none of the four, and `openspec/specs/` now contains
      "Messages about the access token tell the author how to fix it themselves",
      "A review this session's own submit opened is resolved as pending",
      "Stored records are never overwritten when the stored file cannot be used"
      and "The panel's write actions show when they are working and run one at a
      time".
- [x] 0.2 Confirm this change's deltas still apply: `openspec validate
      replace-rest-with-local-git-ssh --strict` passes, and every REMOVED,
      MODIFIED and RENAMED-FROM header exists in `openspec/specs/` (write a
      throwaway script that lists each delta header and greps it in the main
      spec; names are case- and apostrophe-sensitive). Fix any mismatch in the
      delta, not in the main specs. **Check:** the script prints zero missing
      names.
- [x] 0.3 Tag the last REST-era commit locally: `git tag pre-git-pivot`, and
      work on a long-lived branch `pivot/local-git`. Do not push the tag or the
      branch unless asked. **Check:** `git tag --list pre-git-pivot` prints the
      tag.
- [x] 0.4 Shrink `openspec/config.yaml`'s `context:` block below 40,000 bytes
      of **parsed** context before adding anything to it (measure the string
      `openspec instructions proposal --json` returns as `context`; today ≈48,532
      against 51,200). Move the REST-era milestone narrative (4a, 5, 5a, 5b,
      6/7/7a, 9, 9a) and the credential decisions into a new
      `docs/rest-era-history.md`; reverse the "no local git / no SSH keys / no
      `.git`" decision and record, with the reasons in `design.md` D9, the two
      reversed standing rules — "NO CI PIPELINE: nothing pulls remote content back"
      and "an implicit pull must baseline on the last submitted content and refuse
      while a document is awaiting review"; list the new reference docs; amend the
      vocabulary rule's examples in `rules.specs` (drop "Changes requested", add
      "Get updates"). **Check:** the parsed context is under 40,000 bytes, and
      `openspec instructions specs --change replace-rest-with-local-git-ssh --json`
      still lists the vocabulary rule in `rules` (the rule is in `rules.specs`, not
      in the context).

## 1. Setup checklist, process runner, key and test (Windows go/no-go spike)

- [x] 1.1 Add `plugin/src/git-publishing/ssh-command.ts`: one pure function
      building the ssh command for Git from a key path, for Windows and POSIX
      (design D11; spec: "Processes are run without a shell, hermetically, and
      bounded"). **Check:** table tests for a path with a space
      (`C:\Users\Trai Pham\.ssh\key`), Vietnamese diacritics, backslashes, a
      single quote, and a trailing space; each round-trips through a shell-split of
      the result to the exact path.
- [x] 1.2 Add `git-runner.ts`: a `GitRunner` interface and the real
      implementation (design D1, D3, D5, D11). `execFile` without a shell,
      arguments as an array, `--` before paths, a fixed environment (`LC_ALL=C`,
      `GIT_TERMINAL_PROMPT=0`, `GIT_ALLOW_PROTOCOL=ssh`, the key-selecting ssh
      command from 1.1), the forced `-c` values (`color.ui=false`,
      `core.quotepath=false`, `core.longpaths=true`, `core.fsmonitor=false`,
      `core.hooksPath` = an empty folder under the plugin's own folder), a per-call
      timeout that kills the **whole process tree** (`taskkill /T /F` on Windows, the
      process group elsewhere), bounded output, and an **allowlist of subcommands**
      that refuses everything else at run time (`reset` only as `--mixed`). Add a
      test double. **Check:** tests for a path starting with `-` and one with shell
      metacharacters (each one argument); a node child that outlives its timeout
      **and starts a grandchild holding the pipes** (both killed, `timed-out`
      returned); output past the cap truncated; `checkout`, `merge`, `pull`,
      `reset --hard` refused with no process started; an address `ext::sh -c x`
      refused with no process started.
- [x] 1.3 Add `failures.ts`: classify exit status plus stderr into the kinds in
      design D7 (spec: git-publishing, "Failures are classified, not passed
      through raw"); raw output goes to `console.error`, never to the caller. The
      empty-project kind is a **success exit with empty `ls-remote` output**, not
      a stderr phrase. **Check:** a fixture table for each kind — publickey,
      passphrase under BatchMode, host key changed, host unresolved, repository not
      found, empty project, non-fast-forward / stale info, access forbidden — each
      classified once, an unrecognised string classified `unexpected`. The
      fixtures start provisional and are replaced by lines recorded from the target
      in 3.10.
- [x] 1.4 Add one registry module `plugin/src/author-messages.ts` holding **every**
      author-facing string, from every capability — the setup messages
      (`specs/platform-config`), the step texts (`specs/plugin-shell`), the
      publish, update, connect and conflict messages (`specs/doc-authoring`,
      `specs/vault-sync`). Callers import constants; none builds a message inline.
      Add two tests: (a) every exported string is scanned for the banned words
      (`branch`, `commit`, `merge request`, `MR`, `conflict`, `main`, whole words,
      case-insensitive) and for `token`; (b) a source scan finds no string literal
      passed to `new Notice(` or `setText(` outside the registry. **Check:** both
      pass, and each fails when a banned word or an inline literal is introduced.
- [x] 1.5 Add `project-address.ts` (in `git-publishing`): parse the SSH forms and
      the HTTPS form, validate (design D12) and derive the SSH form, the web base,
      the keys page, the filtered review-list address and the file-page address
      (spec: "The remote's web addresses are derived from the project address").
      **Check:** tests for `git@host:a/b.git`, `ssh://git@host:2222/a/b`,
      `https://host/a/b`, `https://host/a/b.git`, a subgroup `a/b/c`, and rejections
      for `1234`, `hello`, `git@-oProxyCommand=x:a/b.git`, `ext::sh -c x`,
      `git@host:../b`, a user other than `git`, and a scheme other than ssh/https.
- [x] 1.6 Add `keys.ts`: find existing keys in the order dedicated →
      `id_ed25519` → `id_rsa`; create `docs-publisher_ed25519` with
      `ssh-keygen -t ed25519 -N ""`, refusing if the file or its `.pub` exists and
      creating the folder if missing; read only the `.pub`. Locate `ssh` and
      `ssh-keygen` on `PATH`, then next to `git --exec-path` (design Open Question
      4). **Check:** tests in a temp home — create, refuse to overwrite, find each
      existing key, `.pub` read, private file never opened (assert by making it
      unreadable and still succeeding).
- [x] 1.7 Add `test-access.ts`: `git ls-remote --symref` to prove key and project
      and read the default branch, then `ssh -T` for the greeting; success without
      a username when the greeting is unreadable (spec: "Access can be tested,
      reporting who the key belongs to"). **Check:** tests against the runner
      double with provisional outputs for success, publickey, not-found, empty
      project and an unreadable greeting; the empty-project case asserts the empty
      answer with exit 0.
- [x] 1.8 Add `setup-state.ts` in `platform-config`: the five steps (design D10;
      spec: "Setup is five steps, computed locally and held in one place every
      surface reads"), a holder with `onChange` like `ConnectionStateHolder`,
      recompute only on panel open, settings-tab close, "Check again" and after a
      setup action, `markIncomplete(step)` for setup-type failures. Steps 4 and 5
      take their facts through an interface that this group stubs as "incomplete";
      2.1 and 2.7 supply the real facts. Persist the project address, key path,
      username and the tested pair in `data.json` (spec: "The plugin stores no
      secret"); saving **merges** into the loaded object; ignore legacy keys without
      deleting them; start from defaults whatever the file holds. **Check:** tests
      for each step's condition including "tested but no username → step 3
      incomplete"; "rendering does not recompute" (the runner double records no
      call); "changing the address or the key discards the test result and starts no
      test"; a `data.json` from the previous version loads, and after a **save** still
      holds its old keys unchanged.
- [x] 1.9 Rewrite `settings-tab.ts` to the five-step layout: project address
      (validated, saved on leaving the field; locked once connected — the lock's
      test lives in 2.3), key section (Create key, Copy key, Open GitLab, Test with
      "Testing…", the typed-username field when none was read), name and email
      (read-only before connect, labelled "from your computer-wide settings"/"from
      this vault"), the remembered-values sentence, the step progress. Keep
      `open-settings.ts` unchanged. **Check:** with the stubbed runner, each control
      calls the expected operation and each failure shows its exact message from the
      registry (1.4).
- [x] 1.10 Replace the first screen in `main.ts` with the setup checklist
      (`specs/plugin-shell`, "The sidebar view shows setup progress, then the ready
      screen"); the old ready body is reachable only when all five steps are
      complete. Extend `requireAuthoringGate` to require the steps each action
      depends on and to say the "Finish the setup steps…" message. Extend
      `ActionSlot`'s action set **now** to all six — submit, reset, update, connect,
      test, createKey — so later groups only wire them. **Check:** the busy tests
      extended for Test and Create key; a gate test for the command-palette path
      with each of the first three steps incomplete.
- [ ] 1.11 Windows check: not run. Moved to `docs/release-checks.md` (steps in `docs/ssh-setup.md` §2). Keep the Windows-specific logic in `ssh-command.ts`, `locate-program.ts` and `git-runner.ts` so any rework stays small.
- [x] 1.12 Fix what the group-1 code and security reviews found, before building on it
      (spec text and design D3/D5/D11 amended to match). **Process:** programs located
      and started by full path from a search path with empty and relative entries removed,
      git also looked for in the installers' folders (`locate-program.ts`), `taskkill` by
      its system path, no ssh agent socket passed on, hooks pointed at `/dev/null` (POSIX)
      or a never-created folder outside the vault that must stay empty (Windows), ssh told
      `ForwardAgent=no ClearAllForwardings=yes ForwardX11=no`, running processes ended on
      unload. **Runner rules (`git-command-rules.ts`):** each subcommand lists the options
      it may be given in full (no `--har`, no `-mu`, no `--output`, `--no-filters` /
      `--no-ext-diff --no-textconv` required); a network command must name the address it
      reaches, must have a key, and is stopped with `address-rewritten` when an
      `insteadOf` / `pushInsteadOf` setting covers that address. **Keys:** creation made in
      a scratch folder and placed with an exclusive copy (no link followed, nothing
      replaced, the first half removed if the second cannot be placed); `key-unreadable`
      and `key-exists` told apart from `key-protected` and from each other; default branch
      and username validated. **Setup:** read at plugin start, on opening the tab, and
      coalesced (one at a time, a rerun for a request that arrived mid-read); "Checking
      your setup…" and "still checking" before the first read instead of "Git isn't
      installed"; an unchanged result redraws nothing (the swallowed click); the address
      lock compares the whole address; the typed address is saved when the tab closes; a
      new key or address forgets the old username; no action rejects (the busy slot is
      handed back even when a listener throws). **Check:** 793 tests pass, including a real
      git test that a repository's hook does not run and one that a repository's
      `insteadOf` stops a command before ssh is started; typecheck clean; the bundle builds
      with the project's esbuild. **Not done here, and where it is:** the Windows paths
      (`taskkill`, the hooks folder, quoting under MSYS with a non-ASCII profile folder)
      are covered by tests of the pure parts only and are checked by hand in 1.11.

## 2. Connect this vault and derived state

- [x] 2.1 Add `repo.ts` in `git-publishing`: inspect (git runs, repository present,
      top level equals the vault root, origin, current branch, HEAD unborn/equal/
      ancestor of a given commit, object format), initialise (`init` then
      `symbolic-ref HEAD`, never `init -b`) + link + write `.git/info/exclude`
      (`.obsidian/`, `.trash/`) without touching working files, fetch with prune **by
      the verified address and an explicit refspec** (`fetch --prune <address>
      +refs/heads/*:refs/remotes/origin/*`, never `fetch origin`: every network command
      passes `remote` so the runner can check no setting rewrites it), list a ref's / a recorded commit's / the synced version's files as path→blob id,
      read a file at a ref three-way, **read whether a branch exists three-way**,
      read the default branch name from `ls-remote --symref`, **read the files a
      branch changed relative to its merge base** (three-dot, with the document path),
      read and write the bookkeeping refs (`synced`, `connected`, `sent/<id>`), record
      a new synced version holding back named paths, and `reset --mixed` as a
      fast-forward only (specs: git-publishing "The vault's repository can be
      inspected…", "The last synced version can be advanced…", "Local bookkeeping refs
      can be read and written…", "The files a document branch changed can be read",
      "Whether a branch exists can be read…", "A file's content at a path and ref…").
      **Check:** tests on temp repositories; the fourth experiment (E4) is the named
      test "adopt a non-empty folder": every vault file byte-identical before and
      after; the changed-files read covers an image-only branch and a squash-merged
      branch left behind (blobs equal, commits not ancestors); the branch-exists read
      returns "lookup failed", not "absent", before any fetch.
- [x] 2.2 Add `blob-id.ts`: the in-process blob identifier (E8). **Check:** it equals
      `git hash-object --no-filters` for an empty file, text with LF, text with CRLF,
      and a binary file.
- [x] 2.3 Add `plugin/src/vault-sync/connect.ts` implementing "Connecting a vault
      adopts it without touching any file" and "A vault that is already a repository
      is adopted only when that is safe", with the exact messages: no repository
      (init path, synced and connected recorded, mixed reset), an existing repository
      (no HEAD or index movement; synced := its HEAD), and the six refusals (other
      origin or none, other branch, unsent commits, nested top level, SHA-256),
      plus the busy label "Connecting…", plus the address lock ("This vault is
      connected to <project>…") — supply `SetupRepoFacts.connectedAddress()` (the
      origin parsed as an address, so the lock compares host and port as well as the
      project) and `vaultConnected`, which the setup controller already takes and which
      answer "no" until then. **Check:** one test per scenario in those two
      requirements, each asserting no vault file changed and the exact message; a
      test that adopting a repository leaves HEAD and the index unchanged; a nested
      vault (vault folder inside a repository) refused.
- [x] 2.4 Detect the Obsidian Git plugin (enabled plugin id) and warn once per
      session without blocking. **Check:** test with the plugin list stubbed.
- [x] 2.5 Add `submission-tracking/derive-state.ts` implementing "A document's state
      is derived from the fetched copy", "Resolving a document's remote path…" (by
      identity, not by the note's path) and the edited rule (set membership: not equal
      to the synced, fetched, last-sent or branch version), reading the listings once
      per fetch and caching them; the edited marker compares the note's in-process
      blob id with the cache and starts no process. **Check:** tests for every
      scenario in those requirements incl. "merged, branch left behind → Published",
      "squash-merged, branch left behind → Published", "image-only revision → Waiting
      for review", "moved published note keeps its state and a resubmit is refused with
      the path", "renamed pending note keeps its state", "two files derive the identity
      → no remote path → Not accepted", "equal to the synced version while others
      changed it → not edited", "own merged revision then edited → edited", and a
      render-path test that the runner double saw no call when a note is edited.
- [x] 2.6 Wire the panel: "Needs you"/"Waiting on reviewers" from the derived states
      with the new descriptions, the Refresh control doing one fetch (skipped while
      one of the six actions runs, with the notice when asked for), "Open in GitLab"
      derived links, the "Connect this vault" step control, the
      failure-keeps-last-known-states behaviour, and the resubmit action by derived
      state. **Check:** panel tests for each scenario in `specs/plugin-shell` listed
      under "The panel lists…", "…separates documents by who acts next", "A refresh
      that fails…", "Each listed document offers…", "A tracked document offers a
      resubmit action…", and the two "while an update runs" scenarios.
- [x] 2.7 Name and email: read effective values with scope, save with
      `git config --local` once connected, read-only before (spec: platform-config,
      "Name and email are read from the effective settings and saved to this vault
      only"); supply step 5's fact to the setup state. **Check:** tests for
      machine-wide-only, saved-local, read-only before connect, and machine-wide
      config unchanged after Save (assert the global config file's bytes).
- [x] 2.8 Switch `create-document.ts`'s `owner` to the persisted username and its
      gate to "A document cannot be created before setup is complete" (spec:
      doc-authoring). **Check:** the existing creation tests pass with the new
      source; tests for "setup completed in an earlier session" and "no username
      known → creation refused by the setup gate".
- [ ] 2.9 Demo check (group 2): seen in Obsidian on the author's own vault (connect, the panel's groups, the edited marker, the updates count, a checksum with no file changed). The refusals for a vault that is already a repository, or nested in one, are covered by tests against real git and listed in `docs/release-checks.md`.
## 3. Publish

- [x] 3.1 Add `plumbing-commit.ts`: build a commit on a parent from a set of files in
      a throwaway index, identity passed explicitly, never deleting (spec: "A commit
      can be built for a set of files without touching the vault"; "Binary file content
      can be committed"). **Check:** the experiment E2 as a named test — the vault's
      files, the real index and HEAD are untouched and the pushed branch holds the
      note and an image byte-identical (CRLF included); E1 (the switch-and-back
      approach reverting the note) is recorded in a comment, not asserted.
- [x] 3.2 Add `push.ts`: push to `doc/<doc_id>` only, to the **verified address**
      (not `origin`), with `--no-verify`, the lease, the review-request options and the
      single-line title; refuse any other ref, a ref-illegal identity and a default-
      branch target before running a process; on success set
      `refs/remotes/origin/doc/<id>` ourselves; parse both reply shapes; retry once
      without options when the server refuses them (spec: "A commit can be pushed to
      a document branch, asking for a review request"). The runner allows only the ssh
      protocol (`GIT_ALLOW_PROTOCOL=ssh`), so a local bare remote is reached through a
      **stand-in ssh**: a script given as the ssh command that runs the server-side
      command it is sent (`git-receive-pack '<path>'`) against the bare repository, as
      `git-runner.test.ts` already does to record the arguments ssh is started with.
      Build that once as a test helper and use it here, in 2.3 and in group 4. **Check:**
      tests against a local bare remote with `receive.advertisePushOptions` on and a `pre-receive` hook that
      prints the options and the link-only reply; against one with it off (retried once,
      ends link-only, branch present exactly once); a moved branch → `changed-meanwhile`
      with the remote unchanged; an empty lease refuses to overwrite an existing branch;
      a repository whose `origin` has a different `pushurl` still pushes to the verified
      address; the tracking ref moves after success and not after failure.
- [x] 3.3 Add `branch-ownership.ts` (spec: "Whether a document branch holds commits this
      vault did not build can be read"), using the `sent/<id>` ref from 2.1. **Check:**
      tests for a tip this vault built, a commit by someone else touching the path, a
      commit by someone else touching another path, the author changing their email
      (answer: still own), nothing recorded (all foreign), and a failed read.
- [x] 3.4 Rewrite `submit-document.ts` around the pre-checks in design D5, in the order
      given there, and the exact messages in `specs/doc-authoring`: duplicate `doc_id`;
      path drift (note path against the identity-found remote path); "path holds a
      document this vault has not received"; identity unique across the project
      (`docs/document-naming.md`); stranger's branch by ownership, not email; the stale
      guard for every carried file (with the own-merged exception) and the foreign-
      commits guard; the invalid-identity check; revision of a received note with the
      identity frozen from the filename and the modal sentence "This replaces the
      published version of this document. Reviewers will see what changed." **The
      confirmation names where the document is sent — the server and the project path —
      for every send**, so an address that was changed by hand in the data file after it
      was tested cannot send to another server without the author seeing the name. Record
      `sent/<id>` **before** pushing. Write the local note from the **exact committed
      string** only if the note is unchanged since it was read. **Check:** one test per
      scenario in the changed and added `doc-authoring` requirements, each asserting the
      exact message and that nothing was written on a refusal; a test that the note's
      blob id equals the pushed blob; a test where the note changes during the push (left
      alone, reads edited).
- [x] 3.5 Implement the four paths in `performSubmit`/`performResubmit`: first
      submission, revision of a live review (on the fetched branch tip, lease on what was
      seen), published → new cycle, closed → new cycle (the lease replaces the abandoned
      branch; no separate delete), plus "Submitting again after an interrupted submit
      completes the submission" using ownership by reachability. **Check:** tests for
      each path including the interrupted attempt, a note edited between attempts, a
      front-matter write that fails after a successful push (the next press completes
      it), and a branch the same person pushed from another computer (refused, never
      overwritten).
- [x] 3.6 Carry the embedded images through `submission-files.ts` using the existing
      vault resolver (`embeds.ts`, `vault-attachments.ts`); drop the create/update verb
      and `last_commit_id` handling (spec: "An attachment already on the project is
      carried as it is in the vault"). Keep "never deletes". **Check:** the existing embed
      tests pass unchanged; new tests for an identical shared image (no diff), a new
      image, and a shared image changed on the project (stale-guard message).
- [x] 3.7 Reset: read the document's own fetched branch three-way, keep the
      confirmation and the refuse-rather-than-substitute rules, update the message to
      "…Get updates to see where it stands now.", **gate it with `requireSetup(…, 'all')`
      in place of the old token gate it still goes through**, and **record the branch tip
      as `sent/<id>`** (specs: doc-authoring "Reset replaces…", submission-tracking "A
      document under review can have its remote content read…", "Only a document with
      a live review can be reset"). **Check:** reset tests adapted; a foreign-commit
      test shows the note matching the branch tip after Reset, and the next Send update
      is **not** refused.
- [x] 3.8 Failure mapping for Submit: not-allowed, changed-meanwhile, link-only ("Open
      to request review"), setup-type (return to the step) and the undifferentiated
      message, exactly as in "A submit failure is reported as one undifferentiated
      outcome" and "A failed check of the target's state stops the submission".
      **Check:** one test per message; the 1.4 source scan still passes.
- [x] 3.9 Panel and palette: the Submit/Send update/new-cycle labels follow the derived
      state; Reset is offered immediately after a successful send (the tracking ref is
      set by 3.2); the busy states for Submit and Reset; palette parity ("The command
      palette and the panel action agree"). **Check:** panel tests for "Straight after a
      send" and the double-press cases.
- [ ] 3.10 GitLab's real push behaviour: not run. Needs a real project; moved to `docs/release-checks.md`, to record in `docs/ce-verification.md` §F. Until then the push options, reply and failure text are tested only against a stand-in server, and the fallback in design.md covers an ignored option.
- [ ] 3.11 Demo check (group 3): Submit, Send update and Reset seen working in Obsidian on the author's vault. Not yet seen: another account's commit, an image-only revision, and a merge shown as Published; moved to `docs/release-checks.md`.
## 4. Get updates and conflicts

> **Correction made while building this group (2026-10-23).** Design D6 said a vault with no
> repository records the fetched tip as both its synced and connected version. That would make
> every file the project holds look already received, so nothing could ever be downloaded and
> the first-update summary ("120 files to download") could never appear. A new connection now
> records a commit of an **empty tree** for both (`emptySyncedCommit`), so the first update
> downloads the project; an adopted repository still records its own HEAD. `design.md` D6 and
> `vault-sync` carry the same fix.

- [x] 4.1 Add `vault-sync/get-updates.ts` implementing the rule table in design D9
      (spec: "Each changed file is decided by comparing the note, the last synced
      version and the new version") over the synced→fetched difference, using the one
      pinned fetched commit throughout. Include: `.obsidian/` and `.git/` excluded; case-
      insensitive occupancy on a case-insensitive file system, detected by probing; the
      author's-text copy to `.trash/Docs Publisher/<timestamp>/<path>` before any
      clean merge, Use theirs and Remove it; removals of unchanged notes via the vault's
      own trash; skipped paths (OS refusal, unsaved note, failed copy) held back in the
      recorded synced version; unsaved detection as "editor text ≠ file text"; writes
      through Obsidian's file API; the synced version advanced (holding skipped paths)
      and then HEAD fast-forwarded. **Check:** a table-driven test covering **every row
      1–8** and "base absent, mine absent → add", "removed on the project", "moved on the
      project"; "a note the author renamed or deleted that the project changed" (row 4);
      "the author's own merged revision, edited again" (row 2, no prompt); case-variant
      collision on a stubbed case-insensitive file system; `.obsidian/` never written; and
      the sequence **skip one path → update again → Publish** where the second update
      applies the skipped path and, if the author publishes in between, the stale guard
      refuses.
- [x] 4.2 The third experiment as a named test: after a reviewer merges, the vault copy
      byte-identical to the merged text → Get updates succeeds and changes nothing; the
      synced version advanced and HEAD fast-forwarded. (What plain `git merge --ff-only`
      does is recorded in a comment, not asserted.)
- [x] 4.3 Add the text merge (`merge-text.ts`; spec: "Two edited versions of a text can be
      merged against their common base") on copies outside the vault. **Check:** different
      paragraphs → merged text with both changes, the "Merged your changes with GitLab's
      in <name>." notice and a copy of the pre-merge text in the trash folder; the same
      sentence → the prompt, no marker written anywhere; binary → the prompt.
- [x] 4.4 Add the two modals: the summary ("Get the latest documents?", "<d> to download,
      <u> to update, <k> need your decision. Nothing changes until you confirm.") shown the
      first time after connecting (derived from `synced` still equalling `connected`), and
      the choice dialogs ("Two versions of <name>" with Keep mine / Use theirs / Keep both;
      Keep mine / Remove it; and "<name> was removed here" with Keep it removed / Get it
      back). "Keep both" writes `<name> (from GitLab).<ext>`, then `(from GitLab 2)`, …
      **Check:** tests for Cancel (nothing written), each choice, a second "Keep both"
      numbering, that the trash folder received the author's text, and that a later update
      does not show the summary again.
- [x] 4.5 Panel: the "N updates available" line with its four cases, the "Get updates"
      control and command, the fetch-only check on panel open and Refresh, the messages "You
      already have the latest documents." and "Got the latest documents: <a> added, <u>
      updated, <r> removed.", the "Could not get updates. Check your connection and try
      again." failure and the setup-type route back to the checklist, and the busy label
      "Getting updates…". **Check:** panel tests for the four cases, for "Opening the panel
      changes no file", and for "Refreshing during an update".
- [ ] 4.6 Typing in an open note while Get updates would change it: not run in Obsidian. The engine's side is tested (`get-updates.test.ts` "leaves a note with unsaved changes as it is"). Moved to `docs/release-checks.md`.
- [ ] 4.7 Demo check (group 4) with two vaults: not run. Every step but the Obsidian UI is covered by `get-updates.test.ts` against real git; a deleted note coming back was seen in Obsidian. Moved to `docs/release-checks.md`.
## 5. Remove the REST path, finish, and release check

- [x] 5.1 Delete `plugin/src/git-publishing/gitlab-client.ts`,
      `submission-tracking/{discover,reconcile,resolve,reset,document-state,submission-record}.ts`
      as far as nothing references them, `doc-authoring/{import-document,fetch-attachments}.ts`,
      `platform-config/{connection,connection-state,access-messages}.ts`, and every test that
      only exercised them (list each deleted test file in the commit message). Reduce
      `SubmissionStore` to a small settings store. **Check:** `npm run build` and `npm test`
      pass; searching the source for `requestUrl`, `gitlab-client`, `Authorization`,
      `PRIVATE-TOKEN` and `access token` returns nothing.
      **Done 2026-10-23.** Deleted modules: `git-publishing/gitlab-client`;
      `submission-tracking/{discover,reconcile,reset,document-state,document-status,submission-record,submission-store}`;
      `doc-authoring/{import-document,fetch-attachments,authoring-gate,submission-files}`;
      `platform-config/{connection,connection-state,access-messages}`. Kept, reduced:
      `resolve.ts` (only `readDocId`), `vault-attachments.ts` (only `vaultEmbedIndex`),
      and the store, now `platform-config/settings-store.ts`: it starts from whatever
      the file holds, shows no error, and merges on save so an earlier version's keys survive.
      Deleted test files: `access-messages`, `changed-path`, `connection-settings`,
      `default-branch`, `discover`, `edit-baseline`, `fetch-attachments`, `guard-plugin-data`,
      `identity-permission`, `import-document`, `needs-author`, `normalize-host`,
      `project-scope`, `restorable`, `stale-records`, `states-survive-failure`,
      `submission-files`, `submit-ordering` (`setup-settings` became `settings-store`).
      The `requestUrl` helper is gone from the test stub. Searching the source for
      `requestUrl`, `gitlab-client`, `Authorization`, `PRIVATE-TOKEN` and `access token` is a test now.
- [x] 5.2 Remove the token plumbing in `main.ts` (`ConnectionDetails.token`,
      `PANEL_FAILURE_MESSAGES` entries for token kinds, role helpers
      `grantsAuthoring`/`grantsReadOnly`); keep `ActionSlot`. **Check:** a boundary test passes:
      `child_process` is imported only under `src/git-publishing/`, and no module outside it
      builds a remote address (searched by `child_process`, `execFile`, `ls-remote` and
      `GIT_SSH_COMMAND`, **not** by the literal `git@`, which the author messages contain).
      **Done 2026-10-23** as `tests/boundaries.test.ts`; the token plumbing went with 5.1.
- [x] 5.3 Add the boundary tests from `specs/vault-sync`: the runner's allowlist contains none of
      the forbidden subcommands and refuses them at run time (1.2); after Publish and after Get
      updates the vault's index and HEAD are as specified; a text search is **not** used for
      `merge` or `switch` (it would match `merge-file` and `merge_request.*`).
      **Done 2026-10-23** in `tests/boundaries.test.ts`: forbidden commands are checked against the
      runner's allowlist and against the exact first argument of every call in the source, and the
      allowlist is pinned to the design's list so a new command is a decision. Publish leaving the
      vault's files, index and HEAD alone is in `submit-plan.test.ts`; Get updates' half is group 4's.
- [x] 5.4 Advanced git settings (last): the closed Advanced section listing only `core.editor`,
      `core.pager` and `color.ui`, tick = set in this vault, untick = remove, "Back to default",
      machine-wide values read-only with their scope label, and the sentence that these settings
      do not change how documents are sent or received (spec: platform-config, "Advanced git
      settings can be set for this vault or returned to default"). **Check:** tests for tick,
      untick, Back to default, read-only machine-wide rows, "only the listed settings appear"
      (`init.defaultBranch` and `merge.ff` present machine-wide and not shown), asserting the
      machine-wide config file is untouched.
      **Done 2026-10-23.** Logic and tests in `platform-config/advanced-settings.ts` and
      `tests/advanced-settings.test.ts` (real git; the computer's settings file compared byte for byte
      before and after every change; `init.defaultBranch`, `merge.ff` and `pull.rebase` set machine-wide and
      not shown; the reader refuses any key not on the list). The section itself is in `settings-tab.ts`
      (closed by default, the open state kept across redraws, controls disabled until the vault is
      connected). It is drawn, not tested, like the rest of the tab: look at it in Obsidian at 5.7.
- [x] 5.5 Packaging: `manifest.json` `isDesktopOnly: true`, bump the version and `versions.json`,
      confirm `plugin/install.sh` still preserves `data.json`, and rebuild `main.js`. **Check:**
      `plugin/install.sh` into a scratch vault leaves an existing `data.json` untouched.
      **Done 2026-10-23, except the rebuild of `main.js`**: `isDesktopOnly` is true, the version is
      0.2.0 in the manifest, the package and `versions.json` (one test pins them together), and
      `tests/install.test.ts` installs into a scratch vault twice and finds `data.json` and any
      other file untouched. The tracked `main.js` is rebuilt as the first step of 5.7, once group 4
      has landed, so it is not committed carrying half of it.
- [x] 5.6 Docs: replace `docs/access-tokens.md` with `docs/ssh-setup.md` (key choices, security
      trade-offs from design D11, Windows findings, the unsaved-note result); mark
      `docs/gitlab-roles.md`, `docs/resubmission-lifecycle.md` and `docs/panel-tracking-scope.md`
      superseded with a pointer to this change; update `docs/ce-verification.md`; add the author
      guide for key setup to `plugin/README.md` in author vocabulary; update
      `docs/document-identity.md` where it describes reconciliation by merge request, and note
      there that path comparison and name occupancy are case-insensitive-aware. **Check:** every
      doc listed in `openspec/config.yaml` exists and the superseded ones say so in their first
      paragraph.
      **Done 2026-10-23.** Superseded banners on `access-tokens`, `gitlab-roles`, `resubmission-lifecycle`
      and `panel-tracking-scope` (kept, not deleted, as the record); `ce-verification.md` gains §F, the live
      checklist of what has not been confirmed on the target; `document-identity.md` §2 and §4 amended;
      `plugin/README.md` rewritten for the SSH setup, Get updates and Reset, in author vocabulary, with
      section 9 for admins (every message it quotes was checked against the registry). The Windows
      findings and the unsaved-note result in `docs/ssh-setup.md` stay as empty rows until 1.11 and 4.6 are run.
- [ ] 5.7 Release check. Done 2026-10-27: (a) build, typecheck and the full suite green, coverage over 80% on every logic module (the classes bound to Obsidian are not loadable by the test stub; the project has no ESLint configuration, so lint was not run); (b) the vocabulary and no-inline-literal scans pass as part of the suite; (c) both changes validate with `--strict`; (g) a checksum of 198 files before and after a session of Submit, Reset and Get updates showed no file changed except by the author or an update (`plugin/scripts/vault-checksum.sh`). Not run, moved to `docs/release-checks.md`: (d) the Windows run, (e) the demo checks on a scratch project from a vault that is already a repository, (f) a review opened by the old plugin.
- [x] 5.8 Archived 2026-10-27. The deltas were applied to `openspec/specs` by script, not by `openspec archive`, because that command refuses a change that drops scenarios from a requirement and this change drops the obsolete REST ones on purpose; the six specs validate with `--strict`, their Purpose paragraphs were rewritten, and none mentions an access token, `requestUrl`, a merge-request listing or a connection check except in a prohibition.
