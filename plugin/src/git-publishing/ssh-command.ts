/**
 * Which key Git uses, how it is told to, and what ssh is never allowed to do
 * while it does (replace-rest-with-local-git-ssh design.md D11).
 *
 * `IdentitiesOnly` makes ssh offer the one key it was given rather than every
 * key an agent holds, so a second key on the machine cannot be tried against
 * the project by accident. `BatchMode` turns every question into a refusal: a
 * GUI process has no terminal to answer on, so the alternative to refusing is
 * hanging with the busy slot held. `accept-new` trusts a host the first time
 * and refuses it if its key later changes, which is the trade-off the design
 * records. `ConnectTimeout` bounds the one wait ssh does not bound itself.
 */
const FIXED_OPTIONS: ReadonlyArray<string> = [
	'IdentitiesOnly=yes',
	'BatchMode=yes',
	'StrictHostKeyChecking=accept-new',
	'ConnectTimeout=15',
	// Nothing about this connection may reach beyond it, whatever the author's
	// own ssh settings say: a command-line option wins over `ssh_config`. A
	// publish needs one authenticated session and has no use for a forwarded
	// agent, port or display, and a project address that has been tampered with
	// would otherwise be handed all three.
	'ForwardAgent=no',
	'ClearAllForwardings=yes',
	'ForwardX11=no',
];

export interface SshCommandOptions {
	keyPath: string;
	/**
	 * The ssh program when it is not on `PATH` — an install with a space in its
	 * path, or Git for Windows' own copy. Plain `ssh` otherwise.
	 */
	sshProgram?: string;
	/** Defaults to the platform this process runs on; named so a test can ask for either. */
	platform?: 'windows' | 'posix';
}

function currentPlatform(): 'windows' | 'posix' {
	return process.platform === 'win32' ? 'windows' : 'posix';
}

/**
 * Rejects what no real path contains and a shell would read as a command
 * boundary. Thrown rather than escaped: a key path with a line break did not
 * come from the folder picker, it came from an edited `data.json`, and the
 * right answer to that is to stop.
 */
function assertUsable(value: string, label: string): void {
	if (value === '') {
		throw new Error(`Docs Publisher: ${label} is empty`);
	}
	// eslint-disable-next-line no-control-regex
	if (/[\u0000-\u001f\u007f]/.test(value)) {
		throw new Error(`Docs Publisher: ${label} contains a control character`);
	}
}

/**
 * Forward slashes on Windows. Git hands `GIT_SSH_COMMAND` to its own `sh`, and
 * both the Windows OpenSSH client and the copy bundled with Git for Windows
 * accept `C:/Users/…`, while a backslash is only safe inside the quotes below
 * and still confuses programs that convert paths themselves.
 */
function normalise(path: string, platform: 'windows' | 'posix'): string {
	return platform === 'windows' ? path.replace(/\\/g, '/') : path;
}

/**
 * POSIX single quoting: nothing inside single quotes is special, so the only
 * character that needs handling is the single quote itself, closed, escaped
 * and reopened. That is the whole reason this is one function — spaces,
 * `$`, backticks and glob characters in a path are all inert once quoted.
 */
function quote(value: string): string {
	return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * The value for `GIT_SSH_COMMAND`. Git runs it through a shell, which is why
 * a Windows path such as `C:\Users\<name with a space>\.ssh\key` is the likely
 * first failure and why the quoting lives in one tested place.
 */
export function sshCommand(options: SshCommandOptions): string {
	const platform = options.platform ?? currentPlatform();
	const program = options.sshProgram ?? 'ssh';
	assertUsable(options.keyPath, 'the key path');
	assertUsable(program, 'the ssh program');

	const words: string[] = [
		// A bare `ssh` needs no quoting, and leaving it bare keeps the common
		// case readable in a process listing.
		program === 'ssh' ? program : quote(normalise(program, platform)),
		'-i',
		quote(normalise(options.keyPath, platform)),
	];
	for (const option of FIXED_OPTIONS) {
		words.push('-o', option);
	}
	return words.join(' ');
}

/**
 * The same options as an argument list, for the one place ssh is spawned
 * directly (asking the server for the account's name). No shell reads these,
 * so no quoting applies; the path is passed as it is.
 */
export function sshArguments(keyPath: string): string[] {
	assertUsable(keyPath, 'the key path');
	const args: string[] = ['-i', keyPath];
	for (const option of FIXED_OPTIONS) {
		args.push('-o', option);
	}
	return args;
}
