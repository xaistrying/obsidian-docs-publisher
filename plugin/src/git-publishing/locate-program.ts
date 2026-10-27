// Plain specifiers; see the note in `git-runner.ts`.
import { posix, win32 } from 'path';

export type ProgramPlatform = 'windows' | 'posix';

export function thisPlatform(): ProgramPlatform {
	return process.platform === 'win32' ? 'windows' : 'posix';
}

/** The value of an environment variable by name, without regard to case: Windows spells it `Path` as often as `PATH`. */
export function envValue(env: Record<string, string | undefined>, name: string): string | undefined {
	const wanted = name.toLowerCase();
	for (const key of Object.keys(env)) {
		if (key.toLowerCase() === wanted) {
			return env[key];
		}
	}
	return undefined;
}

/**
 * The folders of a search path that name one place, whatever the working
 * folder is. An empty entry and a relative one such as `.` both mean "here" to
 * the platform's own search, and here is the vault: a program found there would
 * be a file synced in with a note, not one the author installed. Windows goes
 * further than POSIX and looks in the working folder before it reads the path
 * at all, which is why programs are located by this function and started by the
 * absolute path it returns, never by name.
 *
 * Windows quotes entries that hold a `;` or a space, and the quotes are not
 * part of the folder.
 */
export function absoluteDirs(pathEnv: string, platform: ProgramPlatform): string[] {
	const path = platform === 'windows' ? win32 : posix;
	const delimiter = platform === 'windows' ? ';' : ':';
	const dirs: string[] = [];
	for (const entry of pathEnv.split(delimiter)) {
		const dir = platform === 'windows' ? entry.replace(/^"(.*)"$/, '$1') : entry;
		if (dir !== '' && path.isAbsolute(dir)) {
			dirs.push(dir);
		}
	}
	return dirs;
}

/** The first folder that holds the file, as a full path, or null. */
export function findInDirs(
	file: string,
	dirs: ReadonlyArray<string>,
	platform: ProgramPlatform,
	exists: (path: string) => boolean
): string | null {
	const path = platform === 'windows' ? win32 : posix;
	for (const dir of dirs) {
		const candidate = path.join(dir, file);
		if (exists(candidate)) {
			return candidate;
		}
	}
	return null;
}

/**
 * Where a freshly installed git lives when the running Obsidian cannot see it
 * yet: a program's `PATH` is a copy taken when it started, so an author who
 * installs Git and comes back to the panel would otherwise be told it is still
 * missing until they restart. These are the places the installers put it.
 */
function installFolders(env: Record<string, string | undefined>, platform: ProgramPlatform): string[] {
	if (platform === 'posix') {
		return ['/usr/bin', '/usr/local/bin', '/opt/homebrew/bin'];
	}
	const folders: string[] = [];
	const programFiles = envValue(env, 'ProgramFiles');
	const programFilesX86 = envValue(env, 'ProgramFiles(x86)');
	const localAppData = envValue(env, 'LocalAppData');
	if (programFiles !== undefined) {
		folders.push(win32.join(programFiles, 'Git', 'cmd'));
	}
	if (programFilesX86 !== undefined) {
		folders.push(win32.join(programFilesX86, 'Git', 'cmd'));
	}
	if (localAppData !== undefined) {
		folders.push(win32.join(localAppData, 'Programs', 'Git', 'cmd'));
	}
	return folders.filter((folder) => win32.isAbsolute(folder));
}

/** git's full path from the search path first, then the install folders; null when it is not installed. */
export function locateGit(
	env: Record<string, string | undefined>,
	platform: ProgramPlatform,
	exists: (path: string) => boolean
): string | null {
	const file = platform === 'windows' ? 'git.exe' : 'git';
	const fromPath = findInDirs(file, absoluteDirs(envValue(env, 'PATH') ?? '', platform), platform, exists);
	return fromPath ?? findInDirs(file, installFolders(env, platform), platform, exists);
}
