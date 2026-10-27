// Plain specifiers; see the note in `git-runner.ts`.
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { GitRunner } from '../git-publishing/git-runner';

/**
 * Merging two edited versions of a text against their common base
 * (replace-rest-with-local-git-ssh task 4.3; git-publishing "Two edited versions
 * of a text can be merged against their common base").
 *
 * Done on three copies in a folder of its own, outside the vault, with the
 * result read from standard output: `merge-file` without `-p` would write the
 * merge over its first file, and the runner refuses it. A merge that does not
 * come out clean is never written anywhere, so no conflict marker can reach a
 * note, and the caller asks the author instead.
 */
export type MergeResult = { kind: 'clean'; text: Uint8Array } | { kind: 'overlap' } | { kind: 'not-text' } | { kind: 'failed' };

const DECODER = new TextDecoder('utf-8', { fatal: true });

/** Text, for this purpose, is valid UTF-8 with no NUL: anything else is asked about, never merged. */
export function isText(bytes: Uint8Array): boolean {
	if (bytes.indexOf(0) !== -1) {
		return false;
	}
	try {
		DECODER.decode(bytes);
		return true;
	} catch {
		return false;
	}
}

export async function mergeText(
	git: GitRunner,
	cwd: string,
	base: Uint8Array,
	mine: Uint8Array,
	theirs: Uint8Array
): Promise<MergeResult> {
	if (!isText(base) || !isText(mine) || !isText(theirs)) {
		return { kind: 'not-text' };
	}
	const scratch = await mkdtemp(join(tmpdir(), 'docs-publisher-merge-'));
	try {
		const files = { mine: join(scratch, 'mine'), base: join(scratch, 'base'), theirs: join(scratch, 'theirs') };
		await writeFile(files.mine, mine);
		await writeFile(files.base, base);
		await writeFile(files.theirs, theirs);
		const result = await git.run({
			args: ['merge-file', '-p', '-q', '-L', 'mine', '-L', 'base', '-L', 'theirs', files.mine, files.base, files.theirs],
			cwd,
		});
		if (result.spawnError !== null || result.timedOut || result.truncated) {
			return { kind: 'failed' };
		}
		// 0 is a clean merge; a positive number below 128 counts the overlaps.
		if (result.exitCode === 0) {
			return { kind: 'clean', text: new Uint8Array(result.stdout) };
		}
		return result.exitCode !== null && result.exitCode > 0 && result.exitCode < 128 ? { kind: 'overlap' } : { kind: 'failed' };
	} finally {
		await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
	}
}
