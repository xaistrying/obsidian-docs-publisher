## Context

The panel has four actions that write: Submit, Reset, Restore and "Import all".
Each is one method on the plugin (`submitForReview`, `resetDocument`,
`restoreDocument`, `importAllDocuments` in `main.ts`) that the panel's button
calls, and each fires an async body with `void (async () => …)()` and returns
at once. Nothing records that the body is still running, so the button stays
as it was and a second press starts a second run.

What that costs, per action:

- **Reset** awaits two reads (`fetchResetContent`) before its confirmation
  opens — ~3 s on the target instance (`docs/ce-verification.md` §D0c). A
  second press queues a second fetch and a second confirmation.
- **Submit** opens a modal first (which blocks the panel), then runs the
  remote sequence after the author confirms. That sequence is several round
  trips with the panel pressable again, and the command palette entry can
  start another.
- **Restore** fetches and then creates a note; a second press races the first
  to the create.
- **"Import all"** runs sequentially through a copied list; a second press
  runs the whole batch again over the same copy.

Refresh already solves this for itself: it shows `CHECKING_LABEL` and is
disabled while `isChecking()` is true, re-rendering from a holder's
`onChange`. This change applies the same pattern to the four writes.

## Goals / Non-Goals

**Goals:**
- A pressed write control says it is working and cannot be pressed again.
- No two write actions overlap, from any entry point.
- The controls always come back, whatever the action's outcome.

**Non-Goals:**
- Changing Reset's fetch-then-confirm order (§D0c says not to).
- Coordinating writes with Refresh.
- Anything about which controls are offered in which state (§D0d).

## Decisions

### 1. One slot for all four actions, not a flag per action

A single in-memory holder records the running action, or none:
`{ action: 'submit' | 'reset' | 'restore' | 'import', target: string } | null`,
where `target` is the note's path for submit and reset, the `doc_id` for
restore, and empty for import. It exposes `current`, `onChange`, and one
method, `run(action, target, work)`, which:

- if a slot is taken, shows the busy notice and returns without calling
  `work`;
- otherwise takes the slot, awaits `work()`, and clears the slot in `finally`.

Every entry point goes through `run`, so the guard lives in one place and
the "controls stuck busy after an error" failure cannot happen on one path
and not another.

*Why one slot:* the four actions touch the same things — the vault, the
tracking store, the same note. Reset overwriting a note while a submit of
that note is mid-sequence, or a restore and an import both creating the same
folder, are interleavings a per-action flag would still allow. A four-person
tool gains nothing from running two writes at once.

*Ceiling, stated:* "Import all" over a long list blocks Submit and Reset for
its duration. Acceptable for this team; per-document slots are the upgrade
if it ever is not. The implementation marks this with a `ponytail:` comment.

*Alternative rejected:* disabling buttons only, with no guard in the plugin
methods. A press can land between the slot being taken and the panel
redrawing (the view redraws on a `setTimeout(0)`), and the command palette
has no button to disable.

### 2. Where each action's busy period starts and ends

- **Submit** — starts when the author confirms the submit dialog, ends when
  `performSubmit` settles. `submitForReview` in `submit-document.ts` takes
  the holder and wraps its three `void performSubmit(...)` calls in
  `run('submit', file.path, …)`. It also checks the slot BEFORE opening the
  dialog, so the palette entry refuses up front rather than after the author
  has filled the dialog in. Opening the dialog alone takes no slot: a
  dismissed dialog would otherwise have to release one, and the modal already
  blocks the panel while it is open.
- **Reset** — starts at the press, ends when `restoreDocument` returns, which
  is after the confirmation is answered (or after a refusal notice). The
  whole existing body moves inside `run`; nothing is reordered.
- **Restore** — starts at the press, ends after the note and its images.
- **Import all** — starts at the press, ends after the batch notice.

The authoring gate stays where it is, ahead of `run`: a gated-out press
shows the gate's message and never takes the slot.

### 3. Labels

| Action | Normal label(s) | Busy label |
|---|---|---|
| Submit | Submit for review / Send update / Submit a new version / Submit again | Sending… |
| Reset | Reset | Checking… (the existing `CHECKING_LABEL`) |
| Restore | Restore | Restoring… |
| Import all | Import all | Importing… |

Busy notice: **"Still finishing your last action. Try again in a moment."**

Reset uses "Checking…" rather than "Resetting…" on purpose: during the wait
nothing has been reset and the author has not confirmed anything. Saying
"Resetting…" before the confirmation would read as the overwrite already
happening. The wait is a read from GitLab, which is exactly what "Checking…"
already means on Refresh. §D0c's triage suggested this.

All four strings are vocabulary-checked: no branch, commit, merge request,
MR, conflict, or main.

### 4. The view: busy label on the matching control only, everything else disabled

The view takes the holder like the other holders and subscribes to its
`onChange` through `scheduleRender`. Each write button renders as:

- slot empty → normal label, enabled (today's behaviour);
- slot holds this action for this target → busy label, disabled;
- slot holds anything else → normal label, disabled.

The target check is what keeps "Sending…" off a note that is not being sent
when the author switches notes mid-submit.

This does not conflict with `plugin-shell`'s "never disabled or greyed" rule
for New Document: that rule is about a control shown in a state where it can
never succeed. These are disabled for seconds, and the pressed one says why.

### 5. No persistence

The holder is session memory like `DocumentStatusHolder`. A reload mid-action
starts with every control free. That is correct: the action's promise does
not survive a reload either.

## Risks / Trade-offs

- [A `work` promise that never settles leaves every write control disabled
  until reload] → Every awaited call in the four bodies is a `requestUrl` or
  vault call that settles or throws; nothing waits on an event without a
  timeout except the Reset confirmation and the submit dialog, and both
  resolve on dismiss. The confirmation is the one to watch: it settles on
  close, which Obsidian always fires.
- [Reset shows "Checking…" while its own confirmation is open] → The modal
  covers the panel; nobody reads the label then.
- [Import all blocks the other writes for its whole run] → Accepted, see
  decision 1.
- [Refresh can still run beside a write] → Unchanged from today; deferred.

## Migration Plan

None. Nothing is stored; the change ships with the next build and rolls back
with it.

## Open Questions

None.
