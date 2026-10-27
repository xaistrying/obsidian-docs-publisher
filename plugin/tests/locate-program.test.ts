import { describe, expect, it } from 'vitest';
import { absoluteDirs, envValue, findInDirs, locateGit } from '../src/git-publishing/locate-program';

describe('which folders of a search path name one place', () => {
	it('keeps absolute folders and drops empty and relative ones on POSIX', () => {
		expect(absoluteDirs('/usr/bin::.:bin:../x:/opt/tools', 'posix')).toEqual(['/usr/bin', '/opt/tools']);
	});

	it('does the same on Windows, taking the quotes off and refusing a drive-relative folder', () => {
		expect(absoluteDirs('"C:\\Program Files\\Git\\cmd";;.;tools;C:tools;C:\\Windows', 'windows')).toEqual([
			'C:\\Program Files\\Git\\cmd',
			'C:\\Windows',
		]);
	});

	it('gives nothing for a path with nothing absolute in it', () => {
		expect(absoluteDirs('.:bin', 'posix')).toEqual([]);
		expect(absoluteDirs('', 'posix')).toEqual([]);
	});
});

describe('finding a program in folders', () => {
	it('returns the first folder that has it, as a full path', () => {
		const found = findInDirs('git', ['/a', '/b', '/c'], 'posix', (p) => p === '/b/git' || p === '/c/git');

		expect(found).toBe('/b/git');
	});

	it('returns nothing when no folder has it', () => {
		expect(findInDirs('git', ['/a'], 'posix', () => false)).toBeNull();
	});

	it('joins the way the platform does', () => {
		expect(findInDirs('git.exe', ['C:\\Git\\cmd'], 'windows', () => true)).toBe('C:\\Git\\cmd\\git.exe');
	});
});

describe('reading an environment variable', () => {
	it('matches the name without regard to case, as Windows does', () => {
		expect(envValue({ Path: 'x' }, 'PATH')).toBe('x');
		expect(envValue({ ProgramFiles: 'y' }, 'programfiles')).toBe('y');
	});

	it('returns nothing for a name that is not there', () => {
		expect(envValue({ A: '1' }, 'B')).toBeUndefined();
	});
});

describe('finding git', () => {
	const exists = (...found: string[]) => (path: string) => found.indexOf(path) !== -1;

	it('takes the first copy on the search path', () => {
		const found = locateGit({ PATH: '/opt/new:/usr/bin' }, 'posix', exists('/opt/new/git', '/usr/bin/git'));

		expect(found).toBe('/opt/new/git');
	});

	it('does not take a copy from the working folder, however the search path spells it', () => {
		const found = locateGit(
			{ PATH: '.:./bin::bin:/usr/bin' },
			'posix',
			exists('git', './git', 'bin/git', './bin/git', '/git')
		);

		expect(found).toBeNull();
	});

	it('looks for git.exe on Windows, under whichever spelling of Path the machine uses', () => {
		const found = locateGit({ Path: 'C:\\Windows;C:\\Tools\\Git\\cmd' }, 'windows', exists('C:\\Tools\\Git\\cmd\\git.exe'));

		expect(found).toBe('C:\\Tools\\Git\\cmd\\git.exe');
	});

	describe('when the search path has none, as after installing it while the program was running', () => {
		it('looks in the folders the Windows installers use', () => {
			const env = {
				Path: 'C:\\Windows',
				ProgramFiles: 'C:\\Program Files',
				'ProgramFiles(x86)': 'C:\\Program Files (x86)',
				LocalAppData: 'C:\\Users\\Ana\\AppData\\Local',
			};

			expect(locateGit(env, 'windows', exists('C:\\Program Files\\Git\\cmd\\git.exe'))).toBe('C:\\Program Files\\Git\\cmd\\git.exe');
			expect(locateGit(env, 'windows', exists('C:\\Program Files (x86)\\Git\\cmd\\git.exe'))).toBe(
				'C:\\Program Files (x86)\\Git\\cmd\\git.exe'
			);
			expect(locateGit(env, 'windows', exists('C:\\Users\\Ana\\AppData\\Local\\Programs\\Git\\cmd\\git.exe'))).toBe(
				'C:\\Users\\Ana\\AppData\\Local\\Programs\\Git\\cmd\\git.exe'
			);
		});

		it('looks in the usual folders on macOS and Linux, where a desktop app starts with a short path', () => {
			expect(locateGit({ PATH: '/usr/sbin' }, 'posix', exists('/opt/homebrew/bin/git'))).toBe('/opt/homebrew/bin/git');
			expect(locateGit({ PATH: '' }, 'posix', exists('/usr/bin/git'))).toBe('/usr/bin/git');
		});

		it('prefers a copy on the search path to one in an install folder', () => {
			const found = locateGit({ PATH: '/opt/new' }, 'posix', exists('/opt/new/git', '/usr/bin/git'));

			expect(found).toBe('/opt/new/git');
		});

		it('says it is not installed when none of those has it either', () => {
			expect(locateGit({ PATH: '/usr/bin' }, 'posix', () => false)).toBeNull();
			expect(locateGit({ Path: 'C:\\Windows' }, 'windows', () => false)).toBeNull();
		});

		it('does not invent an install folder from variables that are not set', () => {
			const asked: string[] = [];

			locateGit({ Path: 'C:\\Windows' }, 'windows', (p) => {
				asked.push(p);
				return false;
			});

			expect(asked).toEqual(['C:\\Windows\\git.exe']);
		});
	});
});
