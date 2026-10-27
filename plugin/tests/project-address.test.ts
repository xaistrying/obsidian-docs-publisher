import { describe, expect, it } from 'vitest';
import {
	filePageUrl,
	parseProjectAddress,
	reviewListUrl,
	sshKeysPageUrl,
} from '../src/git-publishing/project-address';

describe('reading the address an author pastes', () => {
	describe('the forms it accepts', () => {
		const cases: Array<[string, string, string, number | null, string, string]> = [
			// input, ssh form, host, port, path, web base
			['git@gitlab.example.com:docs/kb.git', 'git@gitlab.example.com:docs/kb.git', 'gitlab.example.com', null, 'docs/kb', 'https://gitlab.example.com'],
			['git@gitlab.example.com:docs/kb', 'git@gitlab.example.com:docs/kb.git', 'gitlab.example.com', null, 'docs/kb', 'https://gitlab.example.com'],
			['ssh://git@gitlab.example.com/docs/kb.git', 'git@gitlab.example.com:docs/kb.git', 'gitlab.example.com', null, 'docs/kb', 'https://gitlab.example.com'],
			['ssh://git@gitlab.example.com:22/docs/kb', 'git@gitlab.example.com:docs/kb.git', 'gitlab.example.com', null, 'docs/kb', 'https://gitlab.example.com'],
			['ssh://git@gitlab.example.com:2222/docs/kb.git', 'ssh://git@gitlab.example.com:2222/docs/kb.git', 'gitlab.example.com', 2222, 'docs/kb', 'https://gitlab.example.com'],
			['https://gitlab.example.com/docs/kb', 'git@gitlab.example.com:docs/kb.git', 'gitlab.example.com', null, 'docs/kb', 'https://gitlab.example.com'],
			['https://gitlab.example.com/docs/kb.git', 'git@gitlab.example.com:docs/kb.git', 'gitlab.example.com', null, 'docs/kb', 'https://gitlab.example.com'],
			['https://gitlab.example.com/docs/kb/', 'git@gitlab.example.com:docs/kb.git', 'gitlab.example.com', null, 'docs/kb', 'https://gitlab.example.com'],
			['https://gitlab.example.com:8443/docs/kb', 'git@gitlab.example.com:docs/kb.git', 'gitlab.example.com', null, 'docs/kb', 'https://gitlab.example.com:8443'],
			['git@gitlab.example.com:team/docs/sub/kb.git', 'git@gitlab.example.com:team/docs/sub/kb.git', 'gitlab.example.com', null, 'team/docs/sub/kb', 'https://gitlab.example.com'],
			['git@10.1.2.3:docs/kb.git', 'git@10.1.2.3:docs/kb.git', '10.1.2.3', null, 'docs/kb', 'https://10.1.2.3'],
			['  git@gitlab.example.com:docs/kb.git  ', 'git@gitlab.example.com:docs/kb.git', 'gitlab.example.com', null, 'docs/kb', 'https://gitlab.example.com'],
			['git@gitlab.example.com:Docs/KB_v2.git', 'git@gitlab.example.com:Docs/KB_v2.git', 'gitlab.example.com', null, 'Docs/KB_v2', 'https://gitlab.example.com'],
		];

		for (const [input, ssh, host, port, path, web] of cases) {
			it(`reads ${JSON.stringify(input)}`, () => {
				const address = parseProjectAddress(input);

				expect(address).not.toBeNull();
				expect(address?.sshUrl).toBe(ssh);
				expect(address?.host).toBe(host);
				expect(address?.port).toBe(port);
				expect(address?.path).toBe(path);
				expect(address?.webBase).toBe(web);
			});
		}
	});

	describe('what it refuses', () => {
		const refused: Array<[string, string]> = [
			['a numeric project id', '1234'],
			['plain words', 'hello'],
			['nothing', ''],
			['only spaces', '   '],
			['an option smuggled in as the host', 'git@-oProxyCommand=x:a/b.git'],
			['an option smuggled in as the host of an ssh url', 'ssh://git@-oProxyCommand=x/a/b.git'],
			['a transport helper', 'ext::sh -c touch /tmp/x'],
			['a transport helper in the host position', 'git@ext::sh:a/b'],
			['a path that climbs', 'git@gitlab.example.com:../b.git'],
			['a path with a climbing segment in the middle', 'git@gitlab.example.com:a/../b.git'],
			['a path with an empty segment', 'git@gitlab.example.com:a//b.git'],
			['a path segment that starts with a hyphen', 'git@gitlab.example.com:a/-b.git'],
			['a path with a control character', 'git@gitlab.example.com:a/b\u0007.git'],
			['a path with a space', 'git@gitlab.example.com:a/b c.git'],
			['a path with a shell metacharacter', 'git@gitlab.example.com:a/b;rm.git'],
			['a user other than git', 'ana@gitlab.example.com:a/b.git'],
			['an ssh url with no user', 'ssh://gitlab.example.com/a/b.git'],
			['an ssh url with another user', 'ssh://ana@gitlab.example.com/a/b.git'],
			['credentials in an https url', 'https://ana:secret@gitlab.example.com/a/b'],
			['plain http', 'http://gitlab.example.com/a/b'],
			['a file url', 'file:///srv/git/a/b'],
			['another scheme', 'ftp://gitlab.example.com/a/b'],
			['only one path segment', 'git@gitlab.example.com:project.git'],
			['a host with an underscore', 'git@git_lab.example.com:a/b.git'],
			['a host that ends in a hyphen', 'git@gitlab-:a/b.git'],
			['an empty host', 'git@:a/b.git'],
			['an ipv6 literal', 'git@[::1]:a/b.git'],
			['a port of zero', 'ssh://git@gitlab.example.com:0/a/b.git'],
			['a port that is too large', 'ssh://git@gitlab.example.com:70000/a/b.git'],
			['a port that is not a number', 'ssh://git@gitlab.example.com:ssh/a/b.git'],
			['an absolute scp path', 'git@gitlab.example.com:/a/b.git'],
			['an address that is far too long', `git@gitlab.example.com:${'a/'.repeat(300)}b.git`],
		];

		for (const [label, input] of refused) {
			it(`refuses ${label}`, () => {
				expect(parseProjectAddress(input)).toBeNull();
			});
		}
	});

	it('strips exactly one trailing .git, so a project really named that is not cut further', () => {
		expect(parseProjectAddress('git@gitlab.example.com:a/b.git.git')?.path).toBe('a/b.git');
	});
});

describe('the web addresses derived from it', () => {
	const address = parseProjectAddress('git@gitlab.example.com:docs/kb.git');
	if (address === null) {
		throw new Error('fixture address must parse');
	}

	it('points at the author\'s own SSH keys page', () => {
		expect(sshKeysPageUrl(address)).toBe('https://gitlab.example.com/-/user_settings/ssh_keys');
	});

	it('lists the open reviews from one document branch, with the branch name encoded', () => {
		expect(reviewListUrl(address, 'SBT-KE-004_New-Terminal')).toBe(
			'https://gitlab.example.com/docs/kb/-/merge_requests?state=opened&source_branch=doc%2FSBT-KE-004_New-Terminal'
		);
	});

	it('opens a file on the default branch, encoding each part and keeping the slashes between folders', () => {
		expect(filePageUrl(address, 'main', 'Products/Smart Buddy POS/Known errors/CEPAS 3 #200.md')).toBe(
			'https://gitlab.example.com/docs/kb/-/blob/main/Products/Smart%20Buddy%20POS/Known%20errors/CEPAS%203%20%23200.md'
		);
	});

	it('encodes a default branch that has a slash in its name', () => {
		expect(filePageUrl(address, 'release/2026', 'a.md')).toBe(
			'https://gitlab.example.com/docs/kb/-/blob/release%2F2026/a.md'
		);
	});

	it('keeps the web port an author pasted in an https address', () => {
		const withPort = parseProjectAddress('https://gitlab.example.com:8443/docs/kb');
		expect(withPort && sshKeysPageUrl(withPort)).toBe('https://gitlab.example.com:8443/-/user_settings/ssh_keys');
	});
});
