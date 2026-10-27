## Why

Pressing Reset shows nothing for about three seconds before its confirmation
appears (`docs/ce-verification.md` §D0c), and a second press in that window is
a plausible thing for an author to do on the plugin's only destructive action.
The same is true of every other write the panel offers: Submit, Restore and
"Import all" give no sign they are working and can all be started again while
the first run is still going. Only Refresh says "Checking…" and refuses a
second press.

## What Changes

- While Submit, Reset, Restore or "Import all" is running, the control that
  started it shows a busy label and cannot be pressed again:
  - Submit (whatever it is labelled — "Submit for review", "Send update",
    "Submit a new version", "Submit again") reads **"Sending…"** from the
    moment the author confirms the submit dialog until the outcome notice.
  - Reset reads **"Checking…"** from the press until its confirmation is
    answered — the same word Refresh uses, because the wait is the same kind
    of wait: reading from GitLab.
  - Restore reads **"Restoring…"** on the row that was pressed.
  - "Import all" reads **"Importing…"** until the batch's notice.
- Only one of these four runs at a time. While one runs, the other write
  controls stay visible with their normal labels but cannot be pressed.
- Starting one of the four while another is running — from the command
  palette's "Submit for review", or a press that lands before the panel
  redraws — does nothing except show the notice
  **"Still finishing your last action. Try again in a moment."**
- The controls return to normal when the action ends, however it ends:
  success, a refusal, a failure notice, the author cancelling a dialog, or an
  unexpected error.

## Deferred

- **Reset hidden right after a submit (`docs/ce-verification.md` §D0d).** A
  different behaviour, and it carries an open design choice. Its own change.
- **The recovery button inside a refused first submit's notice**
  (`offerRecovery`). It lives in a notice, not the panel, and does not go
  through the four actions' shared paths. Add it here if it is ever seen being
  pressed twice.
- **New Document** and **Open settings** — local and instant; nothing to wait
  for.
- **Refresh.** It already has its own busy state and guard. Whether a write
  should wait for a refresh in progress, or a refresh for a write, is not
  changed here.
- **Faster Reset.** The fetch-then-confirm order stays exactly as it is
  (§D0c: rearranging it is not the fix). This change only makes the wait
  visible.
- **Spec drift found while scoping this**, for a later catch-up change: the
  restore list's "not checked yet" / "check failed" / "Not available" wording
  in `plugin-shell`, and the per-document Import action in the same spec,
  describe panels that were replaced on purpose.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `plugin-shell`: adds one requirement — the panel's write actions show when
  they are working, run one at a time, and refuse a second start with a named
  message.

## Impact

- `plugin/src/main.ts`: the four action methods on the plugin and the view's
  submit, reset, restore and import-all buttons.
- `plugin/src/doc-authoring/submit-document.ts`: the three places that start
  the submit sequence after the dialog is confirmed.
- One new small in-memory holder for "which action is running", beside the
  existing holders. Nothing persisted, no remote calls, no new dependencies.
