import type { ActionSlot } from '../action-slot';
import { AUTHOR_MESSAGES, AUTHOR_TEMPLATES } from '../author-messages';
import type { GitFailureKind, GitResult } from '../git-publishing/failures';
import { isUsableSettingValue } from '../git-publishing/git-config';
import type { GitRunner, ProcessRunner } from '../git-publishing/git-runner';
import { createDedicatedKey, findKeys, probeKeyProtection, readPublicKey } from '../git-publishing/keys';
import type { KeyFile } from '../git-publishing/keys';
import { GITLAB_USERNAME, parseProjectAddress, sshKeysPageUrl } from '../git-publishing/project-address';
import type { ProjectAddress } from '../git-publishing/project-address';
import { sshCommand } from '../git-publishing/ssh-command';
import { testAccess } from '../git-publishing/test-access';
import type { SavedSetup } from './settings-store';
import { setupMessageFor } from './setup-messages';
import type { ConnectResult } from '../vault-sync/connect';
import { setupGate } from './setup-gate';
import { stepForFailure } from './setup-state';
import type { SetupFacts, SetupStateHolder, SetupStep } from './setup-state';

/**
 * Where the saved setup lives. The store satisfies it; the tests do not need a
 * store to exercise the controller. An `undefined` in a patch forgets that
 * field.
 */
export interface SetupSettings {
	get(): SavedSetup;
	save(patch: { [K in keyof SavedSetup]?: SavedSetup[K] | undefined }): Promise<void>;
}

/**
 * The two facts, and the one lock, that depend on the vault's repository and
 * so on connecting (group 2). Until that exists the answers are "no", which is
 * true: nothing is connected yet.
 */
export interface SetupRepoFacts {
	vaultConnected(): Promise<boolean>;
	identity(): Promise<SetupFacts['identity']>;
	/**
	 * The vault's origin as an address, or null when the vault is not connected.
	 * The whole address and not just its project: the same project path on
	 * another host is another project.
	 */
	connectedAddress(): Promise<ProjectAddress | null>;
}

export interface SetupEnvironment {
	vaultPath: string;
	sshDir: string;
	holder: SetupStateHolder;
	settings: SetupSettings;
	repo: SetupRepoFacts;
	/** Setup's two long actions go through the same one-at-a-time slot as publishing. */
	slot: Pick<ActionSlot, 'run'>;
	/** A git runner configured with this `GIT_SSH_COMMAND`, or none for an operation that never reaches a server. */
	git: (sshCommand: string | null) => GitRunner;
	run: ProcessRunner;
	locate: (name: 'ssh' | 'ssh-keygen') => Promise<string | null>;
	copyText: (text: string) => Promise<void>;
	openUrl: (url: string) => void;
	/** Connects the vault. `git` is the runner that carries the chosen key. */
	connect: (git: GitRunner, address: ProjectAddress) => Promise<ConnectResult>;
	/** Writes the name and email to this vault's own settings. */
	saveIdentity: (git: GitRunner, name: string, email: string) => Promise<GitResult<void>>;
	/** Told after a connect that worked, for the once-per-session notice about another plugin. */
	connected?: () => void;
}

export type AddressOutcome = 'saved' | 'unchanged' | 'invalid' | 'locked';

/**
 * Everything the setup checklist does, in one place, for the panel and the
 * settings tab to call (replace-rest-with-local-git-ssh tasks 1.8–1.10).
 *
 * The two surfaces are thin on purpose. Each shows the same state from the
 * same holder and presses the same methods here, so they cannot disagree, and a
 * test of this class is a test of both. Nothing here draws anything: what an
 * action has to say goes into the holder as a notice, and whichever surface is
 * open shows it.
 *
 * Reading the facts (`refresh`) never touches the network and starts one
 * process, `git version`. It runs on the explicit triggers only — the plugin
 * starting, the panel or the settings tab opening, "Check again", and after an
 * action — and never from a render, which happens on every keystroke that
 * changes a note's front matter.
 *
 * No method here rejects. An action started with `void` and failing has nowhere
 * to report to but the console, so each says "the check did not succeed" itself
 * and logs why.
 */
export class SetupController {
	private refreshing: Promise<void> | null = null;
	private refreshAgain = false;

	constructor(private readonly env: SetupEnvironment) {}

	/**
	 * Reads the local facts and publishes them. Refreshes are coalesced: one runs
	 * at a time, and a request that arrives while it runs makes it run once more
	 * afterwards instead of racing it. Two overlapping reads can finish in either
	 * order, and the one that finished last would win with facts read before the
	 * other's save. Whoever asked is told when the rerun is done, so what they
	 * read next is not older than their request.
	 */
	refresh(): Promise<void> {
		if (this.refreshing !== null) {
			this.refreshAgain = true;
			return this.refreshing;
		}
		const running = (async () => {
			try {
				do {
					this.refreshAgain = false;
					await this.readFacts();
				} while (this.refreshAgain);
			} finally {
				this.refreshing = null;
			}
		})();
		this.refreshing = running;
		return running;
	}

	async checkAgain(): Promise<void> {
		await this.attempt(async () => {
			this.env.holder.clearFailure(1);
			this.env.holder.setNotice(null);
			await this.refresh();
		});
	}

	/**
	 * Called when the author leaves the address field. Saving never starts a
	 * test: the address is not the thing being verified until Test is pressed.
	 */
	async setAddress(text: string): Promise<AddressOutcome> {
		return this.guarded<AddressOutcome>('invalid', async () => {
			const saved = this.env.settings.get();
			const connected = await this.env.repo.connectedAddress();

			if (text.trim() === '') {
				if (connected !== null) {
					return this.lock(connected);
				}
				if (saved.projectAddress === undefined) {
					return 'unchanged';
				}
				await this.env.settings.save({ projectAddress: undefined, ...FORGET_WHAT_A_TEST_LEARNED });
				this.env.holder.setNotice(null);
				await this.refresh();
				return 'saved';
			}

			const address = parseProjectAddress(text);
			if (address === null) {
				this.env.holder.setNotice({ step: 2, text: AUTHOR_MESSAGES.addressInvalid });
				return 'invalid';
			}
			if (address.sshUrl === saved.projectAddress) {
				this.env.holder.setNotice(null);
				return 'unchanged';
			}
			if (connected !== null && address.sshUrl !== connected.sshUrl) {
				return this.lock(connected);
			}

			// A different address is a different thing to have tested against.
			await this.env.settings.save({ projectAddress: address.sshUrl, ...FORGET_WHAT_A_TEST_LEARNED });
			this.env.holder.setNotice(null);
			await this.refresh();
			return 'saved';
		}, 2);
	}

	/** Makes the plugin's own key, or adopts the one it already made. Never overwrites a file. */
	async createKey(): Promise<void> {
		await this.attempt(async () => {
			await this.env.slot.run('createKey', '', async () => {
				await this.attempt(async () => {
					const keygen = await this.env.locate('ssh-keygen');
					if (keygen === null) {
						this.reportFailure('ssh-missing');
						return;
					}

					const existing = (await findKeys(this.env.sshDir)).find((key) => key.kind === 'dedicated');
					let key: KeyFile;
					if (existing !== undefined) {
						// Adopted only if it can be used: a key file ssh-keygen cannot
						// read would be chosen again on every press, and the author would
						// be told to create the key they just failed to create.
						if ((await probeKeyProtection(existing.path, keygen, this.env.run)) === 'unreadable') {
							this.reportFailure('key-exists');
							return;
						}
						key = existing;
					} else {
						const made = await createDedicatedKey(this.env.sshDir, keygen, this.env.run);
						if (!made.ok) {
							this.reportFailure(made.failure);
							return;
						}
						key = made.value;
					}

					// A new key proves nothing yet: whatever the last test covered, it
					// covered another key, and the name it learned was that key's.
					await this.env.settings.save({ keyPath: key.path, ...FORGET_WHAT_A_TEST_LEARNED });
					this.env.holder.clearFailure(3);
					this.env.holder.setNotice(null);
					await this.refresh();
				});
			});
		});
	}

	/** Proves the key reaches the project, and learns whose key it is. */
	async testKey(): Promise<void> {
		await this.attempt(async () => {
			await this.env.slot.run('test', '', async () => {
				await this.attempt(async () => {
					await this.refresh();
					const { address, key } = this.env.holder.current.facts;
					if (address === null) {
						this.reportFailure('address-invalid', 2);
						return;
					}
					if (key === null || !key.exists) {
						this.reportFailure('unexpected');
						return;
					}

					const ssh = await this.env.locate('ssh');
					const sshKeygen = await this.env.locate('ssh-keygen');
					const runner = this.env.git(sshCommand({ keyPath: key.path, sshProgram: ssh ?? undefined }));
					const outcome = await testAccess(
						{ git: runner, run: this.env.run, sshPath: ssh, sshKeygenPath: sshKeygen, cwd: this.env.vaultPath },
						address,
						key.path
					);
					if (!outcome.ok) {
						await this.reportFailureAndForget(outcome.failure);
						return;
					}

					const username = outcome.value.username ?? this.env.settings.get().username ?? null;
					await this.env.settings.save(
						username === null
							? { testedFor: { keyPath: key.path, address: address.sshUrl } }
							: { testedFor: { keyPath: key.path, address: address.sshUrl }, username }
					);
					// The project answered, so a complaint that it could not be found, and
					// one that the key was refused, are both out of date.
					this.env.holder.clearFailure(2);
					this.env.holder.clearFailure(3);
					this.env.holder.setNotice({
						step: 3,
						text:
							username === null
								? `${AUTHOR_MESSAGES.keyWorksNoName} ${AUTHOR_MESSAGES.usernamePrompt}`
								: AUTHOR_TEMPLATES.keyWorks(username),
					});
					await this.refresh();
				});
			});
		});
	}

	/**
	 * Connects the vault to the project. Needs the first three steps, and nothing
	 * else: it is step 4 itself. A refusal (the vault is another project's, or
	 * holds unsent work) is said on step 4 and recorded against it, so it is still
	 * there after the next refresh; a failure (no network, a missing program) goes
	 * to the step it belongs to.
	 */
	async connect(): Promise<void> {
		await this.attempt(async () => {
			await this.env.slot.run('connect', '', async () => {
				await this.attempt(async () => {
					await this.refresh();
					const { holder } = this.env;
					const { address, key } = holder.current.facts;
					const gate = setupGate(holder.current.progress, 'connecting', holder.current.checked);
					if (!gate.ok || address === null || key === null) {
						holder.setNotice({ step: holder.current.progress.firstIncomplete ?? 4, text: AUTHOR_MESSAGES.notReady });
						return;
					}

					const ssh = await this.env.locate('ssh');
					const runner = this.env.git(sshCommand({ keyPath: key.path, sshProgram: ssh ?? undefined }));
					const result = await this.env.connect(runner, address);
					if (result.ok) {
						holder.clearFailure(4);
						holder.setNotice({ step: 4, text: result.message });
						await this.refresh();
						this.env.connected?.();
						return;
					}
					if (result.kind === 'refused') {
						holder.failStep(4, result.message);
						holder.setNotice({ step: 4, text: result.message });
						return;
					}
					await this.reportFailureAndForget(result.failure, 4);
				}, 4);
			});
		}, 4);
	}

	/**
	 * Saves the name and email to this vault's own settings, which exist only
	 * once the vault is connected. The computer-wide ones are never written.
	 */
	async saveIdentity(name: string, email: string): Promise<boolean> {
		return this.guarded(
			false,
			async () => {
				const { holder } = this.env;
				if (!holder.current.facts.vaultConnected) {
					holder.setNotice({ step: 5, text: AUTHOR_MESSAGES.identityReadonly });
					return false;
				}
				if (!isUsableSettingValue(name) || !isUsableSettingValue(email) || !/^\S+@\S+$/.test(email.trim())) {
					holder.setNotice({ step: 5, text: AUTHOR_MESSAGES.identityInvalid });
					return false;
				}
				const saved = await this.env.saveIdentity(this.env.git(null), name, email);
				if (!saved.ok) {
					this.reportFailure(saved.failure, 5);
					return false;
				}
				holder.clearFailure(5);
				holder.setNotice({ step: 5, text: AUTHOR_MESSAGES.identitySaved });
				await this.refresh();
				return true;
			},
			5
		);
	}

	/** For the author to type, when the server's greeting could not be read. */
	async setUsername(text: string): Promise<boolean> {
		return this.guarded(false, async () => {
			const name = text.trim().replace(/^@/, '');
			if (!GITLAB_USERNAME.test(name)) {
				this.env.holder.setNotice({ step: 3, text: AUTHOR_MESSAGES.usernameInvalid });
				return false;
			}
			await this.env.settings.save({ username: name });
			this.env.holder.setNotice(null);
			await this.refresh();
			return true;
		});
	}

	/** Copies the public half. The private half is never read: a key with no `.pub` is a failure, not a file to open. */
	async copyKey(): Promise<void> {
		await this.attempt(async () => {
			const chosen = this.env.holder.current.facts.key;
			const key = chosen === null ? undefined : (await findKeys(this.env.sshDir)).find((k) => k.path === chosen.path);
			const text = key === undefined ? null : await readPublicKey(key);
			if (text === null) {
				this.reportFailure('unexpected');
				return;
			}
			try {
				await this.env.copyText(text);
			} catch (error) {
				console.error('Docs Publisher: could not copy the key to the clipboard', error);
				this.reportFailure('unexpected');
				return;
			}
			this.env.holder.setNotice({ step: 3, text: AUTHOR_MESSAGES.keyCopied });
		});
	}

	openGitLabKeys(): void {
		const { address } = this.env.holder.current.facts;
		if (address !== null) {
			this.env.openUrl(sshKeysPageUrl(address));
		}
	}

	/**
	 * What any action does with a failure that is the setup's business: say it,
	 * on the step it belongs to, and mark that step incomplete. A failure that is
	 * only about the moment (no network, a timeout) is said and nothing more:
	 * the author has set up nothing wrongly.
	 */
	reportFailure(kind: GitFailureKind, fallbackStep: SetupStep = 3): void {
		const text = setupMessageFor(kind);
		const step = stepForFailure(kind);
		if (step !== null) {
			this.env.holder.failStep(step, text, kind);
		}
		this.env.holder.setNotice({ step: step === null ? fallbackStep : step, text });
	}

	/**
	 * `reportFailure`, and forget the saved test when the failure is about the
	 * key: a server that no longer honours it means the earlier test no longer
	 * holds, and leaving it saved would bring the step back as "done" on the
	 * next start.
	 */
	async reportFailureAndForget(kind: GitFailureKind, fallbackStep: SetupStep = 3): Promise<void> {
		if (stepForFailure(kind) === 3) {
			await this.env.settings.save({ testedFor: undefined });
		}
		this.reportFailure(kind, fallbackStep);
		await this.refresh();
	}

	/**
	 * Runs an action so that it cannot reject. Whatever it throws is logged for
	 * whoever supports the plugin, and the author is told the check did not
	 * succeed, on the step it was about.
	 */
	private async guarded<T>(fallback: T, work: () => Promise<T>, step: SetupStep = 3): Promise<T> {
		try {
			return await work();
		} catch (error) {
			console.error('Docs Publisher: a setup action failed', error);
			this.reportFailure('unexpected', step);
			return fallback;
		}
	}

	/** `guarded` for an action with nothing to return. */
	private attempt(work: () => Promise<void>, step: SetupStep = 3): Promise<void> {
		return this.guarded<void>(undefined, work, step);
	}

	private lock(connected: ProjectAddress): AddressOutcome {
		this.env.holder.setNotice({ step: 2, text: AUTHOR_TEMPLATES.addressLocked(connected.path) });
		return 'locked';
	}

	private async readFacts(): Promise<void> {
		const saved = this.env.settings.get();
		const parsed = saved.projectAddress === undefined ? null : parseProjectAddress(saved.projectAddress);

		const facts: SetupFacts = {
			gitInstalled: await this.gitInstalled(),
			// A saved address that fails validation is treated as not set, never
			// repaired: it reaches a process, and `data.json` is a file anyone with
			// access to the vault can edit.
			address: parsed,
			key: await this.chooseKey(saved),
			testedFor: saved.testedFor === undefined ? null : { ...saved.testedFor },
			username: saved.username === undefined ? null : saved.username,
			vaultConnected: await this.env.repo.vaultConnected(),
			identity: await this.env.repo.identity(),
		};
		this.env.holder.setFacts(facts);
	}

	private async gitInstalled(): Promise<boolean> {
		try {
			const result = await this.env.git(null).run({ args: ['version'], cwd: this.env.vaultPath });
			return result.spawnError === null && result.exitCode === 0;
		} catch (error) {
			// A refusal, not a missing program; the console says which.
			console.error('Docs Publisher: could not run git', error);
			return false;
		}
	}

	/**
	 * The key in use: the one saved if it is still there, otherwise the best one
	 * found, saved for next time. A saved key that has gone is reported as gone
	 * only when nothing can stand in for it — the author deleted a file, and
	 * choosing another key silently is fine because the test result no longer
	 * matches it and Test has to be pressed again.
	 */
	private async chooseKey(saved: SavedSetup): Promise<SetupFacts['key']> {
		const keys = await findKeys(this.env.sshDir);
		const chosen = keys.find((key) => key.path === saved.keyPath) ?? keys[0];
		if (chosen === undefined) {
			return saved.keyPath === undefined ? null : { path: saved.keyPath, exists: false };
		}
		if (chosen.path !== saved.keyPath) {
			await this.env.settings.save({ keyPath: chosen.path });
		}
		return { path: chosen.path, exists: true };
	}
}

/**
 * What a test taught the plugin, which stops being true when the key or the
 * address it was run against changes: that it passed, and whose account the
 * server said the key belongs to. Keeping the name would give a new key the old
 * key's owner whenever the server's greeting cannot be read.
 */
const FORGET_WHAT_A_TEST_LEARNED = { testedFor: undefined, username: undefined };
