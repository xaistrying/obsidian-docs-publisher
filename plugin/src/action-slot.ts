import { Notice } from 'obsidian';
import { AUTHOR_MESSAGES } from './author-messages';

/**
 * The actions that write, or that wait on something that does: to the remote,
 * to the vault, or to both. Refresh is not one of them — it has its own busy
 * state, but it does yield to these (replace-rest-with-local-git-ssh,
 * plugin-shell "The panel's write actions show when they are working and run
 * one at a time"): a fetch must not start under an update that is comparing
 * against the version it is about to replace.
 *
 * `restore` and `import` are the REST-era actions and go with their code (task
 * 5.1); the other four are the actions this change adds or renames.
 */
export type WriteAction =
	| 'submit'
	| 'reset'
	| 'restore'
	| 'import'
	| 'update'
	| 'connect'
	| 'test'
	| 'createKey';

/**
 * Which write is running, and on what: the note's path for submit and reset,
 * the `doc_id` for restore (there is no note), and empty for import, which
 * acts on the whole list.
 */
export type RunningAction = { action: WriteAction; target: string };

/**
 * Vocabulary-checked: no "branch", "commit", "merge request", "MR",
 * "conflict", or "main". It names no action, because the refused press may
 * not be the one still running and the author does not need to know which.
 */
export const BUSY_MESSAGE = AUTHOR_MESSAGES.stillBusy;

type Listener = () => void;

/**
 * Holds the one write action in progress, for the running session only
 * (add-action-busy-states, 2026-09-30). Before this, each action fired its
 * body and returned at once with nothing recording that it was still going,
 * so a second press — most plausibly on Reset, which waits ~3 s before its
 * confirmation (`docs/ce-verification.md` §D0c) — started a second run.
 *
 * Every entry point goes through `run`, panel and command palette alike, so
 * the guard lives in one place and the release cannot be missed on one path:
 * disabling buttons alone would not do, since a press can land before the
 * panel redraws and the palette has no button to disable (design.md
 * decision 1).
 *
 * Never persisted. A reload mid-action starts with every control free, which
 * is correct: the action's promise does not survive a reload either.
 */
class ActionSlot {
	// ponytail: ONE slot for all four actions, not one per document. A long
	// "Import all" blocks Submit, Reset and Restore for its whole run.
	// Acceptable for a four-person team; per-document slots are the upgrade if
	// it ever is not (design.md decision 1).
	private running: RunningAction | null = null;
	private readonly listeners = new Set<Listener>();

	get current(): RunningAction | null {
		return this.running;
	}

	/**
	 * Runs `work` if nothing else is, and refuses with `BUSY_MESSAGE` if
	 * something is — `work` is then never called. The slot is released in
	 * `finally`, so a refusal, a failure notice, a dismissed dialog or an
	 * unexpected throw all hand the controls back.
	 */
	async run(action: WriteAction, target: string, work: () => Promise<void>): Promise<void> {
		if (this.running !== null) {
			new Notice(BUSY_MESSAGE);
			return;
		}

		this.running = { action, target };
		try {
			// Told inside the `try`: a listener that throws while the slot is being
			// taken must still hand it back, or every control stays busy until the
			// plugin reloads.
			this.notify();
			await work();
		} finally {
			this.set(null);
		}
	}

	/** Subscribes, and returns the function that unsubscribes again. */
	onChange(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	private set(running: RunningAction | null): void {
		this.running = running;
		this.notify();
	}

	private notify(): void {
		// Copy first: a listener may unsubscribe itself while being notified.
		for (const listener of [...this.listeners]) {
			listener();
		}
	}
}

export { ActionSlot };
