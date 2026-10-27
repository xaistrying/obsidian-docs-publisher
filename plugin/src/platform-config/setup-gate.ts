import { Notice } from 'obsidian';
import { AUTHOR_MESSAGES } from '../author-messages';
import type { SetupProgress, SetupStateHolder } from './setup-state';

/**
 * Which steps an action stands on. Creating a document, sending one, resetting
 * one and getting updates need every step. Connecting the vault is step 4
 * itself, so it needs only the three before it: asking it to wait for itself
 * would be a gate that can never open.
 */
export type SetupNeed = 'all' | 'connecting';

export type SetupGateResult = { ok: true } | { ok: false; message: string };

const STEPS_BEFORE_CONNECTING = 3;

/**
 * Pure, so every state an action can meet is a table row in the tests. Before
 * the first read of setup (`checked` false) the answer is "wait", not "not
 * ready": the facts are the empty set, which would tell an author whose setup
 * is complete to go and finish it.
 */
export function setupGate(progress: SetupProgress, need: SetupNeed, checked = true): SetupGateResult {
	if (!checked) {
		return { ok: false, message: AUTHOR_MESSAGES.stillChecking };
	}
	const required = need === 'all' ? progress.complete : progress.complete.slice(0, STEPS_BEFORE_CONNECTING);
	return required.every((done) => done) ? { ok: true } : { ok: false, message: AUTHOR_MESSAGES.notReady };
}

/**
 * The gate every action goes through, wherever it was started — the panel, or
 * the command palette, which has no control to hide. It does nothing when it
 * refuses and says what to do instead, so a hotkey bound to an action never
 * silently fails.
 *
 * Checked first, ahead of whatever the action checks for itself: an action
 * that is going to fail for a setup reason should say that one, not a more
 * specific complaint about something that setup would have fixed.
 */
export function requireSetup(holder: Pick<SetupStateHolder, 'current'>, need: SetupNeed): boolean {
	const gate = setupGate(holder.current.progress, need, holder.current.checked);
	if (!gate.ok) {
		new Notice(gate.message);
		return false;
	}
	return true;
}
