# Git Publishing Specification

## Purpose

This capability is the plugin's only boundary with the project's remote: it runs the author's own `git` and `ssh` as hermetic local processes, with no shell, a clean environment, an exact allowlist of subcommands and options, and no hooks. It reads and writes the vault's repository, builds a commit for one note and its images without touching the working tree, pushes it to a document branch with review-request options, fetches the project into a local copy, and turns failures into a small set of classified outcomes that callers can show the author in plain words.

## Requirements
### Requirement: All remote access goes through this capability
Every `git` or `ssh` process the plugin runs, and every construction of the
remote's address, SHALL happen only in this capability. No other part of the
plugin SHALL spawn a process, build a remote address, or reference a
platform's address or push-option shape. Callers SHALL pass the project
address and identity they hold and receive a typed result they can act on
without knowing how it was obtained.

#### Scenario: Another capability needs something from the remote
- **WHEN** any capability outside this one needs information from, or to send something to, the remote platform
- **THEN** it calls a method on this capability rather than running a process itself

#### Scenario: Checking the boundary holds
- **WHEN** the plugin's source is inspected for `child_process`, `execFile`, `spawn` and for the git subcommand names it runs
- **THEN** they appear only within this capability's files

### Requirement: Whether a branch exists can be read, as a three-way answer
This capability SHALL provide a way to read whether a named branch exists on
the remote, as known from the last completed fetch. The answer SHALL
distinguish three outcomes: the branch exists, the branch is absent, or the
lookup itself did not succeed. A branch SHALL be reported absent only when a
fetch has completed and the fetched copy does not list it. Every other
condition — no fetch has ever completed, the fetched copy cannot be read —
SHALL be returned as a lookup failure and SHALL NOT be reported as absence.

The distinction is normative rather than stylistic. Callers use this answer to
decide whether a document's review is live and whether an abandoned branch
may be replaced, and a failure reported as absence would license both.

#### Scenario: The branch exists
- **WHEN** the lookup is performed for a document branch the last fetch listed
- **THEN** the caller receives the exists answer

#### Scenario: The branch is absent
- **WHEN** a fetch has completed and the fetched copy does not list the branch
- **THEN** the caller receives the absent answer

#### Scenario: No fetch has completed
- **WHEN** the lookup is performed in a vault whose first fetch has not completed
- **THEN** the caller receives a lookup failure, and does NOT receive the absent answer

#### Scenario: A branch the remote deleted disappears after the next fetch
- **WHEN** the remote deleted a document branch and the next fetch completes
- **THEN** the lookup reports that branch absent

### Requirement: A file's content at a path and ref can be read, as a three-way answer
This capability SHALL provide a way to read a single file's raw bytes at a
given repository path and fetched ref (a remote-tracking branch or a commit),
as a THREE-WAY answer: the file exists and its bytes are returned, the ref
exists but holds no file at that path, or the read did not succeed. It SHALL
NOT collapse "does not exist" and "the read failed" into one outcome, and it
SHALL read from the fetched copy without contacting the remote.

The three-way shape is normative for the same reason the branch lookup's is: a
caller decides whether to proceed with a write or to refuse from this answer,
and a failed read reported as absence would license both incorrectly.

#### Scenario: Reading a file that exists
- **WHEN** the read is performed for a path and ref where a file exists
- **THEN** the caller receives that file's bytes unchanged

#### Scenario: Reading a file that does not exist
- **WHEN** the read is performed for a ref that exists and a path it does not hold
- **THEN** the caller receives an explicit absence, not a failure

#### Scenario: The ref itself is unknown
- **WHEN** the read is performed for a ref the fetched copy does not have
- **THEN** the caller receives the read failure, and does NOT receive an absence or empty content

#### Scenario: The read makes no remote request
- **WHEN** a file is read at a fetched ref
- **THEN** no network connection is made

### Requirement: Failures are classified, not passed through raw
This capability SHALL classify every failed git or ssh operation into exactly
one of the following kinds and return it to its caller: git missing, identity
missing, address invalid, address rewritten by a git setting, ssh missing, key
rejected, key protected by a password, key that cannot be read, key file in the
way, host identity changed, server unreachable, project not found, empty
project, not allowed, changed meanwhile, timed out, or unexpected. It SHALL
log the raw process output for support, SHALL NOT return it to the caller, and
SHALL NOT decide what the author is told.

Classification SHALL use the process's exit status and a short list of stable
phrases, and every process SHALL run with its output language forced to
English so that a translated message cannot defeat the match.

#### Scenario: Git is not installed
- **WHEN** an operation fails because the `git` program cannot be found
- **THEN** the caller receives the git-missing classification

#### Scenario: The key is not accepted
- **WHEN** an operation fails with `Permission denied (publickey)`
- **THEN** the caller receives the key-rejected classification

#### Scenario: The key needs a password
- **WHEN** the key in use requires a passphrase, which is detected before the network is touched by asking ssh-keygen to derive the public key with an empty passphrase and being told it is incorrect (ssh itself, with prompting disabled, reports only that the key was refused)
- **THEN** the caller receives the key-protected classification, not a hang and not the key-rejected classification

#### Scenario: The server's identity changed
- **WHEN** an operation fails with `REMOTE HOST IDENTIFICATION HAS CHANGED` or `Host key verification failed`
- **THEN** the caller receives the host-identity-changed classification

#### Scenario: The server cannot be reached
- **WHEN** an operation fails because the host does not resolve, the connection is refused, or it times out
- **THEN** the caller receives the server-unreachable classification

#### Scenario: A push is refused by the server's access rules
- **WHEN** a push fails because the server's rules forbid the account from writing to the project or the reference
- **THEN** the caller receives the not-allowed classification

#### Scenario: Anything else
- **WHEN** an operation fails for any other reason
- **THEN** the caller receives the unexpected classification, and no raw process text is returned

### Requirement: Binary file content can be committed
A commit built by this capability SHALL carry every file's bytes exactly as
they are in the vault, with no line-ending conversion and no filter applied,
so that a file which is not text arrives intact and a text file is
byte-identical on the remote.

#### Scenario: Committing an image
- **WHEN** a commit includes an image file
- **THEN** the file on the remote afterwards is byte-identical to the vault's

#### Scenario: A note with Windows line endings
- **WHEN** a commit includes a note whose lines end in carriage return and line feed
- **THEN** the committed bytes keep those line endings, whatever `core.autocrlf` is set to

### Requirement: Processes are run without a shell, hermetically, and bounded
Every process this capability runs SHALL be started without a shell, with its
arguments passed as an array, with `--` before any path, and with a fixed
environment: English output, terminal prompts disabled, a key-selecting ssh
command that uses only the chosen key, never prompts, and has a connect
timeout, and the plugin's own `-c` overrides (no colour, no path quoting,
long paths enabled, no filesystem monitor, no hooks). The ssh command SHALL also
forbid agent, port and display forwarding, whatever the author's own ssh
settings say, and no ssh agent SHALL be handed to the process. Only the ssh
protocol SHALL be allowed, so an address such as `ext::…` cannot start a helper.
Every process SHALL have a timeout, SHALL be killed together with every process
it started when the timeout expires or when the plugin is closed, and SHALL have
its captured output bounded.

Programs SHALL be located on the search path and started by their full path,
never by name, and only folders that name one place SHALL be searched: an empty
or relative entry means the working folder, which is the vault, and a program in
the vault SHALL NOT stand in for git, ssh or ssh-keygen. When git is not on the
search path the folders the installers use SHALL be tried, so an author who
installs git while Obsidian is running is found without a restart. The process
that ends a process tree on Windows SHALL be started by its system path.

Hooks SHALL never run. On POSIX the hooks path SHALL be `/dev/null`; on Windows
it SHALL be a folder outside the vault that is never created, and the runner
SHALL refuse to run if anything has been put in it.

The runner SHALL accept only an allowlist of git subcommands and SHALL refuse
every other at run time, in particular any command that writes working-tree
files (`checkout`, `switch`, `merge`, `pull`, `rebase`, `restore`, `stash`,
`reset --hard`, `reset --merge`). `reset` SHALL be accepted only as `--mixed`.
Each allowed subcommand SHALL have its own list of the options it may be given,
written out in full, and any other option SHALL be refused: an abbreviated long
option (`--har`), a glued short option (`-mu`) and an option that writes a file
(`diff --output`) or runs a program (`diff --ext-diff`, `cat-file --textconv`,
`commit-tree -S`, `fetch --upload-pack`) are all refused for that reason.
`hash-object` SHALL carry `--no-filters` and `diff` SHALL carry `--no-ext-diff`
and `--no-textconv`. Words after a bare `--` are paths and SHALL NOT be read as
options or as addresses.

A command that reaches a server (`fetch`, `ls-remote`, `push`) SHALL name the
address it reaches, SHALL carry that address among its own arguments, and SHALL
be refused before a key has been chosen. Before it starts, the runner SHALL
check that no git setting rewrites that address (`url.<base>.insteadOf` or
`pushInsteadOf`, from any file git reads, an empty prefix included); one that
does SHALL stop the command with the address-rewritten classification and start
nothing. Settings for other addresses SHALL be left alone.

The ssh command SHALL be built by one function that is correct for paths
containing spaces, non-ASCII characters, backslashes and quotes.

#### Scenario: A user's git settings cannot alter what the plugin parses
- **WHEN** the author's machine-wide git settings turn colour output on or set an editor
- **THEN** every operation behaves as if they were off, because the plugin forces its own values per command

#### Scenario: A key path with a space
- **WHEN** the key lives under a folder whose name contains a space or a non-ASCII character
- **THEN** the ssh command still selects that key and the operation succeeds

#### Scenario: A program in the vault
- **WHEN** the vault holds a file named `git` or `git.exe` and the search path contains `.` or an empty entry
- **THEN** that file is never started, and git is found only where it is installed

#### Scenario: Git installed while Obsidian is running
- **WHEN** the author installs git after Obsidian started, so Obsidian's own search path does not name it
- **THEN** "Check again" finds it in the folder the installer used, without a restart

#### Scenario: An option written short
- **WHEN** a command is given `--har` for a reset, `-mu` for read-tree, or `--output=<a note>` for a diff
- **THEN** it is refused and no process is started

#### Scenario: A repository's own hook
- **WHEN** the repository carries a hook that a command would normally run
- **THEN** the command runs and the hook does not

#### Scenario: A setting that sends the address elsewhere
- **WHEN** the repository or the author's settings say that the project's address is to be replaced by another
- **THEN** the command is stopped with the address-rewritten classification and no connection is made

#### Scenario: The plugin is closed during a transfer
- **WHEN** the plugin is disabled while git and ssh are running
- **THEN** both are ended

#### Scenario: A process that hangs
- **WHEN** a process produces no result before its timeout
- **THEN** it is killed, the caller receives the timed-out classification, and no later action is blocked by it

#### Scenario: A process that started another process
- **WHEN** git has started ssh and the timeout expires
- **THEN** ssh is killed too, so no output pipe stays open and the caller still receives the timed-out classification

#### Scenario: A working-tree command is requested
- **WHEN** a caller asks the runner to run `checkout`, `merge` or `reset --hard`
- **THEN** the runner refuses it without starting a process

#### Scenario: A protocol that runs a helper
- **WHEN** an address begins with `ext::`
- **THEN** no process is started for it

#### Scenario: A hostile file name
- **WHEN** a path begins with a hyphen or contains shell metacharacters
- **THEN** it is passed after `--` as a single argument and is never interpreted by a shell

### Requirement: The remote can be fetched, and the fetched copy is what the plugin reads
This capability SHALL provide a fetch that updates every remote-tracking
branch and removes the ones the remote no longer has. Every read of refs and
trees described in this capability SHALL be answered from that fetched copy.
A fetch that does not complete SHALL leave the previous fetched copy
unchanged and SHALL return a classified failure.

#### Scenario: A fetch succeeds
- **WHEN** the fetch completes
- **THEN** the default branch and every document branch are available to read, and branches deleted on the remote are gone

#### Scenario: A fetch fails
- **WHEN** the fetch fails because the server cannot be reached
- **THEN** the caller receives the server-unreachable classification, and reads continue to answer from the previous fetched copy

### Requirement: A ref's files can be listed as path and content identifier
This capability SHALL provide a way to list every file at a fetched ref, at a
commit the plugin recorded (a document's last-sent commit), or at the vault's
last synced version, as a path paired with its blob identifier. The listing SHALL be complete or fail: it SHALL NOT be truncated,
and an unreadable ref SHALL return a failure, not an empty listing that would
read as "the project has no files".

The plugin SHALL be able to compute the same blob identifier for a vault file's
bytes without starting a process, so that a vault file can be compared with a
listing for free.

#### Scenario: Listing the default branch
- **WHEN** the listing is requested for the fetched default branch
- **THEN** every file is returned with its blob identifier

#### Scenario: Listing the last synced version
- **WHEN** the listing is requested for the last synced version
- **THEN** every file the vault last synced is returned with its blob identifier, including a vault whose HEAD has since moved

#### Scenario: A vault file's identifier needs no process
- **WHEN** a vault file's bytes are compared with a listing
- **THEN** its identifier is computed in the plugin, matches git's identifier for the same bytes, and no process is started

#### Scenario: The listing cannot be read
- **WHEN** the ref cannot be read
- **THEN** the caller receives a failure and not an empty listing

### Requirement: The files a document branch changed can be read
This capability SHALL provide a way to read every file a fetched document branch
changed relative to its merge base with the default branch, each with its blob
identifier on the branch and the default branch's blob identifier (or none), and
to read which of them is the DOCUMENT itself, distinguishing it from the images
the branch also carries. It SHALL report "could not be determined" as a
successful answer distinct from a failed read, rather than guessing among
several.

The document is the single markdown file the branch changed. Zero markdown
files, or more than one, SHALL report "could not be determined". Files that are
not markdown SHALL NOT prevent it, so a document sent together with the images it
embeds still resolves to its own path. The list of changed files, not the
document alone, is what tells a caller whether a review is still open: a branch
whose changed files all equal the default branch's has been merged, however it
was merged.

#### Scenario: A branch carrying only the document
- **WHEN** the read is performed for a branch that changed one markdown file
- **THEN** that file's path is returned, with its blob identifier on the branch and on the default branch

#### Scenario: A branch carrying the document and its images
- **WHEN** the read is performed for a branch that changed one markdown file and three image files
- **THEN** all four changed files are listed and the markdown file is named as the document

#### Scenario: A branch carrying several markdown files
- **WHEN** the read is performed for a branch that changed more than one markdown file
- **THEN** "could not be determined" is returned rather than one of them being guessed

#### Scenario: A branch left behind after a squash merge
- **WHEN** the branch's commits are not ancestors of the default branch but every file it changed is identical on the default branch
- **THEN** every changed file reports the same blob identifier on both, so a caller can tell the work is already merged

#### Scenario: A branch ahead of the default branch by one image only
- **WHEN** the branch changed only an image and the image differs from the default branch's
- **THEN** the image is listed as different, and there is no document path

### Requirement: A commit can be built for a set of files without touching the vault
This capability SHALL provide a way to build a commit from a parent commit
plus a set of files (path and bytes) without modifying the vault's working
tree, the vault's index, or HEAD. It SHALL start from the parent's tree and
only add or replace the given files; it SHALL NOT delete any file. It SHALL
write the author and committer from the identity it is given, not from
repository settings, and SHALL return the new commit's identifier.

#### Scenario: Building a commit for a note and its images
- **WHEN** a commit is built on the fetched default branch for one note and two images
- **THEN** the new commit's tree equals the parent's plus those three files, and the vault's files, index and HEAD are unchanged

#### Scenario: A file already in the parent
- **WHEN** one of the given files exists in the parent with different bytes
- **THEN** the new commit holds the new bytes for that path and every other path unchanged

#### Scenario: A file already in the parent with identical bytes
- **WHEN** one of the given files is byte-identical to the parent's
- **THEN** the commit still builds, and that path is unchanged in it

#### Scenario: No identity is set in the repository
- **WHEN** the vault's own settings hold no name or email and an identity is supplied
- **THEN** the commit is built with the supplied identity and does not fail

### Requirement: A commit can be pushed to a document branch, asking for a review request
This capability SHALL provide a way to push a commit to a document branch
(`doc/<doc_id>`) on the remote, asking the server to open a review request
from it into the default branch, with a title and with the source branch
removed on merge. The push SHALL replace the branch only if it still holds
what the caller last saw (or is absent when the caller saw none), so that a
branch someone else moved is never overwritten. It SHALL refuse, without
running anything, a push whose target is not a document branch whose
identifier is valid as a branch-name part, so the default branch can never be
pushed to by this plugin and an identity read from a note cannot build an
unsafe ref. It SHALL push to the project address the caller verified rather than
to the name `origin`, so that a `pushurl` or rewrite rule in an adopted
repository cannot redirect it, and SHALL skip client-side hooks.

The result SHALL say whether the server reported that a review request was
created or only offered a link to create one, so that a push that succeeded
without a review request is reported as partial success and not as failure.
The title SHALL be single-line and no longer than 200 characters.

#### Scenario: A first push
- **WHEN** a commit is pushed to a document branch that does not exist on the remote, with the title "Printer setup"
- **THEN** the branch exists afterwards with that commit, and the caller is told whether a review request was created

#### Scenario: A revision on top of a reviewer's commit
- **WHEN** a commit built on the fetched tip of an existing document branch is pushed
- **THEN** the branch advances and the reviewer's earlier commits are still on it

#### Scenario: The branch moved since it was fetched
- **WHEN** the remote's document branch no longer holds what the caller last saw
- **THEN** nothing is overwritten and the caller receives the changed-meanwhile classification

#### Scenario: An abandoned branch is replaced
- **WHEN** a commit built from the default branch is pushed over a document branch whose tip is exactly what the caller last saw
- **THEN** the branch is replaced in one step, with no separate delete

#### Scenario: The push succeeds but no review request is created
- **WHEN** the server accepts the push but only prints a link to create a review request
- **THEN** the caller is told the push succeeded and is given that link

#### Scenario: The server does not support push options
- **WHEN** the server refuses push options and the push therefore sends nothing
- **THEN** the push is retried once without the options, the caller is told it succeeded without a review request, and the same commit is never sent twice

#### Scenario: A push aimed at the default branch
- **WHEN** a caller asks to push to the default branch or to any ref that is not a document branch
- **THEN** it is refused before any process runs

#### Scenario: An identity that is not valid in a branch name
- **WHEN** the document identifier contains a space, `..`, `~`, `^`, `:`, `?`, `*`, `[`, `\`, a leading dot, or ends in `.lock`
- **THEN** the push is refused before any process runs

#### Scenario: A repository that redirects pushes
- **WHEN** the adopted repository's `origin` has a different push address configured
- **THEN** the push still goes to the verified project address

#### Scenario: A title with a line break
- **WHEN** the title contains a line break
- **THEN** the line break is removed before it is sent

#### Scenario: The server's rules forbid the push
- **WHEN** the account is not allowed to write to the project
- **THEN** the caller receives the not-allowed classification and nothing on the remote changed

#### Scenario: The fetched copy records the new tip
- **WHEN** a push succeeds
- **THEN** the fetched copy holds the pushed commit as that document branch's tip without another fetch, and after a failed push the fetched copy is unchanged

### Requirement: Whether a document branch holds commits this vault did not build can be read
This capability SHALL provide a way to read whether the tip of a fetched
document branch is reachable from the commit this vault last recorded as sent
for that document, and a way to read whether any commit on the branch that is not
on the default branch, that is not reachable from that recorded commit, and that
changes a given path exists. "This vault built it" is decided by reachability
from the recorded commit and never by an email address, which changes with the
author's identity and machine. Each answer SHALL be three-way: yes, no, or the
read did not succeed, and a failed read SHALL NOT be reported as "no". When the
vault has recorded nothing for the document, every commit on the branch SHALL
count as not built here.

#### Scenario: A branch whose tip this vault built
- **WHEN** the branch tip is reachable from the recorded commit
- **THEN** the answer says the tip was built here

#### Scenario: A commit added on the branch by someone else
- **WHEN** the branch holds a commit that changes the path and is not reachable from the recorded commit
- **THEN** the answer is yes

#### Scenario: The author changed their email
- **WHEN** every commit on the branch was built by this vault under an earlier email
- **THEN** the answer is no, because reachability decides and the email does not

#### Scenario: A commit that does not touch the path
- **WHEN** the only commit not built here changes a different path
- **THEN** the answer is no

#### Scenario: Nothing recorded
- **WHEN** the vault has no recorded commit for the document
- **THEN** every commit on the branch counts as not built here

#### Scenario: The read fails
- **WHEN** the fetched copy cannot be read
- **THEN** the caller receives a failure, not "no"

### Requirement: The vault's repository can be inspected, initialised and linked without touching files
This capability SHALL provide a way to report whether `git` can be run, whether
the vault holds a repository, whether that repository's top level is the vault's
own folder, that repository's `origin`, its current branch, whether its HEAD is
unborn, equal to, or an ancestor of a given fetched commit, and its object
format; and a way to initialise a repository in the vault (with HEAD set to the
default branch's name), set its `origin` to the project address, and add
`.obsidian/` and `.trash/` to the repository's local ignore file, without
creating, changing or deleting any file in the vault's working tree and without
writing a committed ignore file. It SHALL refuse to initialise over an existing
repository.

#### Scenario: Reporting a vault that is not a repository
- **WHEN** the vault holds no repository
- **THEN** the report says so, and git being runnable is reported separately

#### Scenario: Initialising
- **WHEN** a repository is initialised in a vault holding notes
- **THEN** the repository exists with the given origin, `.obsidian/` and `.trash/` are in its local ignore file, and no vault file changed

#### Scenario: A vault inside another repository
- **WHEN** the vault's folder is a subfolder of a repository
- **THEN** the report says the repository's top level is not the vault's own folder

#### Scenario: Unsent local commits
- **WHEN** the repository's HEAD is not the fetched commit and not an ancestor of it
- **THEN** the report says so

#### Scenario: A repository already exists
- **WHEN** initialising is asked for a vault that already holds a repository
- **THEN** it is refused and nothing changes

### Requirement: The last synced version can be advanced to the fetched version without touching files
This capability SHALL provide a way to record a new last synced version for the
vault, given a fetched commit and an optional list of paths to be held back. The
recorded version SHALL equal the fetched commit's tree, except that each held-back
path keeps the entry it had in the previous synced version (or stays absent), so
a path the caller could not apply is seen again by the next update. It SHALL
provide a separate way to move the vault's HEAD and index to the fetched tip
without changing any file in the working tree, as a fast-forward only. These
SHALL be the only ways the plugin moves HEAD or the synced version after
connecting.

#### Scenario: Advancing after a complete update
- **WHEN** the synced version is advanced to the fetched commit with nothing held back
- **THEN** it equals the fetched commit's tree, HEAD and the index point at the fetched tip, and every file in the working tree is exactly as it was

#### Scenario: A held-back path
- **WHEN** the synced version is advanced with one path held back
- **THEN** that path still has its previous entry in the synced version and differs from the fetched tree, and every other path equals the fetched tree

#### Scenario: HEAD would not fast-forward
- **WHEN** the vault's HEAD is not an ancestor of the fetched tip
- **THEN** HEAD and the index are not moved, and the caller is told

### Requirement: Local bookkeeping refs can be read and written, and are never pushed
This capability SHALL provide a way to read and write three kinds of local-only
ref under `refs/docs-publisher/`: `synced` (the last synced version), `connected`
(the commit connecting recorded) and `sent/<doc_id>` (the last commit this vault
built for a document). It SHALL never push them and never create them on the
remote. A missing ref SHALL be reported as missing, not as an error, and SHALL
NOT stop any caller from continuing in the degraded way that caller specifies.

#### Scenario: Recording a sent commit
- **WHEN** a commit is built for a document
- **THEN** `sent/<doc_id>` points at it before any push is attempted

#### Scenario: A ref that was never written
- **WHEN** a caller reads `sent/<doc_id>` for a document this vault never built a commit for
- **THEN** the answer is "missing" and no error is raised

#### Scenario: The bookkeeping is not pushed
- **WHEN** a document branch is pushed
- **THEN** no ref under `refs/docs-publisher/` exists on the remote

### Requirement: Two edited versions of a text can be merged against their common base
This capability SHALL provide a way to merge two texts against their common base
and report one of two outcomes: a merged text, or that the edits overlap. It
SHALL NOT write conflict markers into any vault file, SHALL work on copies
outside the vault, and SHALL report a binary file as one it will not merge.

#### Scenario: Edits in different places
- **WHEN** the two texts changed different paragraphs of the base
- **THEN** the merged text contains both changes

#### Scenario: Edits in the same place
- **WHEN** the two texts changed the same sentence
- **THEN** the answer is that the edits overlap, and no merged text is returned

#### Scenario: A binary file
- **WHEN** a merge is asked for an image
- **THEN** the answer is that it will not be merged

### Requirement: Access can be tested, reporting who the key belongs to
This capability SHALL provide a way to test the key and project address
together: it SHALL list the project's HEAD over ssh to prove the key works and
the project is reachable, and it SHALL read the remote's default branch name from
that answer. It SHALL then ask ssh for the account's username using the server's
greeting. A test whose key and project pass but whose greeting cannot be read
SHALL succeed without a username, so that the caller can ask for one.

#### Scenario: A key GitLab accepts, for a project the account can read
- **WHEN** the test is performed with a registered key and a reachable project
- **THEN** it succeeds and returns the default branch name and the username

#### Scenario: A key GitLab has not been given
- **WHEN** the test is performed with a key that is not registered
- **THEN** the caller receives the key-rejected classification

#### Scenario: The key works but the project is not visible
- **WHEN** the key is accepted and the project path does not exist or the account cannot read it
- **THEN** the caller receives the project-not-found classification

#### Scenario: The project has no commits
- **WHEN** the project's HEAD listing comes back empty because the project has nothing in it
- **THEN** the caller receives the empty-project classification

#### Scenario: The greeting cannot be read
- **WHEN** the key and project pass but the server's greeting is not in the expected form
- **THEN** the test succeeds with no username

### Requirement: An SSH key can be created, and an existing one is never overwritten
This capability SHALL provide a way to create an ed25519 key pair with no
passphrase at a path it is given, creating the folder if it is missing. It SHALL
refuse, writing nothing, when anything — a file, a folder, a link, even a link
to nothing — already exists at that path or at its `.pub` companion. The pair
SHALL be made in a folder of its own and put in place without replacing
anything, so that what appears at those names while the key is being made is
never written through or replaced, and when the second half cannot be placed the
first SHALL be removed again. It SHALL read only the public file, SHALL return
its text so it can be copied, and SHALL NOT read, copy or log the private key.

#### Scenario: Creating a key
- **WHEN** a key is created at a path where no file exists
- **THEN** both files exist afterwards and the public key's text is returned

#### Scenario: A key already exists at that path
- **WHEN** a key is created at a path where a file already exists
- **THEN** nothing is written and the existing file is untouched

#### Scenario: A link at that path
- **WHEN** the key's name is a link, including a link to a file that does not exist
- **THEN** nothing is written through it and nothing is written at all

#### Scenario: A file appears while the key is being made
- **WHEN** a file appears at the key's name after the check and before the key is put in place
- **THEN** that file is left as it is, no half of the new key is left behind, and the author is told a file is in the way

#### Scenario: Existing keys are found
- **WHEN** the author's key folder holds `id_ed25519` or `id_rsa`
- **THEN** they are reported as existing keys, with their public text, and nothing is read from the private files

### Requirement: Git settings can be read with their scope and written to the vault only
This capability SHALL provide a way to read a git setting's effective value
together with the scope it came from (this vault, this computer, or the
system), and a way to write or remove a setting at this vault's own scope. It
SHALL NOT write to the machine-wide or system configuration. The values the
plugin forces per operation SHALL NOT be written to any configuration.

#### Scenario: A name set only machine-wide
- **WHEN** the author's name is set only in their machine-wide configuration
- **THEN** reading it returns that value labelled as coming from this computer

#### Scenario: Saving a name
- **WHEN** a name is saved
- **THEN** it is written to this vault's own configuration and the machine-wide configuration is unchanged

#### Scenario: Removing a vault setting
- **WHEN** a vault-scoped setting is removed
- **THEN** reading it afterwards returns whatever the machine-wide or system value is, or nothing

### Requirement: The remote's default branch name is read, never assumed
This capability SHALL read the name of the remote's default branch from the
remote itself and return it to callers that need it. It SHALL NOT assume the
name `main`.

#### Scenario: A project whose default branch is master
- **WHEN** the default branch is read for a project whose default is `master`
- **THEN** `master` is returned

### Requirement: The remote's web addresses are derived from the project address
This capability SHALL derive, from the project address alone and without any
request, the web address of the project's review list filtered to one document
branch, the web address of a file on the default branch, and the web address of
the author's SSH keys page. It SHALL accept the SSH forms `git@host:path`,
`ssh://git@host[:port]/path` and the HTTPS form `https://host/path`, with or
without a trailing `.git`, converting HTTPS to the SSH form on port 22. It SHALL
reject a numeric project identifier, any address with no project path, a host
that is not made only of letters, digits, dots and hyphens or that begins with a
hyphen, a user other than `git`, a path containing `..`, a control character or a
leading hyphen, and any address using a scheme other than ssh or https. The same
validation SHALL apply to an address read back from the plugin's saved settings,
because the address later reaches a process; an invalid saved address SHALL be
treated as not set.

#### Scenario: An SSH address
- **WHEN** the address `git@gitlab.example.com:docs/kb.git` is given
- **THEN** the SSH form is unchanged and the web base is `https://gitlab.example.com`

#### Scenario: An HTTPS address
- **WHEN** the address `https://gitlab.example.com/docs/kb` is given
- **THEN** it is converted to `git@gitlab.example.com:docs/kb.git`

#### Scenario: A numeric project identifier
- **WHEN** the address is `1234`
- **THEN** it is rejected as an invalid address

#### Scenario: An address that would be read as an option
- **WHEN** the address is `git@-oProxyCommand=x:docs/kb.git` or `ext::sh -c x`
- **THEN** it is rejected as an invalid address and no process is started for it

#### Scenario: A damaged saved address
- **WHEN** the saved settings hold an address that fails this validation
- **THEN** it is treated as not set
