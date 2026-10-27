/**
 * What the git runner will run, and the one place that says so
 * (replace-rest-with-local-git-ssh design.md D3).
 *
 * The invariant is "the plugin never runs a command that writes working-tree
 * files, runs a program the author did not choose, or reaches a server by an
 * address nobody checked". A search of the arguments for the dangerous words
 * cannot hold that: git accepts any unique prefix of a long option (`--har` is
 * `--hard`), glues short options together (`-mu`), and reads `--output=<file>`
 * on commands whose names sound harmless. So the rule is the other way round.
 * Each subcommand lists the options it may be given, written out in full, and
 * any option not on its list is refused. A flag a later task needs is added
 * here, with the reason, and a test.
 */

interface CommandRule {
	/**
	 * Options that may appear exactly as written. A value that follows one is a
	 * separate word, which may not itself start with `-`.
	 */
	flags: ReadonlyArray<string>;
	/** Options that carry their value after an `=`: the name before it is listed here. */
	valued?: ReadonlyArray<string>;
	/** Options every call must carry. */
	required?: ReadonlyArray<string>;
}

const RULES: { [subcommand: string]: CommandRule } = {
	version: { flags: [] },
	'rev-parse': {
		flags: ['--verify', '--quiet', '-q', '--git-dir', '--show-toplevel', '--is-inside-work-tree', '--abbrev-ref', '--show-object-format', '--end-of-options'],
		valued: ['--show-object-format'],
	},
	'rev-list': {
		flags: ['--count', '--left-right', '--first-parent', '--reverse', '--no-walk', '--end-of-options'],
		valued: ['--max-count'],
	},
	// Writing needs no flag of its own, so the only things refused are the
	// machine's and a file's own settings: `--global`, `--system`, `--file`, `--blob`.
	config: {
		flags: ['--local', '--show-scope', '--get', '--get-all', '--get-regexp', '--unset', '--unset-all', '--add', '--replace-all', '-z', '--null', '--bool'],
	},
	init: { flags: ['-q', '--quiet', '-b'], valued: ['--initial-branch'] },
	'symbolic-ref': { flags: ['-q', '--quiet', '--short'] },
	remote: { flags: ['--push', '-v', '--no-tags'] },
	// No `--upload-pack`: it names a program the server is told to run.
	fetch: {
		flags: ['--prune', '--no-tags', '-q', '--quiet', '--no-write-fetch-head', '--no-recurse-submodules', '--no-auto-gc', '--no-auto-maintenance', '--end-of-options'],
	},
	'ls-remote': { flags: ['--symref', '--heads', '--tags', '--refs', '--exit-code', '-q', '--quiet'] },
	'ls-tree': {
		flags: ['-r', '-z', '--name-only', '--full-tree', '-l', '--long', '-t', '-d', '--end-of-options'],
		valued: ['--abbrev'],
	},
	// No `--textconv` and no `--filters`: both run a program named in the
	// repository's own settings.
	'cat-file': { flags: ['-e', '-p', '-t', '-s', '--batch', '--batch-check', '--end-of-options'] },
	// `--no-filters` is required, not merely allowed: without it git runs
	// whatever clean filter the repository's attributes name, and the bytes
	// stored would no longer be the bytes in the note.
	'hash-object': { flags: ['-w', '--no-filters', '--stdin', '-t', '--end-of-options'], required: ['--no-filters'] },
	// No `-u` and no `--reset`: both write the working tree.
	'read-tree': { flags: ['--empty'] },
	'update-index': { flags: ['--add', '--remove', '--force-remove', '--cacheinfo', '--index-info', '-z', '--stdin', '--info-only'] },
	'write-tree': { flags: ['--missing-ok'] },
	// No `-S`: signing starts gpg.
	'commit-tree': { flags: ['-p', '-m'] },
	'update-ref': { flags: ['-m', '-d', '--no-deref', '--stdin', '-z'] },
	'for-each-ref': {
		flags: [],
		valued: ['--format', '--sort', '--count', '--merged', '--no-merged', '--points-at', '--contains'],
	},
	'merge-base': { flags: ['--is-ancestor', '--all'] },
	// No `-p`, `--output` or `--textconv`: a log lists, it does not write a file
	// or run a converter.
	log: {
		flags: ['--oneline', '--first-parent', '--no-merges', '--name-only', '--name-status', '-z', '--no-renames', '--no-ext-diff', '--no-textconv', '--reverse', '--ancestry-path', '--end-of-options'],
		valued: ['--format', '--pretty', '--max-count', '--since', '--until', '--diff-filter'],
	},
	// `--no-ext-diff` and `--no-textconv` are required for the same reason as
	// `--no-filters` above; `--output` and `--no-index` are not offered.
	diff: {
		flags: ['--name-only', '--name-status', '--numstat', '--stat', '-z', '--no-renames', '--no-ext-diff', '--no-textconv', '--cached', '--quiet', '--exit-code', '--end-of-options'],
		valued: ['--diff-filter'],
		required: ['--no-ext-diff', '--no-textconv'],
	},
	// Printing is required below. Without it the merge is written over the
	// first file given, which is a note in the vault.
	'merge-file': { flags: ['-p', '--stdout', '-L', '--diff3', '--zdiff3', '-q', '--quiet', '--ours', '--theirs', '--union'] },
	// No `--force` (the lease is the only forcing), no `--all`, `--mirror` or
	// `--tags`, and no `--receive-pack`.
	push: {
		flags: ['-o', '--porcelain', '--no-verify', '-q', '--quiet', '--delete', '--atomic'],
		valued: ['--force-with-lease', '--push-option'],
	},
	// Only `--mixed`: every other mode rewrites the working tree.
	reset: { flags: ['--mixed', '-q', '--quiet'], required: ['--mixed'] },
};

/** The only subcommands the plugin may run. */
export const GIT_SUBCOMMAND_ALLOWLIST: ReadonlySet<string> = new Set(Object.keys(RULES));

/** The commands that talk to a server, and so need a key, a declared address and the rewrite check. */
export const NETWORK_SUBCOMMANDS: ReadonlySet<string> = new Set(['fetch', 'ls-remote', 'push']);

/**
 * `<transport>::<address>` makes git hand the address to a helper program. The
 * environment already allows only ssh; refusing the syntax as well means the
 * rule does not depend on one variable surviving.
 */
const TRANSPORT_HELPER = /^[A-Za-z][A-Za-z0-9+.-]*::/;

/** The arguments git reads as options and addresses: everything before a bare `--`, after which every word is a path. */
function beforePaths(args: string[]): string[] {
	const end = args.indexOf('--');
	return end === -1 ? args : args.slice(0, end);
}

/** Why an option is not allowed for a subcommand, or null when it is. */
function optionRefusal(subcommand: string, rule: CommandRule, arg: string): string | null {
	const equals = arg.indexOf('=');
	const allowed =
		equals === -1
			? rule.flags.indexOf(arg) !== -1
			: (rule.valued ?? []).indexOf(arg.slice(0, equals)) !== -1;
	return allowed ? null : `git ${subcommand} ${arg} is not allowed`;
}

/**
 * Why a request must not run, or null. The subcommand must be on the list,
 * every option must be on that subcommand's list, and the few rules that are
 * about more than one word are checked last.
 */
export function commandRefusal(args: string[], extraEnv: Record<string, string | undefined>): string | null {
	const subcommand = args[0];
	if (subcommand === undefined || subcommand.indexOf('-') === 0) {
		return 'a git subcommand must come first, so it is not allowed to start with an option';
	}
	if (!GIT_SUBCOMMAND_ALLOWLIST.has(subcommand)) {
		return `git ${subcommand} is not allowed`;
	}
	const rule = RULES[subcommand];
	const words = beforePaths(args).slice(1);

	for (const word of beforePaths(args)) {
		if (TRANSPORT_HELPER.test(word)) {
			return 'a transport-helper address is not allowed';
		}
	}
	for (const word of words) {
		if (word.indexOf('-') === 0) {
			const reason = optionRefusal(subcommand, rule, word);
			if (reason !== null) {
				return reason;
			}
		}
	}
	for (const flag of rule.required ?? []) {
		if (words.indexOf(flag) === -1) {
			return `git ${subcommand} is not allowed without ${flag}`;
		}
	}

	if (subcommand === 'merge-file' && words.indexOf('-p') === -1 && words.indexOf('--stdout') === -1) {
		return 'git merge-file is not allowed without -p, which would overwrite a file in the vault';
	}
	if (
		(subcommand === 'read-tree' || subcommand === 'update-index' || subcommand === 'write-tree') &&
		extraEnv.GIT_INDEX_FILE === undefined
	) {
		return `git ${subcommand} is not allowed against the real index`;
	}
	return null;
}

/**
 * What a command that reaches a server must also be. It names the address it
 * reaches, which has to be one of its own words so the name cannot be a claim
 * about some other address; and a key has been chosen, because without one the
 * only identity ssh could offer is whatever the machine's agent holds.
 */
export function networkRefusal(args: string[], remote: string | undefined, hasKey: boolean): string | null {
	if (remote === undefined || remote === '') {
		return 'a command that reaches a server is not allowed to leave out the address it reaches';
	}
	if (args.indexOf(remote) === -1) {
		return 'the address a command says it reaches is not allowed to differ from the one in its arguments';
	}
	if (!hasKey) {
		return 'a command that reaches a server is not allowed before a key is chosen';
	}
	return null;
}

/**
 * The query that finds every rule git would use to rewrite an address, in any
 * of the files it reads. `-z` because a rule's value may hold anything; the
 * pattern is lower case because git lower-cases the name it prints.
 */
export const REWRITE_QUERY: ReadonlyArray<string> = ['config', '-z', '--get-regexp', '^url\\..*\\.(insteadof|pushinsteadof)$'];

/**
 * Whether any rewrite rule applies to this address, from the output of
 * `REWRITE_QUERY`. A `url.<base>.insteadOf <prefix>` setting replaces the
 * prefix with the base, so an address that starts with a prefix would reach
 * somewhere else than the one that was tested and saved, and the author would
 * see neither. An empty prefix matches everything, as it does in git.
 *
 * Settings for other hosts are the author's business and are left alone: a
 * common one rewrites `https://github.com/` and must not stop this plugin.
 */
export function addressRewrittenBy(output: string, remote: string): boolean {
	for (const entry of output.split('\0')) {
		if (entry === '') {
			continue;
		}
		const newline = entry.indexOf('\n');
		const key = newline === -1 ? entry : entry.slice(0, newline);
		const prefix = newline === -1 ? '' : entry.slice(newline + 1);
		if (/^url\..*\.(insteadof|pushinsteadof)$/.test(key) && remote.indexOf(prefix) === 0) {
			return true;
		}
	}
	return false;
}
