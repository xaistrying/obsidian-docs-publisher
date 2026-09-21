## Context

Three things this change has to sit correctly against, all recently
established rather than assumed:

- **`docs/ce-verification.md` §E2** — the real corpus carries `title`,
  `owner` and `last_reviewed` and lacks `doc_id`, `category`, `lifecycle` and
  sometimes `created`. Its filenames are already the control IDs (`BOA-SOP-001_…`,
  `SBT-KE-001_…`). So an imported document needs no repair to be readable, and
  its `doc_id` is derivable by the rule that already exists.
- **`docs/ce-verification.md` §E3** — an imported document has no `doc_id`, so
  a first submit runs `checkTargetPathFree`, which refuses because the file
  exists on the default branch. Every imported document, every time.
- **`add-attachment-sync`'s embed resolver** — `resolveEmbeddedAttachments`
  (`doc-authoring/embeds.ts`) is pure logic over a `VaultEmbedIndex` backed by
  Obsidian's `metadataCache` and `getFirstLinkpathDest`. It resolves embeds for
  a note **in the vault**. A document mid-import is not in the vault, so this
  cannot be pointed at remote content as-is. That change explicitly rejected
  reimplementing Obsidian's shortest-path rule.

## Goals / Non-Goals

**Goals:**

- A document a teammate published is reachable from inside Obsidian.
- An imported document is submittable — the first thing an author does to one
  must not be refused.
- An imported or recovered document renders, images included.
- Discovery never guesses: a truncated listing is reported, not silently
  treated as the whole corpus.

**Non-Goals:**

- Sync, scheduled or otherwise.
- Adopting a document with no front matter at all.
- Any change to how the plugin writes at submit time.
- Milestone 3a's setting, which must never touch an imported document's path.

## Decisions

### 1. Import freezes `doc_id`, and this is a widening of
`document-identity.md` §3 that must be written down as one

§3 says `doc_id` is "THE NOTE'S FILENAME, SNAPSHOTTED AT FIRST SUBMIT", and
that before the snapshot the author renames and moves freely — "that freedom
is the whole ergonomic point of shift-right." Import writes it earlier. That
is a real amendment, not a reading, and pretending otherwise would leave the
next person with two rules and no way to choose.

The amendment: **`doc_id` is frozen at the moment the document's identity
becomes fixed, which is first submit for a document this vault authored and
import for a document it did not.** The shift-right freedom §3 protects does
not exist for an imported document — its name and path are already decided,
on the remote, by whoever published it, and `refuse-to-move` already forbids
changing them. There is no freedom being taken away.

What this buys, verified in code rather than assumed:

- The first submit takes `performResubmit`, not the first-submit path, so
  `checkTargetPathFree` — which is first-submit-only — never runs, and §E3's
  refusal never happens.
- `resolveDocumentState` finds no merge request for `doc/<doc_id>` and resolves
  "no submission at all". That fork calls `clearPreviousAttempt`, cuts fresh
  from the default branch, and **reads the commit verb** rather than assuming
  `create` — `add-attachment-sync` changed exactly that, and the comment there
  names this case: "a document whose record was lost after it was published,
  whose file IS on the default branch and for which `create` is rejected
  outright." An imported document is that case. It works today, unmodified.
- The path-mismatch check reads the remote path from the document's merge
  request; an imported document has none, so the path cannot be established,
  and that check SKIPS on an unestablished path rather than refusing. No false
  refusal.

REJECTED: teaching `checkTargetPathFree` to recognise an imported document. It
would need some local trace to recognise it BY, which is the tracking this
decision adds anyway — so it arrives at the same place having also weakened a
guard that is currently exactly right.

REJECTED: importing without `doc_id` and letting the author hit the refusal.
It is the status quo, and it makes Import produce documents whose first
interaction is a dead end.

### 2. No `SubmissionRecord` is written at import

`doc_id` in front matter is the identity; the store is a cache of what the
remote said (`add-document-status`). An imported document has no submission
for a record to describe — writing one would mean inventing a state the remote
does not hold, which is the wrongness that whole milestone removed.

Reconciliation resolves it from front matter alone on the next refresh, which
is the case `add-document-status` built for and proves in its own D3 check.

### 3. Attachments are fetched AFTER the note lands, through the existing
resolver

The resolver needs Obsidian's cache, and the cache needs the file. So:

```
1. write the note at its remote path
2. let Obsidian index it (metadataCache picks it up)
3. resolve its embeds through resolveEmbeddedAttachments — the SAME function
   submit uses, unchanged
4. fetch each resolved attachment's bytes from the same ref, write it at its
   own remote path
```

TRADE-OFF, stated rather than hidden: between steps 1 and 4 the note exists
with embeds that do not resolve. If the fetch fails, the note remains and its
images do not. That is the right failure: a readable document missing pictures
beats no document, and the author can re-import or fetch again. It must be
reported, not silent.

CORRECTED DURING IMPLEMENTATION, 2026-09-14, and the correction is the
load-bearing part of this decision rather than a detail of it.

Step 3 as written above is impossible. `resolveEmbeddedAttachments` backed by
the VAULT — which is what "the SAME function submit uses" implied, since
`vaultEmbedIndex` was the only adapter that existed — answers ONLY for files
already in the vault: `getFirstLinkpathDest` returns null for a link that
resolves to nothing, and the markdown-link branch ends in `fileAt`, which
requires the file to exist. A freshly imported note's images are by definition
not in the vault, so resolution returns an empty list and there is nothing to
fetch. The mechanism as specified would have shipped a no-op.

WHAT IS ACTUALLY BUILT: the same function, asked of a DIFFERENT INDEX.
`embeds.ts` is pure logic over the `VaultEmbedIndex` interface, which is
exactly the seam this needs — so `fetch-attachments.ts` supplies an
implementation backed by the repository listing instead of the vault, and
`resolveEmbeddedAttachments` itself is untouched. The decision's intent
survives intact; only the assumption that "the existing resolution" meant
"the existing ADAPTER" was wrong.

What that index does with each form:

- A markdown-style embed carries a path, which `embeds.ts` has already joined
  against the note's folder. The listing either holds that path or does not.
  No rule is needed and none is invented.
- A wikilink names a FILE. Exactly one candidate in the listing — a path that
  is the link, or ends with `/` plus the link — is an answer. Zero or several
  is reported as unresolved and skipped.

REJECTED: reimplementing Obsidian's shortest-path rule to pick among several
candidates. `add-attachment-sync` rejected it for the reason that still holds
— a second implementation would disagree with the first at exactly the moment
it mattered — so the ambiguous case DECLINES rather than guesses, and says
which link it could not place. Handing the author the wrong image is worse
than handing them none, because a wrong image looks fetched.

REJECTED: parsing embeds out of the raw remote markdown. Obsidian already
records a note's embeds the moment it parses the note, whether or not they
resolve, so the links are there to read from the cache — which is also why
the note must be written and INDEXED before this runs, and why
`awaitNoteIndexed` exists.

REJECTED: fetching attachments before the note, into a staging area. It
inverts the dependency for no gain — the resolution still needs the note
indexed.

**Recovery uses this same path.** Recover has the same gap today, and giving
the two different mechanisms would mean two chances to get it wrong. This is
the "9a" half of the milestone and it lands in both callers at once.

One difference in what each caller has in hand, worth stating because it
costs a request: Import resolves embeds against the listing DISCOVERY ALREADY
READ, so "import all" pays for one tree read however many documents it
brings. Recovery never lists the repository, so it reads the tree itself at
the ref its content came from — one extra request per recovery, which is a
single-document action anyway. `fetchRecoveryContent` now reports WHICH ref
it found the content on, since a document under review and the default branch
hold different content and its images must come from the same place its text
did.

### 4. Discovery compares paths, and the vault is the authority on "have"

The remote's markdown paths minus the vault's note paths. Path is the one
thing guaranteed comparable under vault-root-is-repo-root
(`docs/document-identity.md` §4), and the comparison is case-sensitive for the
reason §4 already gives.

Built from the VAULT, not from `SubmissionStore` — the same choice
`listVaultDocuments` made and for the same reason: a record is not evidence a
file exists, and the question here is precisely which files do not.

A document the vault has under a DIFFERENT path (someone moved it locally)
therefore appears as discoverable, and importing it would refuse on the
duplicate-`doc_id` check (decision 5) rather than silently creating a second
copy. That is the correct outcome and the check is what makes it so.

### 5. Two refusals at import, both before anything is written

- **Duplicate `doc_id`**: another note in this vault already carries the
  `doc_id` this import would freeze. Refuse, naming the note. This is the
  check `docs/panel-tracking-scope.md` flagged as missing at import — today it
  exists only at submit, which is far too late.
- **Occupied path**: a note already exists at the target path. Refuse, exactly
  as `recoverDocument` does and for the same reason — the path is half the
  identity and placing the content elsewhere would only be refused later by
  refuse-to-move.

### 6. The exclusion rule is "no front matter at all", and nothing cleverer

A markdown file on the remote is offered for import unless it has no YAML
front matter block. §E2 found two such files — `README.md` and
`Global/Tools-&-Access.md` — and they are what the rule is for.

REJECTED: excluding by filename (`README.md`, `_placeholder.md`). It is a
denylist that needs extending forever and would wrongly exclude a real
document someone names badly.

REJECTED: requiring the full seven-field contract. §E2 is the argument: ZERO
of 34 real documents would pass, so the list would be empty on the actual
corpus. The contract is what the plugin writes, not what the corpus owes.

Consequence, accepted: a file with partial front matter that is not really a
document (`_placeholder.md`, which carries only `title`) is offered. Importing
it produces a note the author can delete. That is a smaller harm than hiding
real documents.

### 7. The tree read is bounded and says so

Recursive, paginated, capped, and `truncated` reported to the caller —
identical in shape and reasoning to `listMergeRequests`. A truncated listing
must never be resolved from: a document missing from a partial tree looks
exactly like one that does not exist, and the author would be told the corpus
does not have something it does.

### 8. Discover renders in the existing panel, below the other two lists

`panel-tracking-scope.md` left this open between a new view and a mode of the
existing panel. Decided: the existing panel, as a third section, absent
entirely when empty like the other two.

A separate view would need its own connection-state handling, its own refresh,
and its own empty states — a second surface to keep consistent with the first
for a list that is empty in the common case. Revisit if the corpus is large
enough that browsing needs a tree; §E2 counted 34 documents, which is a list.

## Risks / Trade-offs

**"Add all" on a large corpus is many requests** → One per document, plus one
per attachment. At §E2's 34 documents this is fine. It is bounded by the tree
read's own cap, and the per-document import is the same shape recovery already
uses. If it ever hurts, the fix is batching, not a different design.

**An import that half-completes** → Decision 3's ordering makes the failure
legible: the note exists, its attachments may not. Reported per document, and
re-importing is safe because the occupied-path check refuses rather than
overwrites.

**Freezing `doc_id` at import diverges from §3's letter** → Decision 1 states
the amendment rather than leaving two rules standing. `docs/document-identity.md`
§3 must be updated in the same change, or the next reader meets a
contradiction.

**A document imported, then renamed locally** → `doc_id` is frozen, so it
still resolves; the path-mismatch check refuses the next submit and names the
path to restore. Identical to a renamed authored document. No new behaviour.

## Open Questions

- ~~Whether "add all" should stop at the first refusal or continue and report
  per document.~~ RESOLVED in implementation: continue and report. Each
  outcome is returned rather than announced, and the batch shows one notice
  carrying a line per document that has something to say — a refusal with its
  reason, or a success whose images did not all arrive. Left open (no
  timeout) when there is anything in it, since it is a list to act on.
- ~~Whether an imported document should get `lifecycle`/`created` backfilled
  at import.~~ RESOLVED in implementation: left absent. The plugin adds
  `doc_id` and nothing else, and an imported note keeps every field it
  arrived with byte for byte. Nothing currently reads `lifecycle`, and
  inventing a `created` date for a document someone else wrote years ago
  would be a fact this plugin is not in a position to assert.
