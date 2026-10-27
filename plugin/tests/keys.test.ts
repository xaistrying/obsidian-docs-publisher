import { execFileSync, spawnSync } from 'node:child_process';
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProcessResult, ProcessRunner } from '../src/git-publishing/git-runner';
import {
	DEDICATED_KEY_NAME,
	createDedicatedKey,
	findKeys,
	locateSshTool,
	probeKeyProtection,
	readPublicKey,
} from '../src/git-publishing/keys';

const HAS_SSH_KEYGEN = spawnSync('ssh-keygen', ['-?'], { encoding: 'utf8' }).error === undefined;
const IS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0;

let home: string;
let sshDir: string;
beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), 'keys-'));
	sshDir = join(home, '.ssh');
});
afterEach(() => {
	rmSync(home, { recursive: true, force: true });
});

/** A real key made by the real tool, so the tests do not assume what a key file looks like. */
function makeKey(name: string, passphrase = ''): void {
	mkdirSync(sshDir, { recursive: true });
	execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', passphrase, '-C', 'test', '-f', join(sshDir, name)]);
}

describe('finding the keys an author already has', () => {
	it.skipIf(!HAS_SSH_KEYGEN)('lists them in the order the plugin prefers: its own, then ed25519, then rsa', async () => {
		makeKey('id_rsa');
		makeKey('id_ed25519');
		makeKey(DEDICATED_KEY_NAME);

		const keys = await findKeys(sshDir);

		expect(keys.map((k) => k.kind)).toEqual(['dedicated', 'ed25519', 'rsa']);
		expect(keys[0].path).toBe(join(sshDir, DEDICATED_KEY_NAME));
		expect(keys[0].publicPath).toBe(join(sshDir, `${DEDICATED_KEY_NAME}.pub`));
	});

	it('lists only the keys that exist', async () => {
		mkdirSync(sshDir, { recursive: true });
		writeFileSync(join(sshDir, 'id_rsa'), 'x');

		expect((await findKeys(sshDir)).map((k) => k.kind)).toEqual(['rsa']);
	});

	it('finds nothing in a folder that does not exist, rather than failing', async () => {
		expect(await findKeys(join(home, 'no-such-folder'))).toEqual([]);
	});

	it('ignores a folder that merely has a key\'s name', async () => {
		mkdirSync(join(sshDir, 'id_ed25519'), { recursive: true });

		expect(await findKeys(sshDir)).toEqual([]);
	});

	it.skipIf(IS_ROOT)('lists a key without opening its private file', async () => {
		mkdirSync(sshDir, { recursive: true });
		const privateFile = join(sshDir, 'id_ed25519');
		writeFileSync(privateFile, 'not really a key');
		chmodSync(privateFile, 0o000);
		try {
			const keys = await findKeys(sshDir);

			expect(keys).toHaveLength(1);
		} finally {
			chmodSync(privateFile, 0o600);
		}
	});
});

describe('creating the plugin\'s own key', () => {
	it.skipIf(!HAS_SSH_KEYGEN)('makes the key pair and creates the folder when it is missing', async () => {
		const result = await createDedicatedKey(sshDir, 'ssh-keygen');

		expect(result.ok).toBe(true);
		expect(existsSync(join(sshDir, DEDICATED_KEY_NAME))).toBe(true);
		expect(existsSync(join(sshDir, `${DEDICATED_KEY_NAME}.pub`))).toBe(true);
	});

	it.skipIf(!HAS_SSH_KEYGEN || process.platform === 'win32')('keeps the private key to its owner', async () => {
		await createDedicatedKey(sshDir, 'ssh-keygen');

		expect(statSync(join(sshDir, DEDICATED_KEY_NAME)).mode & 0o077).toBe(0);
	});

	it.skipIf(!HAS_SSH_KEYGEN)('works in a user folder with a space in its name', async () => {
		const spaced = join(home, 'Trai Pham', '.ssh');

		const result = await createDedicatedKey(spaced, 'ssh-keygen');

		expect(result.ok).toBe(true);
		expect(existsSync(join(spaced, DEDICATED_KEY_NAME))).toBe(true);
	});

	it.skipIf(!HAS_SSH_KEYGEN)('refuses to overwrite an existing key and leaves it exactly as it was', async () => {
		makeKey(DEDICATED_KEY_NAME);
		const before = readFileSync(join(sshDir, DEDICATED_KEY_NAME));
		const publicBefore = readFileSync(join(sshDir, `${DEDICATED_KEY_NAME}.pub`));

		const result = await createDedicatedKey(sshDir, 'ssh-keygen');

		expect(result).toEqual({ ok: false, failure: 'key-exists' });
		expect(readFileSync(join(sshDir, DEDICATED_KEY_NAME)).equals(before)).toBe(true);
		expect(readFileSync(join(sshDir, `${DEDICATED_KEY_NAME}.pub`)).equals(publicBefore)).toBe(true);
	});

	it('refuses when only the public half exists, so no pair is ever half replaced', async () => {
		mkdirSync(sshDir, { recursive: true });
		writeFileSync(join(sshDir, `${DEDICATED_KEY_NAME}.pub`), 'ssh-ed25519 AAAA keep-me');

		const result = await createDedicatedKey(sshDir, 'ssh-keygen');

		expect(result.ok).toBe(false);
		expect(readFileSync(join(sshDir, `${DEDICATED_KEY_NAME}.pub`), 'utf8')).toBe('ssh-ed25519 AAAA keep-me');
		expect(existsSync(join(sshDir, DEDICATED_KEY_NAME))).toBe(false);
	});

	it('reports a missing ssh-keygen as such', async () => {
		const result = await createDedicatedKey(sshDir, join(home, 'no-ssh-keygen'));

		expect(result).toEqual({ ok: false, failure: 'ssh-missing' });
	});

	// The pair is made apart and put in place without replacing anything, so
	// none of what could appear at its name between the check and the write can
	// be written through.
	describe('against something that appears at its name', () => {
		// The refusals are logged for support, and are the point of these tests.
		beforeEach(() => {
			vi.spyOn(console, 'error').mockImplementation(() => undefined);
		});
		afterEach(() => {
			vi.restoreAllMocks();
		});

		const ok: ProcessResult = { exitCode: 0, stdout: Buffer.alloc(0), stderr: '', timedOut: false, truncated: false, spawnError: null };

		/** Stands in for ssh-keygen: writes the pair where it was told, then lets a test do something else. */
		function keygen(also?: (target: string) => void): ProcessRunner {
			return async (_file, args) => {
				const target = args[args.indexOf('-f') + 1];
				writeFileSync(target, 'MADE-PRIVATE', { mode: 0o600 });
				writeFileSync(`${target}.pub`, 'ssh-ed25519 AAAA made');
				also?.(target);
				return ok;
			};
		}

		it('puts the pair in place and leaves nothing else in the folder', async () => {
			const result = await createDedicatedKey(sshDir, 'ssh-keygen', keygen());

			expect(result.ok).toBe(true);
			expect(readdirSync(sshDir).sort()).toEqual([DEDICATED_KEY_NAME, `${DEDICATED_KEY_NAME}.pub`]);
			expect(readFileSync(join(sshDir, DEDICATED_KEY_NAME), 'utf8')).toBe('MADE-PRIVATE');
		});

		it.skipIf(process.platform === 'win32')('keeps the private half to its owner after it is put in place', async () => {
			await createDedicatedKey(sshDir, 'ssh-keygen', keygen());

			expect(statSync(join(sshDir, DEDICATED_KEY_NAME)).mode & 0o077).toBe(0);
		});

		it('leaves nothing behind when ssh-keygen fails', async () => {
			const failing: ProcessRunner = async () => ({ ...ok, exitCode: 1, stderr: 'boom' });

			const result = await createDedicatedKey(sshDir, 'ssh-keygen', failing);

			expect(result.ok).toBe(false);
			expect(readdirSync(sshDir)).toEqual([]);
		});

		it('leaves nothing behind when ssh-keygen says it worked and wrote nothing', async () => {
			const lying: ProcessRunner = async () => ok;

			const result = await createDedicatedKey(sshDir, 'ssh-keygen', lying);

			expect(result).toEqual({ ok: false, failure: 'unexpected' });
			expect(readdirSync(sshDir)).toEqual([]);
		});

		it.skipIf(process.platform === 'win32')('refuses a link to nowhere at the key\'s name, and writes nothing through it', async () => {
			mkdirSync(sshDir, { recursive: true });
			const elsewhere = join(home, 'victim');
			symlinkSync(elsewhere, join(sshDir, DEDICATED_KEY_NAME));

			const result = await createDedicatedKey(sshDir, 'ssh-keygen', keygen());

			expect(result).toEqual({ ok: false, failure: 'key-exists' });
			expect(existsSync(elsewhere)).toBe(false);
		});

		it.skipIf(process.platform === 'win32')('refuses a link at the public half\'s name too', async () => {
			mkdirSync(sshDir, { recursive: true });
			const elsewhere = join(home, 'victim.pub');
			symlinkSync(elsewhere, join(sshDir, `${DEDICATED_KEY_NAME}.pub`));

			const result = await createDedicatedKey(sshDir, 'ssh-keygen', keygen());

			expect(result).toEqual({ ok: false, failure: 'key-exists' });
			expect(existsSync(elsewhere)).toBe(false);
		});

		it('does not replace a key that appears while ssh-keygen is running', async () => {
			const result = await createDedicatedKey(
				sshDir,
				'ssh-keygen',
				keygen(() => writeFileSync(join(sshDir, DEDICATED_KEY_NAME), 'AUTHORS-OWN-KEY'))
			);

			expect(result).toEqual({ ok: false, failure: 'key-exists' });
			expect(readFileSync(join(sshDir, DEDICATED_KEY_NAME), 'utf8')).toBe('AUTHORS-OWN-KEY');
			expect(existsSync(join(sshDir, `${DEDICATED_KEY_NAME}.pub`))).toBe(false);
		});

		it('takes the private half back out when the public half turns out to be taken', async () => {
			const result = await createDedicatedKey(
				sshDir,
				'ssh-keygen',
				keygen(() => writeFileSync(join(sshDir, `${DEDICATED_KEY_NAME}.pub`), 'ssh-ed25519 AAAA keep-me'))
			);

			expect(result).toEqual({ ok: false, failure: 'key-exists' });
			expect(existsSync(join(sshDir, DEDICATED_KEY_NAME))).toBe(false);
			expect(readFileSync(join(sshDir, `${DEDICATED_KEY_NAME}.pub`), 'utf8')).toBe('ssh-ed25519 AAAA keep-me');
			expect(readdirSync(sshDir)).toEqual([`${DEDICATED_KEY_NAME}.pub`]);
		});
	});
});

describe('reading the part of a key that is meant to be shared', () => {
	it.skipIf(!HAS_SSH_KEYGEN)('returns the public key as one line', async () => {
		makeKey('id_ed25519');
		const [key] = await findKeys(sshDir);

		const text = await readPublicKey(key);

		expect(text).toMatch(/^ssh-ed25519 [A-Za-z0-9+/=]+ test$/);
	});

	it('returns nothing when there is no public file, rather than reading the private one', async () => {
		mkdirSync(sshDir, { recursive: true });
		// Begins like a public key on purpose: a fallback that read this file
		// would find a line it accepts, and the test would see it returned.
		writeFileSync(join(sshDir, 'id_ed25519'), 'ssh-ed25519 PRIVATE-BYTES-THAT-MUST-NOT-APPEAR');
		const [key] = await findKeys(sshDir);

		expect(await readPublicKey(key)).toBeNull();
	});
});

describe('telling a key with a password from one without', () => {
	it.skipIf(!HAS_SSH_KEYGEN)('calls a key with no password open', async () => {
		makeKey('plain');

		expect(await probeKeyProtection(join(sshDir, 'plain'), 'ssh-keygen')).toBe('open');
	});

	it.skipIf(!HAS_SSH_KEYGEN)('calls a key with a password protected', async () => {
		makeKey('locked', 'a password');

		expect(await probeKeyProtection(join(sshDir, 'locked'), 'ssh-keygen')).toBe('protected');
	});

	it.skipIf(!HAS_SSH_KEYGEN)('calls a key that is not there unreadable, which is not the same as protected', async () => {
		expect(await probeKeyProtection(join(sshDir, 'nothing'), 'ssh-keygen')).toBe('unreadable');
	});

	it('calls the probe unreadable when ssh-keygen cannot be started', async () => {
		expect(await probeKeyProtection(join(sshDir, 'k'), join(home, 'no-ssh-keygen'))).toBe('unreadable');
	});

	it.skipIf(!HAS_SSH_KEYGEN)('never returns the key material it asked ssh-keygen to read', async () => {
		makeKey('plain');
		const answer = await probeKeyProtection(join(sshDir, 'plain'), 'ssh-keygen');

		expect(JSON.stringify(answer)).not.toMatch(/ssh-ed25519|AAAA/);
	});
});

describe('finding ssh and ssh-keygen on a machine', () => {
	const posixFiles = new Set(['/usr/bin/ssh', '/opt/tools/ssh-keygen']);

	it('takes the first match on PATH', () => {
		const found = locateSshTool('ssh', {
			pathEnv: '/nowhere:/usr/bin:/opt/tools',
			platform: 'posix',
			exists: (p) => posixFiles.has(p),
			gitExecPath: null,
		});

		expect(found).toBe('/usr/bin/ssh');
	});

	it('adds .exe on Windows when it searches PATH', () => {
		const found = locateSshTool('ssh', {
			pathEnv: 'C:\\Windows\\System32;C:\\Windows\\System32\\OpenSSH',
			platform: 'windows',
			exists: (p) => p === 'C:\\Windows\\System32\\OpenSSH\\ssh.exe',
			gitExecPath: null,
		});

		expect(found).toBe('C:\\Windows\\System32\\OpenSSH\\ssh.exe');
	});

	it('falls back to the copy inside Git for Windows when PATH has none', () => {
		const found = locateSshTool('ssh-keygen', {
			pathEnv: 'C:\\Windows\\System32',
			platform: 'windows',
			exists: (p) => p === 'C:\\Program Files\\Git\\usr\\bin\\ssh-keygen.exe',
			gitExecPath: 'C:\\Program Files\\Git\\mingw64\\libexec\\git-core',
		});

		expect(found).toBe('C:\\Program Files\\Git\\usr\\bin\\ssh-keygen.exe');
	});

	it('returns nothing, rather than a guess, when it is nowhere', () => {
		const found = locateSshTool('ssh', {
			pathEnv: '/usr/bin',
			platform: 'posix',
			exists: () => false,
			gitExecPath: null,
		});

		expect(found).toBeNull();
	});

	it('ignores a relative PATH entry too, since it means the folder Obsidian happens to be running in', () => {
		const found = locateSshTool('ssh', {
			pathEnv: '.:bin:/nowhere',
			platform: 'posix',
			exists: (p) => p === './ssh' || p === 'bin/ssh' || p === 'ssh',
			gitExecPath: null,
		});

		expect(found).toBeNull();
	});

	it('ignores an empty PATH entry instead of searching the current folder', () => {
		const found = locateSshTool('ssh', {
			pathEnv: ':/usr/bin',
			platform: 'posix',
			exists: (p) => p === 'ssh' || p === '/ssh',
			gitExecPath: null,
		});

		expect(found).toBeNull();
	});
});
