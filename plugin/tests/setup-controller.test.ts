import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionSlot } from '../src/action-slot';
import { AUTHOR_MESSAGES, AUTHOR_TEMPLATES } from '../src/author-messages';
import type { GitResult } from '../src/git-publishing/failures';
import type { GitRequest, GitRunner, ProcessResult, ProcessRunner } from '../src/git-publishing/git-runner';
import { DEDICATED_KEY_NAME } from '../src/git-publishing/keys';
import { parseProjectAddress } from '../src/git-publishing/project-address';
import type { ProjectAddress } from '../src/git-publishing/project-address';
import { SetupController } from '../src/platform-config/setup-controller';
import type { SetupEnvironment, SetupRepoFacts, SetupSettings } from '../src/platform-config/setup-controller';
import { SetupStateHolder } from '../src/platform-config/setup-state';
import type { SavedSetup } from '../src/platform-config/settings-store';
import type { ConnectResult } from '../src/vault-sync/connect';

const ADDRESS = 'git@gitlab.example.com:docs/kb.git';

/** The vault's origin, as connecting (group 2) will report it. */
function connectedTo(address: string): () => Promise<ProjectAddress | null> {
	const parsed = parseProjectAddress(address);
	return async () => parsed;
}

function result(overrides: Partial<ProcessResult> & { out?: string } = {}): ProcessResult {
	const { out, ...rest } = overrides;
	return { exitCode: 0, stdout: Buffer.from(out ?? ''), stderr: '', timedOut: false, truncated: false, spawnError: null, ...rest };
}

let home: string;
let sshDir: string;
beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), 'setup-'));
	sshDir = join(home, '.ssh');
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
	rmSync(home, { recursive: true, force: true });
	vi.restoreAllMocks();
});

/** A key as far as the plugin looks at one: a file by that name, plus the public half. */
function putKey(name: string): string {
	mkdirSync(sshDir, { recursive: true });
	const path = join(sshDir, name);
	writeFileSync(path, 'PRIVATE');
	writeFileSync(`${path}.pub`, `ssh-ed25519 AAAAC3Nza-${name} test\n`);
	return path;
}

interface Scripts {
	saved?: SavedSetup;
	gitInstalled?: boolean;
	probe?: 'open' | 'protected' | 'unreadable';
	lsRemote?: ProcessResult;
	greeting?: ProcessResult;
	ssh?: string | null;
	sshKeygen?: string | null;
	keygenFails?: boolean;
	repo?: Partial<SetupRepoFacts>;
	copyFails?: boolean;
	connect?: ConnectResult;
	connectThrows?: boolean;
	saveIdentity?: GitResult<void>;
}

function build(scripts: Scripts = {}) {
	const holder = new SetupStateHolder();
	let data: SavedSetup = { ...(scripts.saved ?? {}) };
	const saves: Array<Record<string, unknown>> = [];
	const settings: SetupSettings = {
		get: () => ({ ...data }),
		save: async (patch) => {
			saves.push(patch as Record<string, unknown>);
			const next: Record<string, unknown> = { ...data };
			for (const key of Object.keys(patch)) {
				const value = (patch as Record<string, unknown>)[key];
				if (value === undefined) {
					delete next[key];
				} else {
					next[key] = value;
				}
			}
			data = next as SavedSetup;
		},
	};
	const ran: string[] = [];
	const slot = {
		run: async (action: string, _target: string, work: () => Promise<void>) => {
			ran.push(action);
			await work();
		},
	};
	const gitCalls: GitRequest[] = [];
	const sshCommands: Array<string | null> = [];
	const git = (sshCommand: string | null): GitRunner => {
		sshCommands.push(sshCommand);
		return {
			run: vi.fn(async (request: GitRequest) => {
				gitCalls.push(request);
				if (request.args[0] === 'version') {
					return scripts.gitInstalled === false
						? result({ exitCode: null, spawnError: 'ENOENT' })
						: result({ out: 'git version 2.43.0\n' });
				}
				return scripts.lsRemote ?? result({ out: 'ref: refs/heads/main\tHEAD\nabc\tHEAD\n' });
			}),
		};
	};
	const toolCalls: Array<{ file: string; args: string[] }> = [];
	const run: ProcessRunner = async (file, args) => {
		toolCalls.push({ file, args });
		if (args[0] === '-y') {
			const probe = scripts.probe ?? 'open';
			return probe === 'open'
				? result({ out: 'ssh-ed25519 AAAA\n' })
				: result({ exitCode: 255, stderr: probe === 'protected' ? 'incorrect passphrase supplied to decrypt private key' : 'No such file or directory' });
		}
		if (args.indexOf('-T') !== -1) {
			return scripts.greeting ?? result({ out: 'Welcome to GitLab, @ana.nguyen!\n' });
		}
		// ssh-keygen creating the plugin's own key: make the files it would.
		const target = args[args.indexOf('-f') + 1];
		if (scripts.keygenFails === true) {
			return result({ exitCode: 1, stderr: 'boom' });
		}
		mkdirSync(sshDir, { recursive: true });
		writeFileSync(target, 'PRIVATE');
		writeFileSync(`${target}.pub`, 'ssh-ed25519 AAAAC3Nza-new test\n');
		return result();
	};
	const copied: string[] = [];
	const opened: string[] = [];
	const connects: string[] = [];
	const identitySaves: Array<{ name: string; email: string }> = [];
	const connectedHooks: string[] = [];
	const repo: SetupRepoFacts = {
		vaultConnected: async () => false,
		identity: async () => null,
		connectedAddress: async () => null,
		...scripts.repo,
	};
	const env: SetupEnvironment = {
		vaultPath: '/vault',
		sshDir,
		holder,
		settings,
		repo,
		slot: slot as SetupEnvironment['slot'],
		git,
		run,
		locate: async (name) => (name === 'ssh' ? (scripts.ssh === undefined ? '/usr/bin/ssh' : scripts.ssh) : scripts.sshKeygen === undefined ? '/usr/bin/ssh-keygen' : scripts.sshKeygen),
		copyText: async (text) => {
			if (scripts.copyFails === true) {
				throw new Error('clipboard');
			}
			copied.push(text);
		},
		openUrl: (url) => {
			opened.push(url);
		},
		connect: async (_git, address) => {
			connects.push(address.sshUrl);
			if (scripts.connectThrows === true) {
				throw new Error('disk full');
			}
			return scripts.connect ?? { ok: true, message: AUTHOR_MESSAGES.vaultConnected };
		},
		saveIdentity: async (_git, name, email) => {
			identitySaves.push({ name, email });
			return scripts.saveIdentity ?? { ok: true, value: undefined };
		},
		connected: () => {
			connectedHooks.push('connected');
		},
	};
	return { connects, identitySaves, connectedHooks, controller: new SetupController(env), env, holder, settings, get data() { return data; }, saves, ran, gitCalls, sshCommands, toolCalls, copied, opened };
}

describe('reading the facts setup is decided from', () => {
	it('puts a fresh machine at the project address, with git found', async () => {
		const t = build();

		await t.controller.refresh();

		expect(t.holder.current.facts.gitInstalled).toBe(true);
		expect(t.holder.current.progress.firstIncomplete).toBe(2);
	});

	it('puts a machine without git at step 1', async () => {
		const t = build({ gitInstalled: false });

		await t.controller.refresh();

		expect(t.holder.current.progress.firstIncomplete).toBe(1);
	});

	it('treats a saved address that fails validation as not set', async () => {
		const t = build({ saved: { projectAddress: 'git@-oProxyCommand=x:a/b.git' } });

		await t.controller.refresh();

		expect(t.holder.current.facts.address).toBeNull();
		expect(t.holder.current.progress.firstIncomplete).toBe(2);
	});

	it('uses the key it saved, when that key is still there', async () => {
		putKey('id_ed25519');
		const chosen = putKey('id_rsa');
		const t = build({ saved: { projectAddress: ADDRESS, keyPath: chosen } });

		await t.controller.refresh();

		expect(t.holder.current.facts.key).toEqual({ path: chosen, exists: true });
	});

	it('picks the best key it finds when none was saved, and remembers the choice', async () => {
		putKey('id_ed25519');
		const own = putKey(DEDICATED_KEY_NAME);
		const t = build({ saved: { projectAddress: ADDRESS } });

		await t.controller.refresh();

		expect(t.holder.current.facts.key).toEqual({ path: own, exists: true });
		expect(t.data.keyPath).toBe(own);
	});

	it('says a saved key is gone when nothing else can stand in for it', async () => {
		const t = build({ saved: { projectAddress: ADDRESS, keyPath: join(sshDir, 'id_ed25519') } });

		await t.controller.refresh();

		expect(t.holder.current.facts.key).toEqual({ path: join(sshDir, 'id_ed25519'), exists: false });
	});

	it('finds no key on a machine that has none', async () => {
		const t = build({ saved: { projectAddress: ADDRESS } });

		await t.controller.refresh();

		expect(t.holder.current.facts.key).toBeNull();
	});

	it('takes the vault and identity facts from the repository, which only the later groups can answer', async () => {
		const t = build({ repo: { vaultConnected: async () => true, identity: async () => ({ name: 'Ana', email: 'a@x' }) } });

		await t.controller.refresh();

		expect(t.holder.current.facts.vaultConnected).toBe(true);
		expect(t.holder.current.facts.identity).toEqual({ name: 'Ana', email: 'a@x' });
	});

	it('does not start the network or ssh to find out', async () => {
		putKey(DEDICATED_KEY_NAME);
		const t = build({ saved: { projectAddress: ADDRESS } });

		await t.controller.refresh();

		expect(t.toolCalls).toEqual([]);
		expect(t.gitCalls.map((c) => c.args[0])).toEqual(['version']);
	});
});

describe('entering the project address', () => {
	it('saves an ssh address as the form git will use', async () => {
		const t = build();

		const outcome = await t.controller.setAddress('  https://gitlab.example.com/docs/kb  ');

		expect(outcome).toBe('saved');
		expect(t.data.projectAddress).toBe(ADDRESS);
	});

	it('refuses an address it cannot use, saves nothing, and says why on the address step', async () => {
		const t = build({ saved: { projectAddress: ADDRESS } });

		const outcome = await t.controller.setAddress('1234');

		expect(outcome).toBe('invalid');
		expect(t.data.projectAddress).toBe(ADDRESS);
		expect(t.holder.current.notice).toEqual({ step: 2, text: AUTHOR_MESSAGES.addressInvalid });
	});

	it('discards the test result when the address changes, without starting a test', async () => {
		const keyPath = putKey(DEDICATED_KEY_NAME);
		const t = build({
			saved: { projectAddress: ADDRESS, keyPath, username: 'ana', testedFor: { keyPath, address: ADDRESS } },
		});
		await t.controller.refresh();
		expect(t.holder.current.facts.testedFor).not.toBeNull();

		await t.controller.setAddress('git@gitlab.example.com:docs/other.git');

		expect(t.data.testedFor).toBeUndefined();
		expect(t.holder.current.progress.complete[2]).toBe(false);
		expect(t.toolCalls).toEqual([]);
	});

	it('leaves the test result alone when the same address is entered again', async () => {
		const keyPath = putKey(DEDICATED_KEY_NAME);
		const t = build({
			saved: { projectAddress: ADDRESS, keyPath, username: 'ana', testedFor: { keyPath, address: ADDRESS } },
		});

		const outcome = await t.controller.setAddress('https://gitlab.example.com/docs/kb.git');

		expect(outcome).toBe('unchanged');
		expect(t.data.testedFor).toEqual({ keyPath, address: ADDRESS });
	});

	it('refuses to move a connected vault to another project, and names the one it is connected to', async () => {
		const t = build({ saved: { projectAddress: ADDRESS }, repo: { connectedAddress: connectedTo(ADDRESS) } });

		const outcome = await t.controller.setAddress('git@gitlab.example.com:docs/other.git');

		expect(outcome).toBe('locked');
		expect(t.data.projectAddress).toBe(ADDRESS);
		expect(t.holder.current.notice).toEqual({ step: 2, text: AUTHOR_TEMPLATES.addressLocked('docs/kb') });
	});

	it('allows the same project to be entered in another form while connected', async () => {
		const t = build({ saved: { projectAddress: ADDRESS }, repo: { connectedAddress: connectedTo(ADDRESS) } });

		const outcome = await t.controller.setAddress('ssh://git@gitlab.example.com/docs/kb');

		expect(outcome).toBe('unchanged');
	});

	// The lock compares the whole address. The same project path on another host
	// or another port is another project, and a lock that compared only the path
	// would let a connected vault be pointed at it.
	for (const [label, other] of [
		['another host', 'git@gitlab.other.example.com:docs/kb.git'],
		['another port', 'ssh://git@gitlab.example.com:2222/docs/kb.git'],
	] as const) {
		it(`refuses the same project path on ${label} while connected`, async () => {
			const t = build({ saved: { projectAddress: ADDRESS }, repo: { connectedAddress: connectedTo(ADDRESS) } });

			const outcome = await t.controller.setAddress(other);

			expect(outcome).toBe('locked');
			expect(t.data.projectAddress).toBe(ADDRESS);
		});
	}

	it('refuses to empty the field of a connected vault', async () => {
		const t = build({ saved: { projectAddress: ADDRESS }, repo: { connectedAddress: connectedTo(ADDRESS) } });

		expect(await t.controller.setAddress('')).toBe('locked');
		expect(t.data.projectAddress).toBe(ADDRESS);
	});

	it('forgets who the last key belonged to when the address changes', async () => {
		const keyPath = putKey(DEDICATED_KEY_NAME);
		const t = build({
			saved: { projectAddress: ADDRESS, keyPath, username: 'old.owner', testedFor: { keyPath, address: ADDRESS } },
		});

		await t.controller.setAddress('git@gitlab.other.example.com:docs/kb.git');

		expect(t.data.username).toBeUndefined();
	});

	it('says the check did not succeed, rather than throwing, when the address cannot be saved', async () => {
		const t = build();
		const failing: SetupSettings = { ...t.settings, save: async () => { throw new Error('disk full'); } };
		const controller = new SetupController({ ...t.env, settings: failing });

		await expect(controller.setAddress(ADDRESS)).resolves.toBe('invalid');
		expect(t.holder.current.notice).toEqual({ step: 2, text: AUTHOR_MESSAGES.setupUnexpected });
	});

	it('forgets the address when the field is emptied and nothing is connected', async () => {
		const t = build({ saved: { projectAddress: ADDRESS } });

		await t.controller.setAddress('   ');

		expect(t.data.projectAddress).toBeUndefined();
	});

	it('clears an earlier complaint about the address once a good one is entered', async () => {
		const t = build();
		await t.controller.setAddress('hello');

		await t.controller.setAddress(ADDRESS);

		expect(t.holder.current.notice).toBeNull();
	});
});

describe('creating the plugin\'s own key', () => {
	it('makes a key, remembers it, and discards any earlier test result', async () => {
		const t = build({ saved: { projectAddress: ADDRESS, keyPath: '/old', testedFor: { keyPath: '/old', address: ADDRESS } } });

		await t.controller.createKey();

		const made = join(sshDir, DEDICATED_KEY_NAME);
		expect(t.data.keyPath).toBe(made);
		expect(t.data.testedFor).toBeUndefined();
		expect(t.holder.current.facts.key).toEqual({ path: made, exists: true });
		expect(t.holder.current.progress.complete[2]).toBe(false);
	});

	it('starts no test on its own', async () => {
		const t = build({ saved: { projectAddress: ADDRESS } });

		await t.controller.createKey();

		expect(t.gitCalls.map((c) => c.args[0])).not.toContain('ls-remote');
		expect(t.toolCalls.some((c) => c.args.indexOf('-T') !== -1)).toBe(false);
	});

	it('uses the plugin\'s key when it already exists, and writes nothing', async () => {
		const existing = putKey(DEDICATED_KEY_NAME);
		const t = build({ saved: { projectAddress: ADDRESS } });

		await t.controller.createKey();

		// The one thing run is the question whether ssh-keygen can read it.
		expect(t.toolCalls.map((c) => c.args[0])).toEqual(['-y']);
		expect(t.data.keyPath).toBe(existing);
	});

	it('does not adopt a file of its own name that ssh-keygen cannot read, and says what to do about it', async () => {
		putKey(DEDICATED_KEY_NAME);
		const t = build({ saved: { projectAddress: ADDRESS }, probe: 'unreadable' });

		await t.controller.createKey();

		expect(t.holder.current.notice).toEqual({ step: 3, text: AUTHOR_MESSAGES.keyExists });
		expect(t.data.keyPath).toBeUndefined();
	});

	it('says the file in the way is the problem when a stray public file blocks the new key', async () => {
		mkdirSync(sshDir, { recursive: true });
		writeFileSync(join(sshDir, `${DEDICATED_KEY_NAME}.pub`), 'ssh-ed25519 AAAA stray');
		const t = build({ saved: { projectAddress: ADDRESS } });

		await t.controller.createKey();

		expect(t.holder.current.notice).toEqual({ step: 3, text: AUTHOR_MESSAGES.keyExists });
	});

	it('forgets who the previous key belonged to, so a new key does not inherit its owner', async () => {
		const old = putKey('id_ed25519');
		const t = build({ saved: { projectAddress: ADDRESS, keyPath: old, username: 'old.owner', testedFor: { keyPath: old, address: ADDRESS } } });

		await t.controller.createKey();

		expect(t.data.username).toBeUndefined();
	});

	it('does not reject when it cannot save, and tells the author the check did not succeed', async () => {
		const t = build({ saved: { projectAddress: ADDRESS } });
		const failing: SetupSettings = { ...t.settings, save: async () => { throw new Error('disk full'); } };
		const controller = new SetupController({ ...t.env, settings: failing });

		await expect(controller.createKey()).resolves.toBeUndefined();
		expect(t.holder.current.notice).toEqual({ step: 3, text: AUTHOR_MESSAGES.setupUnexpected });
	});

	it('says SSH is missing when ssh-keygen cannot be found, and sends the author back to the key step', async () => {
		const t = build({ saved: { projectAddress: ADDRESS }, sshKeygen: null });

		await t.controller.createKey();

		expect(t.holder.current.notice).toEqual({ step: 3, text: AUTHOR_MESSAGES.sshMissing });
		expect(t.holder.current.failures[3]?.message).toBe(AUTHOR_MESSAGES.sshMissing);
	});

	it('says the check did not succeed when ssh-keygen fails', async () => {
		const t = build({ saved: { projectAddress: ADDRESS }, keygenFails: true });

		await t.controller.createKey();

		expect(t.holder.current.notice).toEqual({ step: 3, text: AUTHOR_MESSAGES.setupUnexpected });
	});

	it('runs inside the busy slot as its own action', async () => {
		const t = build({ saved: { projectAddress: ADDRESS } });

		await t.controller.createKey();

		expect(t.ran).toEqual(['createKey']);
	});
});

describe('testing the key', () => {
	async function ready(scripts: Scripts = {}) {
		const keyPath = putKey(DEDICATED_KEY_NAME);
		const t = build({ saved: { projectAddress: ADDRESS, keyPath }, ...scripts });
		await t.controller.refresh();
		return { t, keyPath };
	}

	it('completes the key step, remembers who the key belongs to, and says so', async () => {
		const { t, keyPath } = await ready();

		await t.controller.testKey();

		expect(t.data.testedFor).toEqual({ keyPath, address: ADDRESS });
		expect(t.data.username).toBe('ana.nguyen');
		expect(t.holder.current.progress.complete[2]).toBe(true);
		expect(t.holder.current.notice).toEqual({ step: 3, text: AUTHOR_TEMPLATES.keyWorks('ana.nguyen') });
	});

	it('runs inside the busy slot as the test action', async () => {
		const { t } = await ready();

		await t.controller.testKey();

		expect(t.ran).toEqual(['test']);
	});

	it('tells git which key to use, with the ssh command built for it', async () => {
		const { t, keyPath } = await ready();

		await t.controller.testKey();

		// The runners made for the version check carry no key; the one made for
		// the test is the only one with a command.
		const withKey = t.sshCommands.filter((c): c is string => c !== null);
		expect(withKey).toHaveLength(1);
		expect(withKey[0]).toContain(`'${keyPath}'`);
		expect(withKey[0]).toContain('BatchMode=yes');
	});

	it('leaves the step incomplete, and asks for a username, when the greeting could not be read', async () => {
		const { t } = await ready({ greeting: result({ out: 'Hi!\n' }) });

		await t.controller.testKey();

		expect(t.holder.current.progress.complete[2]).toBe(false);
		expect(t.holder.current.notice?.text).toBe(`${AUTHOR_MESSAGES.keyWorksNoName} ${AUTHOR_MESSAGES.usernamePrompt}`);
		expect(t.data.testedFor).toBeDefined();
	});

	it('keeps a username the author typed when the greeting cannot be read', async () => {
		const { t } = await ready({ greeting: result({ out: 'Hi!\n' }) });
		await t.controller.setUsername('ana');

		await t.controller.testKey();

		expect(t.data.username).toBe('ana');
		expect(t.holder.current.progress.complete[2]).toBe(true);
	});

	it('sends the author back to the key step when GitLab does not recognise the key, and forgets the old test', async () => {
		const keyPath = putKey(DEDICATED_KEY_NAME);
		const t = build({
			saved: { projectAddress: ADDRESS, keyPath, username: 'ana', testedFor: { keyPath, address: ADDRESS } },
			lsRemote: result({ exitCode: 128, stderr: 'git@gitlab.example.com: Permission denied (publickey).' }),
		});

		await t.controller.testKey();

		expect(t.holder.current.notice).toEqual({ step: 3, text: AUTHOR_MESSAGES.keyRejected });
		expect(t.holder.current.progress.firstIncomplete).toBe(3);
		expect(t.data.testedFor).toBeUndefined();
		// Recorded against the step as well as said once, which is what keeps the
		// complaint on screen after the notice is replaced.
		expect(t.holder.current.failures[3]?.kind).toBe('key-rejected');
	});

	// A failure that does not clear the saved test: only the recorded failure
	// keeps the step incomplete, so this fails if the recording is dropped.
	it('keeps the step incomplete on a later refresh, not only until the screen redraws', async () => {
		const keyPath = putKey(DEDICATED_KEY_NAME);
		const t = build({
			saved: { projectAddress: ADDRESS, keyPath, username: 'ana', testedFor: { keyPath, address: ADDRESS } },
		});
		await t.controller.refresh();
		expect(t.holder.current.progress.complete[2]).toBe(true);
		t.controller.reportFailure('host-changed');

		await t.controller.refresh();

		expect(t.data.testedFor).toEqual({ keyPath, address: ADDRESS });
		expect(t.holder.current.progress.complete[2]).toBe(false);
	});

	it('reports a key ssh-keygen cannot read as that, which is not the same as a key with a password', async () => {
		const { t } = await ready({ probe: 'unreadable' });

		await t.controller.testKey();

		expect(t.holder.current.notice).toEqual({ step: 3, text: AUTHOR_MESSAGES.keyUnreadable });
		expect(t.holder.current.failures[3]?.kind).toBe('key-unreadable');
	});

	it('says a setting that rewrites the address is the problem, on the address step', async () => {
		const { t } = await ready({ lsRemote: result({ exitCode: 128, stderr: 'fatal: address rewritten by a git setting' }) });

		await t.controller.testKey();

		expect(t.holder.current.notice).toEqual({ step: 2, text: AUTHOR_MESSAGES.addressRewritten });
	});

	it('names a key with a password, without reaching the network', async () => {
		const { t } = await ready({ probe: 'protected' });

		await t.controller.testKey();

		expect(t.holder.current.notice).toEqual({ step: 3, text: AUTHOR_MESSAGES.keyProtected });
		expect(t.gitCalls.map((c) => c.args[0])).not.toContain('ls-remote');
	});

	it('does not throw away a good earlier test because the network was down', async () => {
		const keyPath = putKey(DEDICATED_KEY_NAME);
		const t = build({
			saved: { projectAddress: ADDRESS, keyPath, username: 'ana', testedFor: { keyPath, address: ADDRESS } },
			lsRemote: result({ exitCode: 255, stderr: 'ssh: Could not resolve hostname gitlab.example.com' }),
		});

		await t.controller.testKey();

		expect(t.holder.current.notice).toEqual({ step: 3, text: AUTHOR_MESSAGES.serverUnreachable });
		expect(t.data.testedFor).toEqual({ keyPath, address: ADDRESS });
		expect(t.holder.current.progress.complete[2]).toBe(true);
	});

	it('sends the author to the address when the project is not visible', async () => {
		const { t } = await ready({
			lsRemote: result({ exitCode: 128, stderr: "remote: ERROR: The project you were looking for could not be found or you don't have permission to view it." }),
		});

		await t.controller.testKey();

		expect(t.holder.current.notice).toEqual({ step: 2, text: AUTHOR_MESSAGES.projectNotFound });
		expect(t.holder.current.progress.firstIncomplete).toBe(2);
	});

	it('says a project with nothing in it has nothing in it', async () => {
		const { t } = await ready({ lsRemote: result({ exitCode: 0, out: '' }) });

		await t.controller.testKey();

		expect(t.holder.current.notice?.text).toBe(AUTHOR_MESSAGES.emptyProject);
	});

	it('clears an earlier complaint about the key once the test passes', async () => {
		const { t } = await ready();
		t.holder.failStep(3, 'refused');

		await t.controller.testKey();

		expect(t.holder.current.failures[3]).toBeUndefined();
		expect(t.holder.current.progress.complete[2]).toBe(true);
	});

	it('does nothing but say so when there is no address to test against', async () => {
		const t = build();

		await t.controller.testKey();

		expect(t.holder.current.notice?.text).toBe(AUTHOR_MESSAGES.addressInvalid);
		expect(t.gitCalls.map((c) => c.args[0])).not.toContain('ls-remote');
	});

	it('succeeds without a username when ssh cannot be found, rather than failing the whole test', async () => {
		const { t } = await ready({ ssh: null });

		await t.controller.testKey();

		expect(t.data.testedFor).toBeDefined();
		expect(t.data.username).toBeUndefined();
		expect(t.holder.current.progress.complete[2]).toBe(false);
	});
});

describe('typing a username', () => {
	it('saves a valid one, with or without the @', async () => {
		const t = build();

		expect(await t.controller.setUsername('@ana.nguyen')).toBe(true);
		expect(t.data.username).toBe('ana.nguyen');
	});

	it('refuses what is not a GitLab username, and says so on the key step', async () => {
		const t = build();

		expect(await t.controller.setUsername('ana nguyen; rm -rf')).toBe(false);
		expect(t.data.username).toBeUndefined();
		expect(t.holder.current.notice).toEqual({ step: 3, text: AUTHOR_MESSAGES.usernameInvalid });
	});

	it('refuses an empty one', async () => {
		const t = build();

		expect(await t.controller.setUsername('  ')).toBe(false);
	});
});

describe('copying the key and opening GitLab', () => {
	it('copies the public half and says it was copied', async () => {
		const keyPath = putKey(DEDICATED_KEY_NAME);
		const t = build({ saved: { projectAddress: ADDRESS, keyPath } });
		await t.controller.refresh();

		await t.controller.copyKey();

		expect(t.copied).toEqual([`ssh-ed25519 AAAAC3Nza-${DEDICATED_KEY_NAME} test`]);
		expect(t.holder.current.notice).toEqual({ step: 3, text: AUTHOR_MESSAGES.keyCopied });
	});

	it('says the check did not succeed when the clipboard refuses', async () => {
		const keyPath = putKey(DEDICATED_KEY_NAME);
		const t = build({ saved: { projectAddress: ADDRESS, keyPath }, copyFails: true });
		await t.controller.refresh();

		await t.controller.copyKey();

		expect(t.holder.current.notice).toEqual({ step: 3, text: AUTHOR_MESSAGES.setupUnexpected });
	});

	it('says the same when the key has no public file, and never reads the private one', async () => {
		const keyPath = join(sshDir, 'id_ed25519');
		mkdirSync(sshDir, { recursive: true });
		// Begins like a public key on purpose: a fallback that read this file
		// would find a line it accepts, and the test would see it copied.
		writeFileSync(keyPath, 'ssh-ed25519 PRIVATE-BYTES-THAT-MUST-NOT-APPEAR');
		const t = build({ saved: { projectAddress: ADDRESS, keyPath } });
		await t.controller.refresh();

		await t.controller.copyKey();

		expect(t.copied).toEqual([]);
		expect(t.holder.current.notice).toEqual({ step: 3, text: AUTHOR_MESSAGES.setupUnexpected });
	});

	it('opens the author\'s own SSH keys page on their GitLab', async () => {
		const t = build({ saved: { projectAddress: ADDRESS } });
		await t.controller.refresh();

		t.controller.openGitLabKeys();

		expect(t.opened).toEqual(['https://gitlab.example.com/-/user_settings/ssh_keys']);
	});

	it('opens nothing when there is no address to build the page from', () => {
		const t = build();

		t.controller.openGitLabKeys();

		expect(t.opened).toEqual([]);
	});
});

describe('connecting the vault', () => {
	async function ready(scripts: Scripts = {}) {
		const keyPath = putKey(DEDICATED_KEY_NAME);
		const t = build({
			saved: { projectAddress: ADDRESS, keyPath, username: 'ana', testedFor: { keyPath, address: ADDRESS } },
			...scripts,
		});
		await t.controller.refresh();
		return { t, keyPath };
	}

	it('connects the project it was given, says so on the connect step, and refreshes', async () => {
		let connected = false;
		const { t } = await ready({ repo: { vaultConnected: async () => connected } });
		t.env.connect = async (_git, address) => {
			t.connects.push(address.sshUrl);
			connected = true;
			return { ok: true, message: AUTHOR_MESSAGES.vaultConnected };
		};

		await t.controller.connect();

		expect(t.connects).toEqual([ADDRESS]);
		expect(t.holder.current.notice).toEqual({ step: 4, text: AUTHOR_MESSAGES.vaultConnected });
		expect(t.holder.current.facts.vaultConnected).toBe(true);
		expect(t.holder.current.progress.complete[3]).toBe(true);
	});

	it('runs inside the busy slot as its own action', async () => {
		const { t } = await ready();

		await t.controller.connect();

		expect(t.ran).toEqual(['connect']);
	});

	it('hands the runner the chosen key, and tells the one-per-session notice that it worked', async () => {
		const { t, keyPath } = await ready();

		await t.controller.connect();

		const withKey = t.sshCommands.filter((c): c is string => c !== null);
		expect(withKey).toHaveLength(1);
		expect(withKey[0]).toContain(`'${keyPath}'`);
		expect(t.connectedHooks).toEqual(['connected']);
	});

	it('says a refusal on the connect step, and still says it after the message is replaced', async () => {
		const { t } = await ready({
			connect: { ok: false, kind: 'refused', reason: 'foreignOrigin', message: AUTHOR_MESSAGES.foreignOrigin },
		});

		await t.controller.connect();
		t.holder.setNotice(null);
		await t.controller.refresh();

		expect(t.holder.current.failures[4]?.message).toBe(AUTHOR_MESSAGES.foreignOrigin);
		expect(t.holder.current.progress.firstIncomplete).toBe(4);
		expect(t.connectedHooks).toEqual([]);
	});

	it('says a failure that is only about the moment on the connect step', async () => {
		const { t } = await ready({ connect: { ok: false, kind: 'failed', failure: 'server-unreachable' } });

		await t.controller.connect();

		expect(t.holder.current.notice).toEqual({ step: 4, text: AUTHOR_MESSAGES.serverUnreachable });
		expect(t.holder.current.failures).toEqual({});
	});

	it('sends the author to the key step when the server no longer accepts the key, and forgets the old test', async () => {
		const { t } = await ready({ connect: { ok: false, kind: 'failed', failure: 'key-rejected' } });

		await t.controller.connect();

		expect(t.holder.current.notice).toEqual({ step: 3, text: AUTHOR_MESSAGES.keyRejected });
		expect(t.data.testedFor).toBeUndefined();
	});

	it('does nothing but say what is missing when the earlier steps are not done', async () => {
		const t = build({ saved: { projectAddress: ADDRESS } });
		await t.controller.refresh();

		await t.controller.connect();

		expect(t.connects).toEqual([]);
		expect(t.holder.current.notice).toEqual({ step: 3, text: AUTHOR_MESSAGES.notReady });
	});

	it('says the check did not succeed, and releases the slot, when connecting throws', async () => {
		const { t } = await ready({ connectThrows: true });

		await expect(t.controller.connect()).resolves.toBeUndefined();

		expect(t.holder.current.notice).toEqual({ step: 4, text: AUTHOR_MESSAGES.setupUnexpected });
	});
});

describe('saving the name and email', () => {
	async function connected(scripts: Scripts = {}) {
		const t = build({ repo: { vaultConnected: async () => true }, ...scripts });
		await t.controller.refresh();
		return t;
	}

	it('saves both for this vault, says so, and reads setup again', async () => {
		const t = await connected();

		const saved = await t.controller.saveIdentity('  Ana Nguyen ', ' ana@example.com ');

		expect(saved).toBe(true);
		expect(t.identitySaves).toEqual([{ name: '  Ana Nguyen ', email: ' ana@example.com ' }]);
		expect(t.holder.current.notice).toEqual({ step: 5, text: AUTHOR_MESSAGES.identitySaved });
	});

	it('refuses, and writes nothing, before the vault is connected', async () => {
		const t = build();
		await t.controller.refresh();

		expect(await t.controller.saveIdentity('Ana', 'ana@example.com')).toBe(false);
		expect(t.identitySaves).toEqual([]);
		expect(t.holder.current.notice).toEqual({ step: 5, text: AUTHOR_MESSAGES.identityReadonly });
	});

	for (const [label, name, email] of [
		['an empty name', '  ', 'ana@example.com'],
		['an empty email', 'Ana', ''],
		['an email that is not one', 'Ana', 'ana at example'],
		['a name with a line break', 'Ana\n[core]', 'ana@example.com'],
		['an email with a space', 'Ana', 'ana @example.com'],
	] as const) {
		it(`refuses ${label}, and writes nothing`, async () => {
			const t = await connected();

			expect(await t.controller.saveIdentity(name, email)).toBe(false);
			expect(t.identitySaves).toEqual([]);
			expect(t.holder.current.notice).toEqual({ step: 5, text: AUTHOR_MESSAGES.identityInvalid });
		});
	}

	it('says the check did not succeed when git will not write it', async () => {
		const t = await connected({ saveIdentity: { ok: false, failure: 'unexpected' } });

		expect(await t.controller.saveIdentity('Ana', 'ana@example.com')).toBe(false);
		expect(t.holder.current.notice).toEqual({ step: 5, text: AUTHOR_MESSAGES.setupUnexpected });
	});
});

describe('checking again', () => {
	it('forgets the git complaint and looks again', async () => {
		const t = build({ gitInstalled: true });
		t.holder.setFacts({ ...t.holder.current.facts, gitInstalled: true });
		t.holder.failStep(1, AUTHOR_MESSAGES.gitMissing);
		expect(t.holder.current.progress.firstIncomplete).toBe(1);

		await t.controller.checkAgain();

		expect(t.holder.current.progress.complete[0]).toBe(true);
		expect(t.holder.current.notice).toBeNull();
	});
});

describe('a failure met by some other action later', () => {
	it('sends the author back to the matching step and says why', () => {
		const t = build();

		t.controller.reportFailure('key-rejected');

		expect(t.holder.current.failures[3]?.message).toBe(AUTHOR_MESSAGES.keyRejected);
		expect(t.holder.current.notice).toEqual({ step: 3, text: AUTHOR_MESSAGES.keyRejected });
	});

	it('forgets a test result the server no longer honours, so a restart does not bring the step back', async () => {
		const keyPath = putKey(DEDICATED_KEY_NAME);
		const t = build({ saved: { projectAddress: ADDRESS, keyPath, username: 'ana', testedFor: { keyPath, address: ADDRESS } } });

		await t.controller.reportFailureAndForget('key-rejected');

		expect(t.data.testedFor).toBeUndefined();
	});

	it('does not touch setup for a failure that is only about the moment', () => {
		const t = build();

		t.controller.reportFailure('server-unreachable');

		expect(t.holder.current.failures).toEqual({});
	});
});

describe('reading setup while something else is going on', () => {
	/** A `vaultConnected` whose first call waits until `release` is called, so a read can be held part-way through. */
	function heldFirstRead() {
		let reads = 0;
		let release: () => void = () => undefined;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		return {
			count: () => reads,
			release: () => release(),
			vaultConnected: async () => {
				reads += 1;
				if (reads === 1) {
					await held;
				}
				return false;
			},
		};
	}

	it('reads again after a request that arrived mid-read, so the last answer is not stale', async () => {
		const slow = heldFirstRead();
		const t = build({ saved: { projectAddress: ADDRESS }, repo: { vaultConnected: slow.vaultConnected } });

		const first = t.controller.refresh();
		// The author changes a setting while the first read is part-way through it.
		await t.settings.save({ projectAddress: undefined });
		const second = t.controller.refresh();
		slow.release();
		await Promise.all([first, second]);

		expect(slow.count()).toBe(2);
		expect(t.holder.current.facts.address).toBeNull();
	});

	it('does not start a third read for any number of requests made during one', async () => {
		const slow = heldFirstRead();
		const t = build({ repo: { vaultConnected: slow.vaultConnected } });

		const all = [t.controller.refresh(), t.controller.refresh(), t.controller.refresh(), t.controller.refresh()];
		slow.release();
		await Promise.all(all);

		expect(slow.count()).toBe(2);
	});

	it('is not checked until the first read, and is afterwards', async () => {
		const t = build();
		expect(t.holder.current.checked).toBe(false);

		await t.controller.refresh();

		expect(t.holder.current.checked).toBe(true);
	});

	it('refuses a second press of Test while the first is running, through the real busy slot', async () => {
		const keyPath = putKey(DEDICATED_KEY_NAME);
		const t = build({ saved: { projectAddress: ADDRESS, keyPath } });
		let release: () => void = () => undefined;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		const run: ProcessRunner = async (file, args, options) => {
			if (args.indexOf('-T') !== -1) {
				await held;
			}
			return t.env.run(file, args, options);
		};
		const controller = new SetupController({ ...t.env, run, slot: new ActionSlot() });

		const first = controller.testKey();
		await new Promise((resolve) => setTimeout(resolve, 30));
		await controller.testKey();
		release();
		await first;

		expect(t.gitCalls.filter((c) => c.args[0] === 'ls-remote')).toHaveLength(1);
	});

	it('does not leave the busy slot taken when a listener throws as the action starts', async () => {
		const keyPath = putKey(DEDICATED_KEY_NAME);
		const t = build({ saved: { projectAddress: ADDRESS, keyPath } });
		const slot = new ActionSlot();
		slot.onChange(() => {
			throw new Error('a redraw failed');
		});
		const controller = new SetupController({ ...t.env, slot });

		await controller.testKey();

		expect(slot.current).toBeNull();
	});
});
