// Plain specifier; see the note in `git-runner.ts`.
import { createHash } from 'crypto';

/**
 * The identifier git gives a file's bytes, computed here
 * (replace-rest-with-local-git-ssh design.md D4, task 2.2).
 *
 * It is `sha1("blob <length>\0" + bytes)`, the same for every input including
 * the empty file, LF and CRLF text and binary data, because git hashes the
 * bytes it is given. Computing it in the plugin is what lets a note be compared
 * with a listing of the project without starting a process, which matters
 * because the comparison happens on every redraw of the panel.
 *
 * SHA-1 only. A project whose repository uses SHA-256 object identifiers is
 * refused when connecting, so no identifier computed here is ever compared with
 * one of another length.
 */
export function blobId(bytes: Uint8Array): string {
	const hash = createHash('sha1');
	hash.update(`blob ${bytes.length}\0`);
	hash.update(bytes);
	return hash.digest('hex');
}
