# SSH setup: how the plugin connects, and what has been checked on a real machine

Written for whoever installs the plugin for a team, and for whoever maintains
it. It replaces `access-tokens.md`: the plugin no longer uses an access token,
so nothing here is a token. These are DECISIONS and MEASUREMENTS. Read the
relevant section before changing how the plugin starts `git` or `ssh`, how it
chooses or creates a key, or what the setup screen says.

The design behind it is `design.md` in the change `replace-rest-with-local-git-ssh`
(D1, D3, D5, D11, D12). This file holds what the design could only assume until
someone ran it on a real machine.

---

## 1. What the plugin does with a key

- It uses an existing key if there is one, in this order: its own
  `docs-publisher_ed25519`, then `id_ed25519`, then `id_rsa`, in the author's
  `.ssh` folder. If there is none it offers **Create key**, which makes
  `docs-publisher_ed25519` with no password, and never overwrites a file.
- It never reads a private key. It learns a key exists by checking the file is
  there, shows the public half by reading the `.pub` file, and asks `ssh-keygen`
  — a separate program — whether the key has a password.
- Git is told to use only that key, never to ask a question, and to trust a
  server's identity the first time it connects and refuse it if it later changes.

### How the processes are started, and what that is for

All of this was added after a review of the first version (task 1.12). Each line
names the thing it prevents, because several look like fussiness until someone
asks what happens without them.

- **Programs by full path, from a clean search path.** A bare `git` is looked for
  in the working folder first on Windows, and the working folder is the vault. A
  `git.exe` that arrived in a vault with a note would run as the author. So
  empty and relative entries are removed from `PATH`, and git, ssh and ssh-keygen
  are started by the path they were found at. `taskkill` is started by its system
  path for the same reason.
- **Git is found even when Obsidian cannot see it.** A program's `PATH` is a copy
  taken when it started, so Git installed afterwards is invisible to it. The
  installers' folders are tried when `PATH` has none, so "Check again" works
  without restarting Obsidian.
- **No hooks.** A repository's hooks are programs, and a vault is a place files
  arrive in from elsewhere. POSIX points hooks at `/dev/null`. Windows has no path
  that means nothing, so it uses a folder in the system temp area that is never
  created, and refuses to run if anything has been put there. (A folder inside the
  vault or the plugin folder would be synced.)
- **Only the key that was chosen.** No ssh agent is passed on, and the ssh command
  forbids agent, port and display forwarding whatever the author's own `ssh_config`
  says.
- **Every option written out.** Each git subcommand lists the options it accepts
  (`git-command-rules.ts`). Git accepts abbreviations and glued short options, so
  refusing the word `--hard` would still let `--har` through.
- **Network commands name their address.** And no `url.<base>.insteadOf` or
  `pushInsteadOf` setting may cover it, or the address that was tested and saved
  would not be the one reached. A rewrite for another host (the common
  `https://github.com/` one) is left alone.
- **Closing the plugin ends what is running.** Otherwise an ssh outlives it.

### Security trade-offs, recorded rather than hidden

| Trade-off | Why it is accepted | What bounds it |
|---|---|---|
| The plugin's own key has no password | The process that uses the key has no terminal to type one into | The project's default branch is protected: an author's key can send a document for review, it cannot publish one. A copied key can be removed in GitLab by its owner. |
| The server's identity is trusted on first connect | Asking would hang a window nobody can answer | A changed identity later is refused with its own message. Pinning a fingerprint is deferred. |
| `ssh-keygen` reads the private key to say whether it has a password | There is no other way to tell a protected key from an unregistered one | The key is read by `ssh-keygen`, not by the plugin; only a yes or no comes back. |

---

## 2. The Windows check (task 1.11)

> **Status (2026-10-23):** not a gate any more. It is run as part of the
> whole-plugin test at the end (task 5.7(d)), on the finished plugin. The steps
> and the results table below are unchanged. "Go / no-go" below now means "is the
> process layer sound on Windows", and a no-go at that point means reworking it.

**Why it exists.** Everything built so far is tested on Linux. The part most
likely to behave differently is starting `git` and `ssh` from inside Obsidian on
Windows: how a key path with a space is quoted, where `ssh` is found, and
whether a stuck process is really stopped. If this check cannot be made to pass,
stop and reopen `design.md` D1 and D11 **before** building publishing and
updates on top of it.

**Needs:** a Windows 10 or 11 machine with Git for Windows; Obsidian desktop; a
scratch GitLab project where you hold at least Developer access (the check opens
no review, but use a project nobody depends on); a copy of a vault or an empty
one.

**Install the build.** From the `plugin` folder run `npm run build`, then copy
`main.js`, `manifest.json` and `styles.css` into
`<vault>\.obsidian\plugins\obsidian-docs-publisher\` and enable the plugin.

### Steps

Run them in order. For each, write what you saw in section 3. A step that shows
the expected text and nothing else is a pass.

| # | Do | Expect |
|---|---|---|
| 1 | Open the Docs Publisher panel. | "Set up Docs Publisher", "Step 2 of 5", "Add your project's address." (git was found). If it says Git isn't installed although `git --version` works in a terminal, that is a failure: note `where git` and what Obsidian's PATH is. |
| 2 | In the terminal run `where ssh`, `where ssh-keygen` and `git --exec-path`. Write down all three. | Used in step 6 to see where the plugin must look. |
| 3 | In settings, paste the project's SSH address and click away. | The field keeps the address and the panel moves to the key step. |
| 4 | Press **Create key**. | The key step now offers Copy key, Open GitLab and Test. `%USERPROFILE%\.ssh\docs-publisher_ed25519` and `.pub` exist. |
| 5 | Press **Copy key**, then **Open GitLab**. | The key is on the clipboard. GitLab opens on the **SSH Keys** page of your account. Paste the key, give it a title, add it. |
| 6 | Press **Test**. | "Your key works. Connected as `<your username>`." Note whether it said that or asked you to type a username. |
| 7 | Close Obsidian. Start it with a profile folder that contains a space: in a terminal `set USERPROFILE=C:\Temp\Test Folder` then start Obsidian from that same terminal. Repeat steps 3–6 (the key is created under that folder). | The same results. This is the quoting check. |
| 8 | Turn the network off. Press **Test**. | "Could not reach GitLab at that address. Check the address and your connection, then try again." within about 30 seconds. Afterwards run `tasklist \| findstr /i "ssh git"`: **no** `ssh.exe` or `git.exe` should be left running. |
| 9 | Make a key with a password in a terminal (`ssh-keygen -t ed25519 -f "%USERPROFILE%\.ssh\id_ed25519" -N "pw"`, only if you have no `id_ed25519`), remove the plugin's own key, and press **Test**. | "This key is protected by a password, which Docs Publisher can't type for you. Create a new key for Docs Publisher." |
| 10 | Remove the key from GitLab. Press **Test**. | "GitLab doesn't recognise this key yet. Add it on GitLab's SSH keys page, then test again." |
| 11 | Change the address to one with a mistyped host. | After leaving the field and pressing Test, the unreachable message. |
| 12 | Start from a machine **without** Git, with Obsidian open on the panel ("Git isn't installed…"). Install Git for Windows with its defaults, without closing Obsidian, and press **Check again**. | The panel moves on to step 2 without Obsidian being restarted. Note whether `where git` found it from a terminal opened before the install (it will not) and which folder the plugin found it in. |
| 13 | In step 7's profile folder, use a name with non-ASCII letters (for example `C:\Temp\Trần Phạm`), and repeat step 6. | The same pass. This is the one place the forced `LC_ALL=C` meets a non-ASCII path inside Git for Windows' `sh`, which no test here could reach. |
| 14 | Copy any harmless program (for example `calc.exe`) into the vault's root folder, renamed `git.exe`, and press **Check again**. | The calculator does not open, and the panel finds the real Git. |
| 15 | Create the folder `%TEMP%\docs-publisher-no-hooks` and put an empty file called `pre-push` in it. Press **Check again**. | The panel says Git can't be used (the plugin refuses to run beside a hooks folder with something in it) and the console says why. Delete the folder and press again: it works. |

### Decision

- **Go** if steps 4, 6 and 8 pass, and steps 7 and 12–15 pass or the failure is
  understood and fixed. Steps 12–15 are the ones this check exists for: they are
  the Windows behaviour that the tests here could only model.
- **No-go** if the key cannot be created, the test cannot be made to reach
  GitLab, or a process is left behind. Write down exactly what failed and reopen
  the design; do not patch around it in the publishing code.

---

## 3. Results

Fill in on the machine. Leave a row empty until it has been run.

| Item | Result |
|---|---|
| Machine, Windows version, Git for Windows version | |
| Obsidian version | |
| `where ssh` / `where ssh-keygen` / `git --exec-path` | |
| Step 1: git found by the plugin | |
| Step 4: key created, files present | |
| Step 5: Open GitLab landed on the SSH Keys page | |
| Step 6: Test passed; username read from the server's greeting, or typed | |
| Step 7: profile folder with a space | |
| Step 8: unreachable message; no process left behind | |
| Step 9: password-protected key recognised | |
| Step 10: unregistered key message | |
| Step 11: mistyped host | |
| Step 12: Git installed while Obsidian was open, found by Check again; folder it was found in | |
| Step 13: non-ASCII profile folder | |
| Step 14: a `git.exe` in the vault was not run | |
| Step 15: a non-empty hooks folder was refused, and an absent one accepted | |
| What the plugin printed in the developer console (Ctrl+Shift+I) | |
| **Decision** (go / no-go) and date | |

### Open questions this check settles

1. Where are `ssh` and `ssh-keygen` on an author's Windows machine — on `PATH`, or
   only inside Git for Windows? (The plugin looks on `PATH` first, then beside
   `git --exec-path`.)
2. Does `ssh -T` print `Welcome to GitLab, @<name>!` on the target instance?
   If not, the author types a username once.
3. Is the keys page at `/-/user_settings/ssh_keys` on the target's GitLab version?
4. Does editing a note while it is being updated keep every keystroke? (Settled
   later, in task 4.6, and recorded in section 5.)

---

## 4. Known limits

- **A web port in an https address is not an ssh port.** `https://host:8443/a/b`
  is saved as `git@host:a/b.git`, which uses ssh's port 22, and the keys-page link
  keeps the web port. A GitLab whose ssh is on another port must be entered in its
  ssh form (`ssh://git@host:2222/a/b.git`). The address field's hint already says
  to paste the ssh address from the Clone button.
- **Paths in the plugin's own data file are trusted as far as they are checked.**
  The address is parsed and the username is held to GitLab's alphabet on load; the
  key path is used as a path and never read by the plugin. The send confirmation
  names the server (task 3.4) so a changed address is visible before anything is
  sent.
- **A hand-run `git` is not covered by any of the above.** These rules bind what
  the plugin starts, not what the author does in a terminal.

---

## 5. Findings from later groups

Recorded here as they are made: the push options (task 3.10), unsaved notes while
updating (task 4.6).
