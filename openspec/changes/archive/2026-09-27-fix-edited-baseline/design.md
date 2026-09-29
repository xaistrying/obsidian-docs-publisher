## Context

`hasLocalEdits(file, record)` is `record.mtime !== undefined && file.stat.mtime
> record.mtime`. The comparison is sound; the baseline it compares against is
not maintained.

`mtime` is written at three call sites — `submit-document.ts` twice (first
submit and revision) and `import-document.ts` once — and by nothing else. No
code corrects it, and the one operation that most obviously invalidates it,
Reset, is explicitly documented as not writing a tracking record at all. The
field is owned by nobody, which is the whole defect; the three symptoms in the
proposal are what an unowned baseline looks like from the outside.

Two constraints frame the fix, and both are recorded decisions rather than
preferences:

- **The baseline is an mtime and not a content hash** (`submission-record.ts`).
  `TFile.stat.mtime` is in Obsidian's memory and readable synchronously, and
  the panel re-renders on every note switch and every front-matter edit.
  Hashing would put an async file read per tracked document on every one of
  those. The accepted cost is a false positive on a note touched but not
  changed — harmless for a list whose job is "what might need you".
- **Reset writes no tracking record** (`doc-authoring` spec). That rule exists
  to keep Reset from changing where the review stands: state, branch, path.

The bug lives in the gap between those two. The second rule reads as
forbidding the fix, and the first is why the baseline is fragile in the first
place — an mtime is only as good as the moment it was sampled.

## Goals / Non-Goals

**Goals:**

- A note that has not been changed since the plugin last wrote it never reads
  as edited.
- The baseline has exactly one owner, so a future write path cannot forget it
  the way Reset did.
- A document's state is always visible in the list, whatever markers the row
  also carries.

**Non-Goals:**

- Replacing mtime with a content hash. The recorded reasoning still holds and
  this change does not revisit it.
- The panel's 2026-09-22 narrowing, and the `specs/plugin-shell` drift it left
  behind. Separate work, named in the proposal.
- Correcting baselines already stale in existing `data.json` files. See
  Migration.

## Decisions

### 1. The baseline is read from the adapter, not from `TFile.stat`

Both submit paths already intend the right thing — they read `file.stat.mtime`
*after* the front-matter write, with a comment saying so. `TFile.stat` is
Obsidian's cached stat, and the cache can still hold the pre-write value at
that instant, so the intent does not survive contact with the cache.

Read the baseline from `app.vault.adapter.stat(file.path)`, which goes to the
filesystem and therefore reflects the write.

REJECTED: awaiting a tick and re-reading `file.stat.mtime`. It would usually
work, which is the problem — a timing fix that is usually right produces a bug
that reappears under load and cannot be reproduced on demand.

REJECTED: taking the write's own timestamp (`Date.now()` at write time). It
drifts from the filesystem's clock, and the comparison is against a filesystem
mtime.

**This is async, and that is affordable here.** The synchronous-read argument
in `submission-record.ts` is about the RENDER path, which runs constantly and
is untouched by this: rendering still compares two numbers already in memory.
Writing a baseline happens once per submit, import or reset.

### 2. One owner: a single helper both writes and Reset call

Three call sites today, three chances to forget, and Reset proved the point by
forgetting. Introduce one function that captures a baseline for a file and
stores it, and route every plugin-owned write through it.

That gives the invariant a shape in the code rather than in reviewers'
memories: *the plugin never writes a note's content without recording what it
wrote.* A fourth write path added later gets it by construction, or fails to
compile if the helper is the only thing that can set the field.

### 3. Reset refreshes the baseline, and nothing else

`restoreDocument` updates the baseline and continues to touch no state, no
branch, no path. The `doc-authoring` spec is narrowed to say that — "writes no
tracking record" becomes "changes nothing about where the review stands",
which is what it always meant.

The baseline is not a fact about the review. It is a fact about the note, and
after a reset the note is exactly what the plugin just wrote. Leaving the
field stale is not neutrality; it is a stale assertion that the note differs
from a version it is byte-identical to.

Restore's create path (note absent) takes a baseline for the same reason.

### 4. "Edited" is additive, not a substitute

`renderDocumentRow` currently renders `edited ? EDITED_LABEL :
SUBMISSION_STATE_LABELS[state]`, reasoning that the state "is not the reason
this row is in the list, and the reason is what the author acts on". That is a
fair argument **only while `edited` is rare**, which is the premise this bug
has been violating since the field shipped, so the rule has never actually
been tested against it.

Render the state always, and the edited marker alongside it when it applies.
The author needs both: the state is where the document stands with reviewers,
the marker is that local work has not reached them. Either alone is half the
sentence.

REJECTED: keeping the substitution and relying on the fix to make it rare.
That leaves a surface which, whenever it matters most — a document that is
both under review and locally edited — still refuses to say where it stands.

## Risks / Trade-offs

**The adapter read fails or the path has moved** → Treat it as "no baseline"
rather than guessing one. `hasLocalEdits` already reads an absent baseline as
NOT edited, and that default was chosen for exactly this shape of unknown: it
offers an action the author can ignore rather than hiding one they needed.

**A note edited between the write and the stat read** → The baseline records
the later mtime and that edit reads as already-sent. The window is
sub-millisecond and the loss is one false negative on a document the author is
actively typing into, which the next keystroke corrects.

**Row layout changes with two labels where there was one** → The row is narrow
in a sidebar, and `docs-publisher-document-state` does not wrap (that
constraint is already recorded on the restore section's short marker). The
marker must stay short enough to sit beside a state label at panel width.

**Existing stale baselines persist** → See Migration; accepted rather than
mitigated.

## Migration Plan

No data migration. Records already carrying a stale baseline keep it until
their document's next submit, import or reset, each of which now re-establishes
it correctly.

Correcting them on upgrade was considered and rejected: the only way to know
whether a note matches its remote is to read the remote's content, which is a
request per tracked document — precisely the cost the mtime decision exists to
avoid, paid once for every user to clear a marker that the author's next action
clears anyway.

The visible consequence is that a document currently showing "Edited — not sent
yet" keeps showing it until it is next submitted or reset. After decision 4 it
will at least show its state as well, so the surface is informative in the
meantime rather than blank.

## Open Questions

- Whether `import-document.ts`'s baseline needs the adapter read too, or
  whether a file the plugin has just created reports an accurate `stat`
  synchronously. Routing it through the same helper makes the question moot,
  which is the argument for doing that rather than answering it.
- What the edited marker should read as once it sits beside a state rather
  than replacing it. "Edited — not sent yet" was written to stand alone and is
  long for a second label at sidebar width.
