## Context

Today the plugin has no local git. Every action is a GitLab REST call with a
personal access token held in memory for the session
(`plugin/src/git-publishing/gitlab-client.ts`, 1.1k lines). State is a record
store in `data.json`, reconciled against the merge-request listing. The
decisions in `openspec/config.yaml` that justified this ("no local git binary,
no `.git` in the vault", "nothing pulls remote content back") are reversed by
this change; the reasons are re-checked under Decisions. One further standing
rule is reversed on purpose, in D9.

Constraints that shape the design:

- Authors are non-technical. The author-facing vocabulary ban stands (no
  *branch, commit, merge request, MR, conflict, main*); every failure scenario
  quotes its exact message.
- Obsidian desktop is Electron, so `child_process` exists. The author's machine
  is Windows in the case we have evidence for (screenshots show a Windows
  hostname and Obsidian Git running `git` successfully).
- `render` runs on every note switch and front-matter keystroke
  (`main.ts`, "none of them may reach the remote"). The same rule is extended to
  process spawns.
- `openspec/config.yaml`'s parsed context is ≈48.5 KB against a 50 KB limit
  (about 2.7 KB of headroom); anything over is dropped silently.

Facts established by experiment (git 2.43, local bare remote). E1–E4 are the
first tests in groups 2–4; E5–E8 fix details of the design:

| # | Experiment | Result |
|---|---|---|
| E1 | Publish as `switch -c`, `add`, `commit`, `push`, `switch` back | Note reverted to the old text. Unacceptable. |
| E2 | Publish by plumbing: temp `GIT_INDEX_FILE`, `read-tree`, `hash-object -w`, `update-index --cacheinfo`, `write-tree`, `commit-tree`, `push <sha>:refs/heads/doc/x` | Branch on remote; note, other dirty files and the real index untouched. |
| E3 | After the reviewer merges, `git merge --ff-only` with the vault copy byte-identical to the merged text | **Refused** ("local changes would be overwritten"). Every published document would hit this. |
| E4 | `init` + `remote add` + `fetch` + `reset --mixed origin/main` in a non-empty folder | Nothing on disk changes. Identical = clean, different = modified, vault-only = untracked, remote-only = deleted. |
| E5 | `push --force-with-lease=<ref>:` (empty lease), then with a different commit; lease on the real tip; stale lease | Empty lease creates only when absent and is rejected ("stale info") when the branch exists; a lease on the tip replaces it; a stale lease is rejected. |
| E6 | `push -o …` to a server that does not advertise push options | **The whole push fails** (`the receiving end does not support push options`); nothing is pushed. To one that does, the options reach the server. |
| E7 | `git merge-file -p` | exit 0 clean, exit 1 per overlap (markers only in the output copy), exit 255 for a binary file. |
| E8 | In-process `sha1("blob <len>\0" + bytes)` vs `git hash-object --no-filters` | Identical for empty, LF, CRLF and binary input. A push by explicit refspec also moves the remote-tracking ref; `fetch --prune` removes a branch deleted on the remote; `ls-remote --symref origin HEAD` prints `ref: refs/heads/<default>\tHEAD`, and prints nothing (exit 0) for an empty project. |

## Goals / Non-Goals

**Goals:**

- Publish and Get updates are plain git over SSH, with no token and no REST.
- The author never sees git output, never a conflict marker, never a half-merged
  state, and never loses text.
- One checklist takes a fresh machine from nothing to ready, and doubles as the
  recovery screen when a setup-type failure happens later.
- Document state is derived from git; the plugin stores no records.
- Everything is testable against real git in temp repositories.

**Non-Goals:**

- Mobile, any platform other than GitLab, background sync, a stage/commit UI,
  switching a connected vault to another project, passphrase keys via an agent,
  pinned host-key fingerprints (see Deferred in the proposal).
- Reviewer-facing features. Reviewers merge in GitLab.

## Decisions

### D1. Engine: the system `git` binary over SSH

Spawn `git` via `child_process.execFile` (no shell), from `git-publishing` only.

*Alternatives:* `isomorphic-git` (pure JS, mobile-capable) has no SSH transport,
so it cannot use a key; a pure-JS SSH client plus a custom transport is a large
dependency for four people; keeping REST contradicts the goal. The binary is
already present where the evidence is (screenshots), and the checklist detects
it when it is not.

### D2. `.git` lives inside the vault

Ignore rules go in `.git/info/exclude` (never a committed `.gitignore`):
`.obsidian/` and `.trash/`. Re-checked reasons for the old ban: vault-sync tools
replicating `.git` is a user-environment risk we warn about, not design around;
commit attribution is per-person either way; "nothing pulls back" is now Get
updates. The new risk is a vault that is already a repository (Obsidian Git, as
in the screenshots) — handled by D6 and by detecting the Obsidian Git plugin
(warning, not blocking).

### D3. The plugin never writes the working tree through git

Invariant: the plugin never runs `checkout`, `switch`, `merge`, `pull`,
`rebase`, `restore`, `stash`, `reset --hard`/`--merge`, or any command that
writes working-tree files. It is enforced where it cannot be bypassed: the
`GitRunner` has an **allowlist of git subcommands** (`version`, `rev-parse`,
`rev-list`, `config`, `init`, `symbolic-ref`, `remote`, `fetch`, `ls-remote`,
`ls-tree`, `cat-file`, `hash-object`, `read-tree`, `update-index`, `write-tree`,
`commit-tree`, `update-ref`, `for-each-ref`, `merge-base`, `log`, `diff`,
`merge-file`, `push`, and `reset` with `--mixed` only) and refuses anything else
at run time. A text search for forbidden words cannot be the check:
`merge-file` and `merge_request.*` legitimately contain them.

The subcommand list alone is not enough, and was not what the first version
relied on: git accepts any unique prefix of a long option (`reset --har` is
`--hard`), glued short options (`read-tree -mu`), and `--output=<file>` on
commands whose names sound harmless. So each subcommand also carries **the
options it may be given, written out in full**, and any other option is refused
(`git-command-rules.ts`). That is what makes "diff (raw only)" true: no `-p`, no
`--output`, and `--no-ext-diff --no-textconv` required; `hash-object` requires
`--no-filters` (otherwise the repository's own clean filter, a program, rewrites
what is stored); `commit-tree` has no `-S`; `fetch` has no `--upload-pack`. A
flag a later task needs is added to that table with the reason and a test. Words
after a bare `--` are paths and are never read as options or addresses (a note
named `a::b.md` is a file, not a transport helper).

HEAD and the index move only by `reset --mixed`, only in Connect (a repository
the plugin just created) and at the end of Get updates, and only as a
fast-forward. The repository metadata Connect writes — `origin`, the unborn HEAD's
symbolic ref, `info/exclude`, and the local refs in D16 — is the one exception to
"nothing under `.git/` is touched", and it is named in the spec. Files are
written only by the plugin's own per-file code, through Obsidian's vault API for
notes so open editors stay consistent.

*Alternatives:* a branch switch (E1: reverts the note); `git worktree` (a second
checkout to explain and clean up); `git stash` (hidden state authors cannot see).

### D4. Compare bytes by blob id computed in-process; never `git status`

A blob id is `sha1("blob " + length + "\0" + bytes)`, computed in Node (E8).
"Edited", Get updates' per-file rule and Publish's pre-checks compare the vault
file's blob id with blob ids read once per refresh from `ls-tree -r` of the
last synced version `S` (D16), the default branch's fetched tip `M`, the
document's last-sent commit `L`, and `doc/<doc_id>` (`B`). No filters are applied
(`hash-object --no-filters`; commits carry the exact vault bytes), so
`autocrlf`, `.gitattributes` and stat-cache behaviour cannot create phantom
differences, and rendering the "edited" marker costs no process spawn.
Connect refuses a SHA-256 repository (`rev-parse --show-object-format`).

*Alternative:* `git status`/`diff` — slow over a large vault, depends on
`core.autocrlf` and the stat cache, and spawns on a path that must not spawn.

### D5. Publish = plumbing commit + push with review-request options

1. `fetch` (explicit, so a stale view never decides). Abort on failure (D7).
2. Run the pre-checks (spec: doc-authoring) against the fetched tree, in this
   order, writing nothing on the first refusal:
   1. duplicate `doc_id` among local notes;
   2. path drift: the note's path against `remotePath(D)` (D8);
   3. a note with no `doc_id` whose path the fetched default branch `M` holds and
      the last synced version `S` does not (someone published there since the last
      update);
   4. an identity another file in the project also derives
      (`docs/document-naming.md`);
   5. a stranger's branch for the derived identity: the branch exists and its tip
      is **not reachable from this vault's own `sent/<id>` ref** (D16). A branch
      whose tip is reachable from it is the author's own interrupted attempt and
      is completed. No email comparison is used: it breaks when the author changes
      their email or uses a second machine;
   6. the **stale guard** that replaces the REST path's per-file `last_commit_id`:
      for every file the commit carries, `M`'s copy must equal the vault's, or
      equal `S`'s (nothing changed since the last update), or equal `L`'s (the
      change on `M` is this vault's own, merged); otherwise refuse with "Get
      updates";
   7. for a live review, any commit on `B` that is not on `M`, not reachable from
      `sent/<id>`, and touches a carried file: refuse with "Use Reset". The text
      says "changes that aren't in your note", not "a reviewer", because the
      author on another machine reads the same.
   A note at a path the vault has already received but with no `doc_id` is
   submitted as a revision of that document, with the identity frozen from the
   filename.
3. Parent: first submission or new cycle → `M`; revision of a live review → the
   fetched tip of `B` (so a reviewer's suggestions are kept, never overwritten).
4. Build the tree in a throwaway index file: `read-tree <parent>`,
   `hash-object -w --no-filters` for the note and each embedded image,
   `update-index --add --cacheinfo`. `write-tree`, then `commit-tree` with
   identity passed through `GIT_AUTHOR_*`/`GIT_COMMITTER_*` (hermetic: no
   dependence on `user.*` being set in the repo). Never deletes (4a): the index
   starts from the parent and only adds/updates. The note's committed text is the
   note's bytes with `title`, `category` and `doc_id` merged in memory.
5. Point `refs/docs-publisher/sent/<doc_id>` at the new commit **before**
   pushing, so a push whose outcome is unknown (a timeout) is still recognised as
   the author's own.
6. `push --no-verify --force-with-lease=refs/heads/doc/<doc_id>:<expected-sha-or-empty>
   <verified-ssh-url> <sha>:refs/heads/doc/<doc_id>` with
   `-o merge_request.create -o merge_request.target=<default> -o
   merge_request.title=<title> -o merge_request.remove_source_branch`.
   The destination is the **verified address**, not the name `origin`, so an
   adopted repository's `pushurl` cannot redirect it, and `--no-verify` skips any
   `pre-push` hook. On success the plugin points
   `refs/remotes/origin/doc/<doc_id>` at the pushed commit itself (E8: a push by
   URL does not do it), so the document reads as pending without a fetch. The
   lease replaces an abandoned branch (not-accepted / interrupted-submit cases)
   only if it is still what we looked at, so clearing and writing are one step
   with no delete-then-fail window, and a branch someone else moved fails safely
   (E5).
7. Read the push reply. If it prints a "create a merge request" link instead of
   the created one, the push still succeeded: report partial success (D7). If the
   server refuses push options outright (E6), retry once without them and report
   the same partial success; never send the commit twice.
8. Write the local note from the **exact committed string**
   (`vault.modify`), only if the note's bytes are still what was read before the
   push. Re-serialising the front matter instead would make the note differ from
   the pushed blob and read as edited at once. A write that fails or is skipped
   leaves the note without a `doc_id`; the next press completes it (the `sent`
   ref makes the branch recognisably the author's own).

*Alternatives:* `--force` (can destroy a reviewer's commit); delete-then-push
(two steps, a failure between leaves nothing); REST for the merge request
(brings the token back — the thing being removed).
The title is the document's front-matter `title`, stripped of line breaks and
capped at 200 characters (push options are single-line). Every process also runs
with `GIT_ALLOW_PROTOCOL=ssh` (so an address like `ext::…` cannot execute a
helper) and `-c core.fsmonitor=false -c core.hooksPath=…`, where the hooks path
is `/dev/null` on POSIX (nothing can be put there) and, on Windows, a folder in
the system temp area that is never created and that the runner refuses to run
beside if anything has been put in it. It is not a folder in the vault or the
plugin's own folder: those are exactly where a synced vault delivers files.
The address and key path read from `data.json` are validated on load (D12); an
invalid value is treated as unset.

Every command that reaches a server (`fetch`, `ls-remote`, `push`) also has to
**say which address it reaches**, which must be one of its own arguments, and a
key must have been chosen. Before it starts the runner asks git for every
`url.<base>.insteadOf` / `pushInsteadOf` setting (`config -z --get-regexp`, which
reads the repository's file and the author's) and stops with `address-rewritten`
if one covers the address, because the address that was tested and saved would
otherwise not be the one the command reaches. The check is on the prefix the
setting replaces, so the common setting for another host (rewriting
`https://github.com/`) does not stop anything. An address is therefore always
passed explicitly, as a URL, to every network command — never as a remote name,
whose address lives in a setting.

Programs are started by **full path**, found on a search path that has had its
empty and relative entries removed (an empty or relative entry means the working
folder, which is the vault; on Windows the working folder is searched before the
path at all, so a bare `git` would run a `git.exe` that arrived with a note).
When git is not on the path, the installers' folders are tried, which is also
what lets "Check again" find a git installed while Obsidian was running. The
ssh agent's socket is not passed on.

### D6. Connect this vault: adopt without touching files

Sequence, after `git --version` and a vault-is-a-repo check:

- **No repository.** `init`, `symbolic-ref HEAD refs/heads/<default>` (not
  `init -b`, which older Git lacks; `reset --mixed` onto an unborn HEAD was
  verified), `remote add origin`, write `.git/info/exclude`, `fetch --prune
  <verified address> +refs/heads/*:refs/remotes/origin/*` (by the address and an
  explicit refspec, never by the name `origin`, whose address is a setting that
  the runner's rewrite check cannot vouch for; verified that `--prune` works in
  this form), set `refs/docs-publisher/synced` and `connected` to a **commit of an empty tree** (nothing has been received, so the first update downloads the project; the fetched tip here would make every file look already received), then
  `reset --mixed` onto it. Every vault file differs from, or is absent in, the
  project's tree as in E4, so differences simply read as "edited".
- **A repository exists.** Adopt only if all hold, else refuse and change
  nothing: its top level is the vault root (a vault nested inside another clone
  would otherwise address paths relative to the wrong root); `origin` equals the
  configured address; the current branch is the default branch; and HEAD is the
  fetched tip or an ancestor of it (so no unsent local commit exists, and the
  later fast-forward drops nothing). Adopting moves **nothing**: HEAD and the
  index stay, only `synced` and `connected` are set — to HEAD, so the vault's
  older files are updated by Get updates rather than shown as edited — and the
  exclude file gains any missing line.

The default branch name is read from `ls-remote --symref <verified address> HEAD`
and must be an ordinary branch name — letters, digits, `.`, `_`, `-` and `/`, with
no leading dash or dot, no `..`, no `.lock`, no empty part — or it is refused as
unusable, because it later goes into addresses and refspecs (never
assumed `main`: the screenshots' vault is on `master`); an empty answer with exit
status 0 means the project has no commits yet. There is no special first-sync
conflict flow: a vault note that differs from the published copy is simply
"edited", and the author publishes it or resets it.

### D7. Typed failures, plain-words messages, setup failures route to the checklist

`git-publishing` returns `{ ok: false, failure: <kind> }` and logs raw stderr to
the console for support; nothing raw reaches the author (same shape as today's
`ClientResult`). All spawns run with `LC_ALL=C` and `GIT_TERMINAL_PROMPT=0`;
classification uses exit codes and a short list of stable phrases.

| Failure kind | Trigger (stable phrase / condition) | Author message | Invalidates |
|---|---|---|---|
| `git-missing` | spawn `ENOENT` | "Git isn't installed on this computer. Install it, then check again." | step 1 |
| `identity-missing` | name/email empty | "Tell us your name and email in the plugin's settings first." | step 5 |
| `address-invalid` | address does not parse | "That address isn't one Docs Publisher can use. Paste the SSH address from GitLab's Clone button — it starts with git@ or ssh://." | step 2 |
| `ssh-missing` | `ssh`/`ssh-keygen` not found | "Docs Publisher couldn't find SSH on this computer. Reinstalling Git usually fixes this." | step 3 |
| `key-rejected` | `Permission denied (publickey)` | "GitLab doesn't recognise this key yet. Add it on GitLab's SSH keys page, then test again." | step 3 |
| `key-protected` | `ssh-keygen -y -P ""` reports "incorrect passphrase" (verified: it prints the public key for an unprotected key and fails for a protected one; `BatchMode` alone would only show `Permission denied (publickey)`, indistinguishable from an unregistered key) | "This key is protected by a password, which Docs Publisher can't type for you. Create a new key for Docs Publisher." | step 3 |
| `key-unreadable` | the same probe fails for any reason other than a passphrase (missing file, permissions ssh refuses, a corrupt key) — a different answer from `key-protected` and from an unregistered key | "Docs Publisher can't read this key, so it can't use it. Create a new key for Docs Publisher instead." | step 3 |
| `key-exists` | Create key finds anything at the dedicated key's names (a stray `.pub`, a link, a file ssh-keygen cannot read), or loses a race for them | "There is already a file named docs-publisher_ed25519 in your .ssh folder that Docs Publisher can't use. Rename or move it, then press Create key again." | step 3 |
| `address-rewritten` | the runner's own refusal: a `url.<base>.insteadOf` / `pushInsteadOf` setting covers the address a network command reaches | "A setting on this computer sends this address somewhere else, so Docs Publisher stopped. Ask whoever set up Git on this computer to remove it." | step 2 |
| `host-changed` | `REMOTE HOST IDENTIFICATION HAS CHANGED` / `Host key verification failed` | "GitLab's identity has changed since you last connected. Ask your admin before continuing." | step 3 |
| `server-unreachable` | resolve/connect/timeout | "Could not reach GitLab at that address. Check the address and your connection, then try again." | — |
| `project-not-found` | `repository ... not found` after a working key | "That project could not be found, or your access does not include it. Check the address in settings." | step 2 |
| `empty-repository` | empty `ls-remote` answer, exit 0 | "That project has nothing in it yet. Ask your admin to add a first file." | — |
| `not-allowed` | push refused by the server's access rules | "GitLab did not accept this document. Your account may not be allowed to add documents to this project. Ask your admin for Developer access." | — |
| `changed-meanwhile` | lease/stale-info rejection | "Someone changed this document on GitLab while you were sending it. Get updates, then send again." | — |
| `timed-out` | spawn killed on timeout | Submit: "Submit didn't go through. Check your connection and submit again." Get updates: "Could not get updates. Check your connection and try again." Test, Connect, Refresh: the `server-unreachable` message. | — |
| `unexpected` | anything else | same as `timed-out` for Submit and Get updates; for a setup action: "The check did not succeed. Check your setup and try again." | — |

A failure that invalidates a step re-opens the panel's checklist at that step.
The `not-allowed` row replaces the role pre-check: the plugin attempts and
translates, as `config.yaml` already requires ("token permissions cannot be
pre-flighted"). Messages specific to one action are quoted in the spec that owns
that action; all author-facing strings live in one registry module that a test
scans for banned words (tasks 1.4).

### D8. State is derived from git, never stored

Definitions, for a note with `doc_id = D`, with `M` = fetched default tip,
`B` = fetched `doc/D`, `S` = last synced version, `L` = commit at
`sent/D`:

- `remotePath(D)`: if `B` exists, the single markdown file `B` changed relative
  to its merge base with `M`; otherwise the single path in `M` whose filename
  derives `D` (unique by the project's naming rule, `docs/document-naming.md`);
  otherwise none. More than one candidate counts as none. Keying by `doc_id`
  rather than by the note's current path means a renamed or moved note keeps its
  state, and the path-drift check ("A local path drifted from the remote path")
  has its source: the note's path against `remotePath(D)`.
- A review is **live** when `B` exists and at least one file it changed relative
  to the merge base differs from `M`'s copy (or `M` lacks it). Counting every
  changed file, not only the note, makes an image-only revision pending. A
  branch left behind after a merge — including a squash merge, whose commits are
  not ancestors of `M` but whose blobs equal `M`'s — is not live.

| Condition (from the last fetch) | State | Label |
|---|---|---|
| no `doc_id` | not listed (as today) | — |
| review live | pending | Waiting for review |
| not live, `remotePath(D)` present on `M` | published | Published |
| not live, `remotePath(D)` none | closed | Not accepted |
| no fetch has completed | unresolved | (none; listed under "Needs you") |

A note carrying a `doc_id` has therefore always been submitted: the field is only
written after a successful push, and the one state "never submitted" in the REST
design is unreachable here. It is dropped, with its label.

**Edited.** A note is edited when its bytes equal none of the versions it could
legitimately be: `S`'s, `M`'s, `L`'s, or `B`'s copy at `remotePath(D)`. Set
membership, not a single baseline, because each of the four is a state the author
is not responsible for: equal to `S` means the note simply has not received
others' later change (it must not be raised as work); equal to `M` means it is
published; equal to `L`/`B` means it is what was sent. No `remotePath` → not
edited (same rule as today).

Known limits, accepted: a review closed without merging whose branch nobody
deletes reads "Waiting for review"; `closed` is a heuristic (a document merged
under a different path reads "Not accepted" if `remotePath` cannot find it).
"Changes requested" cannot be derived (no review-thread data without the API) and
is removed on purpose.

### D9. Get updates: per-file rule, base = the last synced version, never `git pull`

**Standing rule reversed.** `config.yaml` ("NO CI PIPELINE") says any pull other
than "this one document, author-confirmed" must baseline on the last content
submitted from this vault and must refuse while a document is awaiting review.
That rule exists to stop *silent loss*. Refusing while any review is open would
make Get updates unusable (a vault with one pending document could never update),
so this change keeps the purpose and drops the mechanism: a file is overwritten
only if the note equals the last synced version; a note the author changed is
merged or asked about; a recoverable copy is kept before any replacement of the
author's text; and the author's own merged work never counts as someone else's
(rule 3). The document branch is never touched by an update.

After `fetch`, resolve the fetched default tip **once** to a commit `T` and use
that commit for every read and for the final step (a second fetch cannot change
what this run compares against; refresh and the panel-open fetch are held off
while an update runs). For each path `p` where `S(p)` differs from `T(p)`, with
`mine` = the vault's file (absent if none):

| Case | Action |
|---|---|
| 1. `mine == T(p)` (same bytes, or both absent) | nothing |
| 2. `T(p) == L(p)` — the version this vault last sent for `p` | nothing (the author's own change is back) |
| 3. `mine == S(p)` (same bytes, or both absent) | take theirs: write, or move to the vault's trash when `T(p)` is absent |
| 4. mine absent, `S(p)` and `T(p)` both present, `T(p)` differs | ask: "Keep it removed" / "Get it back" |
| 5. mine present, `T(p)` absent, `mine != S(p)` | ask: "Keep mine" / "Remove it" |
| 6. mine present, `S(p)` absent, `T(p)` present, `mine != T(p)` (added on both sides) | ask: Keep mine / Use theirs / Keep both |
| 7. all three present and different, text, `merge-file` clean | write the merged text; tell the author |
| 8. all three present and different, and the edits overlap or the file is binary | ask: Keep mine / Use theirs / Keep both |

**Added 2026-10-26 (manual testing).** Two amendments to the path set:

- *A file the project has, unchanged since the last update, and the vault lacks, is
  also a path to decide (`S(p) == T(p)`, `mine` absent).* It takes row 3's action:
  theirs is written back, and it counts as an update. Without this, a note the
  author deleted after an update could never be got back: nothing differed, so
  Get updates reported "up to date" and the file stayed gone. Cost: row 4's
  "Keep it removed" holds for that update only. The next one brings the file back,
  because nothing records the choice. If that proves wrong in use, record the
  declined blob per path (a ref listing) and skip restoring a path whose
  declined blob equals `T(p)`.
  *Exception: a moved note.* A missing path whose exact bytes (blob id) are found at
  another vault path that the project does not have is a move or rename, and is
  not restored, or the move would leave two copies. Only files the project lacks
  are read, and only when something is missing. A move that was also edited has
  no matching bytes and the original comes back; telling it from a deletion plus
  a new note would be a guess.
- *Hidden paths are not part of either listing.* A file or folder whose name
  starts with a dot (`.claudian/`, another tool's settings committed to the
  project) is never compared, counted or downloaded: Obsidian does not index
  dotted names and its file API will not write them, so such a path stayed "an
  update" for ever and every attempt to save it failed (`isHiddenPath`, applied
  where trees are parsed).

Skipped paths (a name the OS refuses, a note open with unsaved changes) are
reported and left alone. Then the **last synced version advances** to a commit
whose tree is `T`'s except that every skipped path keeps its previous `S` entry
(or stays absent), so the next run sees exactly those paths again, while a note
the author kept (rows 4–6, 8) reads "edited" against the new base and is not asked
again. There is no stored conflict state and no `MERGING`. Finally `reset --mixed
T` moves HEAD and the index (a fast-forward by construction, D6). If nothing was
skipped the new synced version is simply `T`.

Choices: **Keep mine**; **Use theirs**; **Keep both** (theirs is saved beside the
note as `<name> (from GitLab).<ext>`, then `(from GitLab 2)`, … if that name is
taken). Before any write that replaces text the author changed — a clean merge,
**Use theirs**, **Remove it** — the plugin copies the author's version to
`.trash/Docs Publisher/<timestamp>/<path>`, its own folder, so recovery does not
depend on the vault's "deleted files" setting; removals of unchanged notes go to
the vault's own trash with `vault.trash(file, false)` for the same reason.

The first run after Connect that would change anything shows a dry-run summary
(downloads, updates, decisions needed) and applies nothing until the author
confirms; "first" is read from git: `synced` still equals `connected`. Paths
under `.obsidian/` and `.git/` are never read or written. A file the OS refuses
(invalid Windows name, too long) is skipped with a message and the rest
continues, which raw git does not do. `core.longpaths=true` is forced per command.

**Case-insensitive file systems** (Windows, and macOS by default). Occupancy is
decided case-insensitively there: a file whose name differs from the project's
only by case counts as `mine present`, so rows 6/8 ask instead of one name
silently replacing the other (`docs/document-identity.md` names this hazard for
path comparison; it applies to writes too). Detection is by probing, not by
assuming the platform.

**Unsaved changes.** A note open in an editor has unsaved changes when the editor's
text differs from the file's text on disk; it is then skipped with a message,
and the rule is exercised by a unit test, not left to manual checking.

*Alternatives:* `git pull`/`merge` (E3: refuses on identical content, and leaves
marker files and `MERGING` state for non-technical authors); `rebase` (rewrites
state the author cannot see); advancing HEAD and treating HEAD as the base (a
skipped file would then be lost to the next run — the review's blocker).

### D10. Setup readiness: local checks only, cached, shared

Five steps, computed in order, each from local facts only: (1) `git --version`
succeeds; (2) the project address parses and is valid (D12); (3) a key file
exists, the last Test succeeded for this key and address (persisted), **and** a
username is known (read by the Test, or typed); (4) the vault's `origin` equals
the address and a fetch has completed; (5) an effective `user.name` and
`user.email` exist. Identity is last on purpose: Save writes `git config
--local`, which needs the repository step 4 creates, so before step 4 the
identity fields are shown read-only. Nothing the plugin does before Publish needs
an identity, and it is passed to every commit explicitly. Network is touched only
by the explicit actions (Test, Connect, Publish, Get updates, Refresh and the
fetch when the panel opens); "Check again" and the other recomputations are local.
The result is held in a single holder both the panel and the settings tab
subscribe to — the pattern `ConnectionStateHolder` already uses — so a step done
on one surface shows on the other. `requireAuthoringGate` (12 callers) is
extended to require readiness, so the command palette cannot bypass the
checklist. `ConnectionState` and its role helpers are deleted; callers move to the
readiness holder.

### D11. SSH key handling

Order of use: the dedicated `docs-publisher_ed25519` if present, else
`id_ed25519`, else `id_rsa`, else offer **Create key**. Creation runs
`ssh-keygen -t ed25519 -N "" -C "docs-publisher" -f <path>`, refuses if anything
exists at either name (a file, a folder, a link, even a link to nothing, which a
`stat` calls absent and `ssh-keygen` would write through), and creates `~/.ssh`
if missing. The pair is made in a scratch folder inside `~/.ssh` and then put in
place with an exclusive copy (`COPYFILE_EXCL`, which fails rather than replace
and cannot follow a link), the private half first and removed again if the
public half cannot be placed, so nothing that appears between the check and the
write is overwritten. The copy is the operating system's; the private bytes do
not pass through the plugin. The plugin reads only
the `.pub` file (to copy it); it never reads, copies or logs a private key, and
plugin data holds the key's *path*, not the key. Git is told which key to use
with `GIT_SSH_COMMAND=ssh -i <path> -o IdentitiesOnly=yes -o BatchMode=yes -o
StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -o ForwardAgent=no -o
ClearAllForwardings=yes -o ForwardX11=no` (a command-line option wins over the
author's own `ssh_config`, and this connection has no use for a forwarded agent,
port or display, which a tampered address would otherwise be handed); `BatchMode` makes a
passphrase fail fast instead of hanging a GUI process. The command string is
built by one pure function, unit-tested for spaces, non-ASCII, backslashes and
quotes, because Git runs it through a shell (Windows paths such as
`C:\Users\<name with a space>` are the likeliest first failure — see group 1).
Test first probes the key with `ssh-keygen -y -P ""` (a protected key stops here
as `key-protected`; the private key is read by ssh-keygen, never by the plugin),
then `git ls-remote --symref <ssh-url> HEAD` (proves key + project access and
yields the default branch), then `ssh -T` for the username line; if `ssh` cannot
be run directly, or the greeting is unreadable, the username is typed (and the
key step stays incomplete until it is).
Timeouts kill the whole process tree: on Windows Node's `execFile` timeout kills
only `git`, and a grandchild `ssh` keeps the pipes open, so the runner kills the
tree (`taskkill /T /F` there, the process group elsewhere).
Security trade-offs, recorded: the dedicated key is unencrypted at rest (bounded
by GitLab's protected default branch — reviewers merge, an author's key cannot
publish); `accept-new` trusts the host key on first connect (a changed key then
fails with `host-changed`); deferred: pinned fingerprints.

### D12. Project address

One field. Accepted: `git@host:group/sub/project(.git)`,
`ssh://git@host[:port]/group/project(.git)`, and
`https://host/group/project(.git)` (converted to `git@host:…`, assuming port 22
and user `git`; an instance with another SSH port must paste the SSH form).
A numeric project ID is not accepted (it cannot form an SSH address). **Validated
on entry and again on load**, because the value later reaches argv and a shell
string: the host matches `[A-Za-z0-9.-]+` and does not begin with `-`; the user is
`git`; the path has no `..`, no control characters, no leading `-`; and no
`ext::`/`file:` style scheme is accepted. An invalid stored value is treated as
unset. Derived and never stored separately: the web base `https://<host>` for the
"Open in GitLab" links and the key page `https://<host>/-/user_settings/ssh_keys`.

### D13. Plugin data

`data.json` keeps: project address, key path, last-tested username, and the pair
the last successful Test covered (`testedFor: { keyPath, address }`, which step 3
needs). Nothing secret. Saving **merges** into the loaded object, so legacy keys
(`submissions`, `connection`) are preserved for the rollback in Migration; they
are ignored, never deleted (`plugin/install.sh` already preserves the file). The
loader tolerates any file content by starting from defaults. This **removes** the
`guard-plugin-data` requirement: that guard existed because the file held
irreplaceable facts (imported documents' published state); nothing in it is
irreplaceable now — the address is also in `.git/config`, name and email are git
config. `SubmissionStore` shrinks to a settings store; `ActionSlot` stays and its
action set becomes Publish, Reset, Get updates, Connect this vault, Test and
Create key.

### D14. Links

Waiting for review → `https://<host>/<path>/-/merge_requests?state=opened&
source_branch=doc%2F<doc_id>`; Published → `https://<host>/<path>/-/blob/<default>/<file path>`.
Both are derived from the address, so a link costs no request.

### D15. Testing

`GitRunner` is an interface with a real implementation (spawn) and test doubles.
Core behaviour is tested against real `git` in temp bare + working repos (CI has
git). Tests assert **the plugin's** behaviour — that Publish leaves the note
untouched, that Get updates succeeds on a byte-identical file — and record what
plain git does in E1/E3 as a comment, since asserting git's own behaviour proves
nothing about the plugin. Further tests: a diverged edit (both change different
paragraphs → merged; same paragraph → prompt), a skipped file followed by a
second update and then a Publish (the stale guard must still fire), an "already a
repo with another origin" refusal, the runner's allowlist refusing `checkout` and
friends, a timeout test with a grandchild process, a path with spaces and
non-ASCII for the ssh command builder, address-validation fixtures (`-oProxyCommand`,
`ext::`), and `LC_ALL=C` classification. Stderr and push-reply fixtures begin
provisional and are replaced by lines recorded from the target in task 3.10. UI
states are tested against the stub runner. New modules must reach the project's
80% bar.

### D16. Local bookkeeping refs

Three kinds of local-only ref live under `refs/docs-publisher/`, never pushed:
`synced` (a commit whose tree is the last synced per-path state — the base for
Get updates and the stale guard), `connected` (the commit Connect recorded, so
"the first update" is derivable from git), and `sent/<doc_id>` (the last commit
this vault built for a document — keeps its objects from being collected, defines
which commits are the author's own, and supplies `L`). **Reset also points
`sent/<doc_id>` at the branch tip it brings into the note**: the author has now
seen those commits, so they stop counting as someone else's — without this the
"changes that aren't in your note" refusal would repeat after every Reset. They keep the design's
"git is the database; the plugin stores no records" true: nothing here is in
`data.json`, and losing them degrades safely (no `sent` ref → a branch reads as
someone else's and the author is told to Reset or get updates; no `synced` ref →
Connect re-runs).

## What this removes (the one register)

| Removed | Why | What the author sees instead | If it is ever wanted back |
|---|---|---|---|
| "Changes requested" state | needs review-thread data = the REST API | review feedback arrives via GitLab's own notifications; the document reads "Waiting for review" | add an optional token read path behind `git-publishing` |
| "Not submitted yet" as a derived state | a note with a `doc_id` has always been submitted | none | — |
| Role pre-check (Developer/Reporter gate, role names) | needs the API | the attempt fails with the `not-allowed` message | none planned |
| Reviewer Merge (milestone 8) | needs the API; never built | reviewers merge in GitLab; "Open in GitLab" link | a new proposal |
| Recover, Import, Discover | Get updates brings everything | no download list; "N updates available" | per-document download = sparse checkout, a new proposal |
| Stored submission records, project scoping, edit baseline in data | git is the database; one vault = one project (origin) | none | — |
| `guard-plugin-data` | nothing irreplaceable is stored | none | — |
| Token, expiry messages, "Test connection" against the API | no token | key Test | — |
| "Refuse a pull while a document awaits review" (config.yaml) | would make Get updates unusable; its purpose (no silent loss) is met per file | none | — |
| Mobile | SSH needs the binary | desktop only | out of scope |

## Risks / Trade-offs

- **Spawning `git`/`ssh` from Obsidian on Windows misbehaves** (quoting, PATH, ssh
  location, a grandchild `ssh` outliving a timeout) → the checks on a real Windows
  machine (`docs/ssh-setup.md` §2) were first planned as a gate before anything else
  was built; they were moved to the whole-plugin test at the end (decision 2026-10-23),
  trading earlier certainty for not stalling on a machine that is not at hand, with
  Windows-specific code kept in a few small places so a failure there is cheap to
  fix; the command builder is a
  pure, tested function; the runner kills the whole process tree.
- **A hung `ssh` freezes the busy slot** → every spawn has a timeout and is killed;
  `BatchMode`, `GIT_TERMINAL_PROMPT=0`, `ConnectTimeout`.
- **The push option does not open the review request on the target, or the server
  refuses push options outright** → partial-success path with GitLab's printed
  link and an "Open to request review" button, and a single retry without options;
  exercised in group 3.
- **A skipped file loses its base** → the synced version advances to a tree that
  keeps the old entry for skipped paths; a test runs skip → update → Publish.
- **Author text lost by Get updates** → a recoverable copy in the plugin's own
  folder before any replacement, independent of the vault's trash setting; a
  dry-run summary on first run.
- **Stranger/own-branch ambiguity without the API** → ownership is "reachable from
  this vault's `sent` ref", not an email. A same-person other-machine branch is
  treated as someone else's and the author is told what to do; never overwritten.
- **Case-insensitive file systems** → occupancy decided case-insensitively, probed
  not assumed (D9).
- **"Not accepted" heuristic and left-behind branches** → documented (D8); the
  label is a hint, and Open in GitLab is one click away.
- **Vault already a repository / Obsidian Git also running / nested clone** →
  refuse a foreign origin, a nested top level or unsent commits; warn about
  Obsidian Git; never run a working-tree-writing command (D3).
- **Untrusted data reaching a process** (`data.json`, an adopted repository's
  config, a `doc_id` from a received note) → validate on load, `GIT_ALLOW_PROTOCOL=ssh`,
  hooks and fsmonitor off, push to the verified URL, `--no-verify`, re-validate
  `doc_id` as ref-legal before building a ref.
- **`config.yaml` over its limit** → shrink first (task 0), verified by byte
  count, before any decision text is added.
- **Large change in one proposal** → ordered groups, each ending in a demo; one
  shippable unit; group 5 (deletion) last.
- **Four in-flight changes** → archived first; see Migration.

## Migration Plan

0. Archive `self-service-token-messages`, `add-action-busy-states`,
   `show-reset-after-submit`, `guard-plugin-data` (each either finishes its last
   task or is archived as it stands); confirm `openspec validate` is clean on
   this change afterward. Tag `pre-git-pivot`.
1. Shrink `openspec/config.yaml`'s context block under 40 KB of parsed context
   (move detail to `docs/`, delete REST-era text), update the vocabulary rule's
   example list (in `rules.specs`, drop "Changes requested"), record the reversed
   decisions including the pull rule in D9.
2. Build groups 1–4 on a single long-lived branch. Each group ends in a demo that
   is a checkpoint, not a release; the shippable unit is the whole change.
   Old and new code coexist on that branch until group 5 deletes the REST path.
3. Group 5: delete token/REST code and tests, bump `versions.json`, set
   `isDesktopOnly: true`, update docs and `plugin/README.md`.
4. First launch after upgrade: legacy `data.json` keys ignored; the checklist
   starts at the first unmet step. Reviews opened under the old plugin keep their
   `doc/<doc_id>` branches, but "this vault's own commits" cannot be recognised for
   them (no `sent` ref), so a first Send update on such a document first reads
   "The version under review has changes that aren't in your note. Use Reset…" —
   one Reset, then normal. After Connect, a note whose bytes differ from the
   project's reads "Published" with the edited marker; that is the author's real
   unsent change.
5. **Rollback**: reinstall the `pre-git-pivot` build. The `.git` folder it leaves
   in a vault is inert to the old plugin, and `data.json`'s legacy keys were
   preserved by every save.

## Open Questions

Each has a fallback and is exercised by a named task; none blocks starting.

1. Does `merge_request.create` open the request on the target CE (19.4.0 per
   `docs/access-tokens.md`)? Fallback: printed link + "Open to request review".
   Also confirm `merge_request.remove_source_branch`, that repeating `create` on
   an open request is harmless, and the exact reply lines for "created" and
   "link only" (group 3, recorded as fixtures).
2. Does `ssh -T` print `Welcome to GitLab, @username!` there? Fallback: the
   username is typed (group 1).
3. Is the key page at `/-/user_settings/ssh_keys` on that version? Fallback:
   open the host root with the instruction text (group 1).
4. Where is `ssh`/`ssh-keygen` on an author's Windows machine — `PATH`, or only
   inside Git for Windows? Settled by the group 1 spike (PATH first, then
   alongside `git --exec-path`).
5. Can an open note's unsaved state be read reliably as "editor text ≠ file text"?
   Settled in group 4 by a unit test and one manual check; fallback: skip every
   open note and say so.
