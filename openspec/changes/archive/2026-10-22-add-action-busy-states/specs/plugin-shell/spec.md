## ADDED Requirements

### Requirement: The panel's write actions show when they are working and run one at a time
The plugin SHALL run at most one of its four write actions — Submit (the
sequence started by confirming the submit dialog, under any of its labels),
Reset, Restore, and "Import all" — at a time.

While one is running, the sidebar view SHALL show the control that started it
with a busy label and SHALL NOT let it be pressed:

- Submit: "Sending…", from the moment the author confirms the submit dialog
  until the submission's outcome is reported. Opening the dialog alone does
  not start it.
- Reset: "Checking…", from the press until the author has answered the
  confirmation, or the reset has been refused before one was shown.
- Restore: "Restoring…", on the row that was pressed only.
- "Import all": "Importing…", until the batch's outcome is reported.

The busy label SHALL appear only on the control for the document the running
action is acting on. Every other write control SHALL stay visible with its
normal label and SHALL NOT be pressable until the action ends.

An attempt to start any of the four while one is running — including from the
command palette — SHALL start nothing and SHALL show the notice "Still
finishing your last action. Try again in a moment."

The action SHALL count as ended however it ends: success, a refusal, a failure
notice, the author dismissing a dialog, or an unexpected error. The controls
SHALL then return to their normal labels and be pressable again. Which action
is running SHALL be held in memory only.

#### Scenario: Reset shows it is working before its confirmation appears
- **WHEN** the author presses Reset on the open note
- **THEN** the control reads "Checking…" and cannot be pressed until the confirmation appears

#### Scenario: Cancelling the Reset confirmation restores the control
- **WHEN** the author dismisses the Reset confirmation without confirming
- **THEN** nothing is written and the control reads "Reset" and can be pressed again

#### Scenario: A double press on Reset asks once
- **WHEN** the author presses Reset twice in quick succession
- **THEN** exactly one confirmation is shown

#### Scenario: Submit shows it is working after the dialog is confirmed
- **WHEN** the author confirms the submit dialog
- **THEN** the panel's submit control reads "Sending…" and cannot be pressed until the submission's outcome notice appears

#### Scenario: Restore shows it is working on its own row
- **WHEN** the author presses Restore on one row of "Documents you can restore"
- **THEN** that row's control reads "Restoring…", and every other row's Restore control keeps its label and cannot be pressed until the restore ends

#### Scenario: Import all shows it is working
- **WHEN** the author presses "Import all"
- **THEN** the control reads "Importing…" and cannot be pressed until the batch's outcome notice appears, and each listed document is imported at most once

#### Scenario: Other write controls wait while one action runs
- **WHEN** any of the four write actions is running
- **THEN** every other write control in the panel keeps its normal label and cannot be pressed

#### Scenario: The busy label stays with its document
- **WHEN** a submission of one note is running and the author opens a different note
- **THEN** that note's submit control keeps its normal label and cannot be pressed, and no control claims to be sending it

#### Scenario: Starting a second action is refused with a message
- **WHEN** the author runs "Submit for review" from the command palette while any of the four write actions is running
- **THEN** no dialog opens, nothing is sent, and the notice "Still finishing your last action. Try again in a moment." is shown

#### Scenario: A failed action releases the controls
- **WHEN** a running write action ends with a failure notice or an unexpected error
- **THEN** every write control returns to its normal label and can be pressed again

#### Scenario: Busy state does not survive a reload
- **WHEN** the plugin is reloaded
- **THEN** no write control starts out busy or unpressable
