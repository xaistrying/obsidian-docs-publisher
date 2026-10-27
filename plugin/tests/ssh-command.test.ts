import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sshArguments, sshCommand } from '../src/git-publishing/ssh-command';

/**
 * Splits a command the way a POSIX shell does for the only constructs
 * `sshCommand` is allowed to emit: bare words and single-quoted runs. Anything
 * else it meets is a bug in the builder, so it throws rather than guessing
 * — a test that quietly tolerated a double quote would pass a command a real
 * shell reads differently.
 */
function shellSplit(command: string): string[] {
	const words: string[] = [];
	let current = '';
	let inWord = false;
	let i = 0;
	while (i < command.length) {
		const ch = command[i];
		if (ch === "'") {
			const end = command.indexOf("'", i + 1);
			if (end === -1) {
				throw new Error('unterminated single quote');
			}
			current += command.slice(i + 1, end);
			inWord = true;
			i = end + 1;
		} else if (ch === ' ') {
			if (inWord) {
				words.push(current);
				current = '';
				inWord = false;
			}
			i += 1;
		} else if (ch === '\\' && command[i + 1] === "'") {
			// The one escape the builder emits: a literal quote written as
			// close-quote, backslash-quote, reopen-quote (`'\''`).
			current += "'";
			inWord = true;
			i += 2;
		} else if (ch === '"' || ch === '\\' || ch === '$' || ch === '`') {
			throw new Error(`unquoted shell metacharacter ${ch} in: ${command}`);
		} else {
			current += ch;
			inWord = true;
			i += 1;
		}
	}
	if (inWord) {
		words.push(current);
	}
	return words;
}

const FIXED = [
	'-o',
	'IdentitiesOnly=yes',
	'-o',
	'BatchMode=yes',
	'-o',
	'StrictHostKeyChecking=accept-new',
	'-o',
	'ConnectTimeout=15',
	'-o',
	'ForwardAgent=no',
	'-o',
	'ClearAllForwardings=yes',
	'-o',
	'ForwardX11=no',
];

describe('building the ssh command Git runs through a shell', () => {
	const awkwardPaths: Array<[string, string]> = [
		['a plain path', '/home/ana/.ssh/docs-publisher_ed25519'],
		['a space in the user folder', '/home/Trai Pham/.ssh/key'],
		['Vietnamese diacritics', '/home/Trần Phạm/.ssh/khóa'],
		['a single quote', "/home/O'Brien/.ssh/key"],
		['a trailing space', '/home/ana/.ssh/key '],
		['a dollar sign', '/home/$HOME/.ssh/key'],
		['a backtick and a semicolon', '/home/a`b;c/.ssh/key'],
		['glob characters', '/home/*/?/[x]/key'],
	];

	for (const [label, keyPath] of awkwardPaths) {
		it(`round-trips ${label} to the exact path`, () => {
			const command = sshCommand({ keyPath, platform: 'posix' });

			expect(shellSplit(command)).toEqual(['ssh', '-i', keyPath, ...FIXED]);
		});
	}

	it('writes a Windows path with forward slashes, which both ssh builds accept', () => {
		const command = sshCommand({ keyPath: 'C:\\Users\\Trai Pham\\.ssh\\key', platform: 'windows' });

		expect(shellSplit(command)).toEqual(['ssh', '-i', 'C:/Users/Trai Pham/.ssh/key', ...FIXED]);
	});

	it('keeps a UNC path a UNC path', () => {
		const command = sshCommand({ keyPath: '\\\\server\\share\\key', platform: 'windows' });

		expect(shellSplit(command)[2]).toBe('//server/share/key');
	});

	it('quotes the ssh program too, for an install with a space in its path', () => {
		const command = sshCommand({
			keyPath: '/k',
			sshProgram: 'C:\\Program Files\\Git\\usr\\bin\\ssh.exe',
			platform: 'windows',
		});

		expect(shellSplit(command)[0]).toBe('C:/Program Files/Git/usr/bin/ssh.exe');
	});

	it('refuses a key path that contains a control character', () => {
		expect(() => sshCommand({ keyPath: '/home/a\nb/key', platform: 'posix' })).toThrow(/control character/);
		expect(() => sshCommand({ keyPath: '/home/a\0b/key', platform: 'posix' })).toThrow(/control character/);
	});

	it('refuses an empty key path rather than emitting `-i ""`', () => {
		expect(() => sshCommand({ keyPath: '', platform: 'posix' })).toThrow(/empty/);
	});

	it('always selects only the chosen key, never prompts, and bounds the connect', () => {
		const words = shellSplit(sshCommand({ keyPath: '/k', platform: 'posix' }));

		expect(words).toContain('IdentitiesOnly=yes');
		expect(words).toContain('BatchMode=yes');
		expect(words).toContain('StrictHostKeyChecking=accept-new');
		expect(words).toContain('ConnectTimeout=15');
	});

	it('gives the same options as an argument list for spawning ssh directly', () => {
		expect(sshArguments('/home/Trai Pham/.ssh/key')).toEqual(['-i', '/home/Trai Pham/.ssh/key', ...FIXED]);
	});

	// The strongest check available: hand the string to a real shell and see
	// what a program receives. The fake `ssh` prints one argument per line, so
	// a path that a shell split in two shows up as two lines.
	it.skipIf(process.platform === 'win32')('is read by a real shell as exactly those arguments', () => {
		const dir = mkdtempSync(join(tmpdir(), 'sshcmd-'));
		try {
			const fake = join(dir, 'ssh');
			writeFileSync(fake, '#!/bin/sh\nfor a in "$@"; do printf "%s\\n" "$a"; done\n');
			chmodSync(fake, 0o755);

			const keyPath = "/home/Trần O'Brien $x/.ssh/key ";
			const command = sshCommand({ keyPath, platform: 'posix' });
			const output = execFileSync('sh', ['-c', `${command} git@example.com`], {
				env: { PATH: `${dir}:/usr/bin:/bin` },
				encoding: 'utf8',
			});

			expect(output.split('\n').slice(0, -1)).toEqual([
				'-i',
				keyPath,
				...FIXED,
				'git@example.com',
			]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
