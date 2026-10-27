import { FileSystemAdapter, Notice, Plugin } from 'obsidian';
import type { TFile, WorkspaceLeaf } from 'obsidian';
// Plain specifiers: this project's esbuild does not bundle the `node:` spelling.
import { tmpdir } from 'os';
import { join } from 'path';
import { ActionSlot } from './action-slot';
import { AUTHOR_MESSAGES } from './author-messages';
import { writeVaultSetting } from './git-publishing/git-config';
import { createGitRunner, readGitExecPath, runProcess, stopAllProcesses } from './git-publishing/git-runner';
import { defaultSshDir, locateOnThisMachine } from './git-publishing/keys';
import { parseProjectAddress } from './git-publishing/project-address';
import type { ProjectAddress } from './git-publishing/project-address';
import { sshCommand as buildSshCommand } from './git-publishing/ssh-command';
import { createDocument } from './doc-authoring/create-document';
import { resetDocument } from './doc-authoring/reset-document';
// Aliased: the plugin also has a same-named private method for the two entry
// points to call. Distinct names here keep that call site from reading like
// (and risking becoming) an accidental self-recursion.
import { submitForReview as submitDocumentForReview } from './doc-authoring/submit-document';
import type { SubmitContext } from './doc-authoring/submit-plan';
import { openSettingsTab } from './platform-config/open-settings';
import { pressSetupControl } from './platform-config/setup-actions';
import type { SetupActionTargets } from './platform-config/setup-actions';
import { SetupController } from './platform-config/setup-controller';
import { requireSetup } from './platform-config/setup-gate';
import { SetupSettingTab, advancedPortFor } from './platform-config/settings-tab';
import { SetupStateHolder } from './platform-config/setup-state';
import { DocsPublisherView, VIEW_TYPE } from './plugin-shell/panel-view';
import { listCandidateNotes, listVaultDocuments } from './plugin-shell/vault-documents';
import { DerivedStatesHolder, deriveFromFetchedCopy, refreshStates } from './submission-tracking/derived-states';
import type { RefreshDeps } from './submission-tracking/derived-states';
import { NoteIdentities } from './submission-tracking/note-identities';
import { readDocId } from './submission-tracking/resolve';
import { resolveNotes } from './submission-tracking/resolve-notes';
import type { ResolvedNote } from './submission-tracking/resolve-notes';
import { SettingsStore } from './platform-config/settings-store';
import { connectVault } from './vault-sync/connect';
import { isObsidianGitEnabled, WarnOnce } from './vault-sync/obsidian-git';
import { createRepoFacts } from './vault-sync/repo-facts';
import { getUpdates } from './vault-sync/get-updates';
import { obsidianPrompts } from './vault-sync/modals';
import { obsidianVault } from './vault-sync/obsidian-vault';
import { updateFailureMessage } from './vault-sync/update-report';

class DocsPublisherPlugin extends Plugin {
	// The one writer of `data.json`: the project address, the key's path, the
	// username and what the last test covered. Nothing in it is secret, and
	// nothing in it is a record of a document: git is the database.
	readonly settings = new SettingsStore(this);

	// Which of the four write actions is running, if any
	// (add-action-busy-states, 2026-09-30). Memory only, like the holders
	// above: the action it describes does not survive a reload either.
	readonly writeAction = new ActionSlot();

	// The states derived from git, and the content identifier of each note
	// (replace-rest-with-local-git-ssh task 2.6). Memory only: the fetched copy
	// in `.git` is the persistence.
	readonly derivedStates = new DerivedStatesHolder();
	private noteIdentities!: NoteIdentities;
	private setupController: SetupController | null = null;
	private environment!: { vaultPath: string; hooksDir: string; locate: (name: 'ssh' | 'ssh-keygen') => Promise<string | null> };

	// Whether the author can work yet, as five steps read from local facts
	// (replace-rest-with-local-git-ssh). Memory only: the saved settings are
	// the persistence, and the facts are read from them.
	readonly setupState = new SetupStateHolder();

	private viewActivating = false;

	async onload(): Promise<void> {
		// Whatever the saved settings hold, the plugin starts: nothing in them is
		// irreplaceable, and a damaged file starts from defaults without an error.
		await this.settings.load();

		const setupController = this.createSetupController();
		const setupTargets: SetupActionTargets = {
			controller: setupController,
			openSettings: () => {
				openSettingsTab(this.app, this.manifest.id);
			},
			openUrl: (url) => {
				window.open(url);
			},
		};

		this.setupController = setupController;
		this.noteIdentities = new NoteIdentities(async (path) => new Uint8Array(await this.app.vault.adapter.readBinary(path)));

		// Register the custom view
		this.registerView(
			VIEW_TYPE,
			(leaf: WorkspaceLeaf) =>
				new DocsPublisherView(leaf, {
					setup: this.setupState,
					pressSetup: (id) => {
						pressSetupControl(id, setupTargets);
					},
					refreshSetup: () => {
						void setupController.refresh();
					},
					states: this.derivedStates,
					identities: this.noteIdentities,
					writeAction: this.writeAction,
					address: () => this.savedAddress(),
					refresh: (asked) => {
						this.refreshDocumentStates(asked);
					},
					newDocument: () => {
						this.newDocument();
					},
					submitForReview: () => {
						this.submitForReview();
					},
					submitNote: (file) => {
						this.submitForReview(file);
					},
					getUpdates: () => {
						this.getUpdates();
					},
					resetDocument: (file) => {
						this.resetNote(file);
					},
				})
		);

		// The settings tab shows the same five steps as the panel's first screen,
		// from the same holder, and presses the same controls through the same
		// controller, so the two cannot disagree.
		this.addSettingTab(
			new SetupSettingTab(this.app, this, {
				controller: setupController,
				holder: this.setupState,
				slot: this.writeAction,
				targets: setupTargets,
				advanced: advancedPortFor(() => this.derivedDeps().local()),
			})
		);

		// Setup is read once the workspace is up, and not only when the panel or
		// the settings tab happens to open: the command palette and the settings
		// tab both stand on it, and with the panel closed nothing else would
		// ever read it.
		this.app.workspace.onLayoutReady(() => {
			void setupController.refresh();
		});

		// Add ribbon icon
		this.addRibbonIcon('git-branch', 'Open Docs Publisher', () => {
			this.activateView();
		});

		// Register command
		this.addCommand({
			id: 'open-docs-publisher',
			name: 'Open Docs Publisher',
			callback: () => {
				this.activateView();
			}
		});

		// A plain `callback`, not `checkCallback`. `checkCallback` would drop the
		// entry from the palette when the author cannot use it, and would also
		// make a bound hotkey do nothing at all, silently — the failure mode
		// `openSettingsTab` already goes out of its way to avoid. The gate lives
		// inside the path instead and says what to do next.
		this.addCommand({
			id: 'new-document',
			name: 'New Document',
			callback: () => {
				this.newDocument();
			}
		});

		// Same plain-`callback` reasoning as "New Document" above: the gate
		// lives inside `submitForReview` itself, not in whether this entry is
		// offered.
		this.addCommand({
			id: 'get-updates',
			name: 'Get updates',
			// A plain `callback`, for the reason the commands around it give: the gate
			// is inside the path and says what to do next.
			callback: () => {
				this.getUpdates();
			},
		});

		this.addCommand({
			id: 'submit-for-review',
			name: 'Submit for review',
			callback: () => {
				this.submitForReview();
			}
		});
	}

	onunload(): void {
		// Note: We deliberately do NOT call detachLeavesOfType here.
		// Detaching would destroy the user's layout every time the plugin updates.

		// A git or ssh still running would outlive the plugin that is waiting for
		// it, holding a connection and a file no one will ever read.
		stopAllProcesses();
	}

	/**
	 * Builds what setup runs on: a git runner told where hooks are NOT to be found,
	 * the author's own `.ssh` folder, and the few Obsidian and operating-system
	 * calls it cannot make itself. Nothing here starts a process; the controller
	 * does, on its own explicit triggers.
	 *
	 * Needs a vault that is a folder on disk. That is true on desktop and not on
	 * mobile, which this plugin stops supporting with this change (task 5.5); until
	 * the manifest says so, an empty path makes every git call fail the way a
	 * missing git does, which setup reports.
	 */
	private createSetupController(): SetupController {
		const adapter = this.app.vault.adapter;
		const vaultPath = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : '';
		// Where Windows is told to look for hooks, which must stay empty and must
		// not be somewhere a synced folder can put files: not in the vault, and
		// never created, so a folder found there was put there. POSIX points hooks
		// at `/dev/null` instead and ignores this.
		const hooksDir = join(tmpdir(), 'docs-publisher-no-hooks');

		// Remembered once git has answered, and asked again until it has: an
		// author may install git while Obsidian is running, and a "not found"
		// kept for the session would make "Check again" useless.
		let execPath: string | null = null;
		const gitExecPath = async (): Promise<string | null> => {
			if (execPath === null) {
				execPath = await readGitExecPath();
			}
			return execPath;
		};

		const locate = async (name: 'ssh' | 'ssh-keygen'): Promise<string | null> => locateOnThisMachine(name, await gitExecPath());
		this.environment = { vaultPath, hooksDir, locate };

		return new SetupController({
			vaultPath,
			sshDir: defaultSshDir(),
			holder: this.setupState,
			settings: {
				get: () => this.settings.savedSetup(),
				save: (patch) => this.settings.saveSetup(patch),
			},
			// What only the vault's repository can answer, read locally and never
			// from the network.
			repo: createRepoFacts({
				context: () => ({ git: createGitRunner({ sshCommand: null, hooksDir }), cwd: vaultPath }),
				savedAddress: () => {
					const saved = this.settings.savedSetup().projectAddress;
					return saved === undefined ? null : parseProjectAddress(saved);
				},
			}),
			slot: this.writeAction,
			git: (sshCommand) => createGitRunner({ sshCommand, hooksDir }),
			run: runProcess,
			locate,
			copyText: (text) => navigator.clipboard.writeText(text),
			openUrl: (url) => {
				window.open(url);
			},
			connect: (git, address) => connectVault({ git, cwd: vaultPath }, address),
			saveIdentity: async (git, name, email) => {
				const ctx = { git, cwd: vaultPath };
				const saved = await writeVaultSetting(ctx, 'user.name', name);
				return saved.ok ? writeVaultSetting(ctx, 'user.email', email) : saved;
			},
			connected: () => this.obsidianGitWarning.check(),
		});
	}

	/** The Obsidian Git plugin can send changes on its own; the author is told once per session, never blocked. */
	private readonly obsidianGitWarning = new WarnOnce(
		() => isObsidianGitEnabled((this.app as unknown as { plugins?: { enabledPlugins?: unknown } }).plugins?.enabledPlugins),
		() => {
			new Notice(AUTHOR_MESSAGES.obsidianGit);
		}
	);

	/**
	 * The one path to creating a document. Both entry points call this, so the
	 * gate is enforced wherever the action is triggered rather than by which
	 * controls happen to be on screen.
	 */
	private newDocument(): void {
		if (!requireSetup(this.setupState, 'all')) {
			return;
		}
		// Setup is complete, so a username is known: the last test reported it, or the author typed it.
		const owner = this.setupState.current.facts.username;
		if (owner !== null) {
			void createDocument(this.app, owner);
		}
	}

	/**
	 * The one path to submitting a document. Both entry points call this, for
	 * the same reason as `newDocument` above.
	 */
	private submitForReview(file: TFile | null = null): void {
		if (!requireSetup(this.setupState, 'all')) {
			return;
		}
		submitDocumentForReview(
			{
				app: this.app,
				writeAction: this.writeAction,
				address: () => this.savedAddress(),
				local: () => this.derivedDeps().local(),
				context: () => this.submitContext(),
				resolveNote: (target) => this.resolveNote(target),
				knownNotes: () => this.noteIdentities.identified(listCandidateNotes(this.app).map((candidate) => candidate.file)),
				// The push has already put the new tip in the fetched copy, so the document
				// reads as waiting for review from that, with no fetch in between.
				rederive: () => deriveFromFetchedCopy(this.derivedDeps()),
				onSetupFailure: async (failure) => {
					await this.setupController?.reportFailureAndForget(failure, 4);
				},
			},
			file
		);
	}

	/**
	 * The one path to getting updates; the panel's control and the command
	 * palette both start it here. Held in the busy slot from the press until the
	 * outcome is told, which is also what stops a refresh starting a fetch under
	 * it: the version an update compares against must not change while it runs.
	 */
	private getUpdates(): void {
		if (!requireSetup(this.setupState, 'all')) {
			return;
		}
		void this.writeAction.run('update', '', async () => {
			const deps = this.derivedDeps();
			const network = await deps.network();
			if (network === null) {
				new Notice(AUTHOR_MESSAGES.notReady);
				return;
			}
			const result = await getUpdates({
				local: deps.local(),
				network: network.ctx,
				address: network.address,
				vault: obsidianVault(this.app),
				prompts: obsidianPrompts(this.app),
				now: () => new Date(),
			});
			if (result.kind === 'failed') {
				const said = updateFailureMessage(result.failure);
				new Notice(said.message);
				if (said.setup) {
					await this.setupController?.reportFailureAndForget(result.failure, 4);
				}
				return;
			}
			// What changed in the vault, and the new synced version, change what the
			// panel should say. No fetch: the update has just made one.
			await deriveFromFetchedCopy(deps);
			this.derivedStates.recordSuccess(this.derivedStates.current);
			if (result.kind === 'done') {
				for (const message of result.messages) {
					new Notice(message);
				}
			}
		});
	}

	/**
	 * The one path to resetting a document. Gated like every action that needs
	 * setup, wherever it is started; there is no command palette entry, on purpose.
	 */
	private resetNote(file: TFile): void {
		if (!requireSetup(this.setupState, 'all')) {
			return;
		}
		resetDocument(
			{
				app: this.app,
				writeAction: this.writeAction,
				local: () => this.derivedDeps().local(),
				rederive: () => deriveFromFetchedCopy(this.derivedDeps()),
				docIdOf: (entry) => this.resolveNote(entry)?.docId ?? null,
			},
			file
		);
	}

	/** The document git already knows a note to be, from what was last derived; null when it is not one, or nothing is derived yet. */
	private resolveNote(file: TFile): ResolvedNote | null {
		const states = this.derivedStates.current;
		if (states === null) {
			return null;
		}
		const vaultPaths = new Set(this.app.vault.getFiles().map((entry) => entry.path));
		const note = { path: file.path, blob: this.noteIdentities.get(file), legacyDocId: readDocId(this.app, file) };
		return resolveNotes(states, [note], vaultPaths).get(file.path) ?? null;
	}

	/** What a send needs, or null while setup cannot supply it: the key, the address, and who the author is. */
	private async submitContext(): Promise<SubmitContext | null> {
		const deps = this.derivedDeps();
		const network = await deps.network();
		const identity = this.setupState.current.facts.identity;
		if (network === null || identity === null) {
			return null;
		}
		return {
			local: deps.local(),
			network: network.ctx,
			address: network.address,
			identity: { name: identity.name, email: identity.email },
		};
	}

	/**
	 * The one path to refreshing document states: the panel opening and the
	 * panel's Refresh control both come through here, so neither can drift from
	 * the other. Nothing else calls it. No timer, no note event, no render — the
	 * author refreshes and the plugin does not watch.
	 *
	 * Skipped while one of the actions that write is running, because a fetch
	 * must not start under a send or an update that is comparing against the
	 * version it is about to replace; the author is told only when they asked.
	 */
	private refreshDocumentStates(asked: boolean): void {
		if (this.writeAction.current !== null) {
			if (asked) {
				new Notice(AUTHOR_MESSAGES.stillBusy);
			}
			return;
		}
		void (async () => {
			// What the fetched copy from the last session says, read before the setup
			// check so the list is there at once instead of after it. It is local and
			// read-only, and a vault that is not connected has no such copy: nothing
			// is derived and nothing is shown (tests/refresh-states.test.ts).
			if (this.derivedStates.current === null) {
				await deriveFromFetchedCopy(this.derivedDeps());
			}
			await this.setupController?.refresh();
			if (!this.setupState.current.progress.ready) {
				return;
			}
			await refreshStates(this.derivedDeps());
		})();
	}

	/** What the refresh path reads from and writes to. */
	private derivedDeps(): RefreshDeps {
		const environment = this.environment;
		return {
			holder: this.derivedStates,
			local: () => ({ git: createGitRunner({ sshCommand: null, hooksDir: environment.hooksDir }), cwd: environment.vaultPath }),
			network: async () => {
				const saved = this.settings.savedSetup();
				const address = this.savedAddress();
				if (address === null || saved.keyPath === undefined) {
					return null;
				}
				const ssh = await environment.locate('ssh');
				const git = createGitRunner({
					sshCommand: buildSshCommand({ keyPath: saved.keyPath, sshProgram: ssh ?? undefined }),
					hooksDir: environment.hooksDir,
				});
				return { ctx: { git, cwd: environment.vaultPath }, address };
			},
			docIds: () => listVaultDocuments(this.app).map((entry) => entry.docId),
			onSetupFailure: async (failure) => {
				await this.setupController?.reportFailureAndForget(failure, 4);
			},
		};
	}

	/** The project address the author saved, parsed; null when none or when it does not parse. */
	private savedAddress(): ProjectAddress | null {
		const saved = this.settings.savedSetup().projectAddress;
		return saved === undefined ? null : parseProjectAddress(saved);
	}

	private async activateView(): Promise<void> {
		// In-flight guard: prevent race condition where two rapid triggers
		// both pass the getLeavesOfType check before either awaits setViewState
		if (this.viewActivating) {
			return;
		}

		this.viewActivating = true;
		try {
			const { workspace } = this.app;

			// Check if a leaf of this view type already exists
			const leaves = workspace.getLeavesOfType(VIEW_TYPE);
			if (leaves.length > 0) {
				// View already exists, reveal it
				workspace.revealLeaf(leaves[0]);
				return;
			}

			// Get or create a right sidebar leaf
			const rightLeaf = workspace.getRightLeaf(false);
			if (rightLeaf === null) {
				console.error('Failed to create or get right sidebar leaf');
				return;
			}

			// Set the view state to our custom view type and reveal it
			await rightLeaf.setViewState({ type: VIEW_TYPE });
			workspace.revealLeaf(rightLeaf);
		} finally {
			this.viewActivating = false;
		}
	}
}

export { DocsPublisherPlugin as default };
