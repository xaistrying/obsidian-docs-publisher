import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { VaultIO } from '../../src/vault-sync/get-updates';

/**
 * The vault as the update engine sees it, over a real folder, with the failures
 * an update has to survive switchable by a test: a path the system refuses, a
 * note with unsaved changes, a copy that cannot be made, and a file system that
 * treats names differing only in case as one file.
 */
export interface FsVaultOptions {
	refuseWrite?: (path: string) => boolean;
	unsaved?: ReadonlySet<string>;
	failCopy?: boolean;
	caseInsensitive?: boolean;
}

export interface FsVault extends VaultIO {
	root: string;
	writes: string[];
	trashed: string[];
	copies: Array<{ path: string; stamp: string }>;
	options: FsVaultOptions;
	text(path: string): string | null;
}

export function fsVault(root: string, options: FsVaultOptions = {}): FsVault {
	const writes: string[] = [];
	const trashed: string[] = [];
	const copies: Array<{ path: string; stamp: string }> = [];

	const walk = (dir: string, prefix: string, found: string[]): string[] => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			// Folders that begin with a dot are not the vault's notes: the repository,
			// the settings and the trash.
			if (prefix === '' && entry.name.startsWith('.')) {
				continue;
			}
			if (entry.isDirectory()) {
				walk(join(dir, entry.name), `${prefix}${entry.name}/`, found);
			} else {
				found.push(`${prefix}${entry.name}`);
			}
		}
		return found;
	};

	const vault: FsVault = {
		root,
		writes,
		trashed,
		copies,
		options,
		text: (path) => (existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : null),
		read: async (path) => (existsSync(join(root, path)) ? new Uint8Array(readFileSync(join(root, path))) : null),
		write: async (path, bytes) => {
			if (options.refuseWrite?.(path) === true) {
				throw new Error(`the system refuses ${path}`);
			}
			mkdirSync(dirname(join(root, path)), { recursive: true });
			writeFileSync(join(root, path), bytes);
			writes.push(path);
		},
		trash: async (path) => {
			const destination = join(root, '.trash', path);
			mkdirSync(dirname(destination), { recursive: true });
			renameSync(join(root, path), destination);
			trashed.push(path);
		},
		saveCopy: async (path, bytes, stamp) => {
			if (options.failCopy === true) {
				throw new Error('no copy');
			}
			const destination = join(root, '.trash', 'Docs Publisher', stamp, path);
			mkdirSync(dirname(destination), { recursive: true });
			writeFileSync(destination, bytes);
			copies.push({ path, stamp });
		},
		isUnsaved: async (path) => options.unsaved?.has(path) === true,
		allPaths: async () => walk(root, '', []),
		caseInsensitive: async () => options.caseInsensitive === true,
	};
	return vault;
}
