import { describe, expect, it } from 'vitest';
import { normalizeHost } from '../src/git-publishing/gitlab-client';

describe('normalizeHost', () => {
	it('adds https to a bare host and drops trailing slashes', () => {
		expect(normalizeHost(' git.example.com/ ')).toBe('https://git.example.com');
	});

	it('upgrades a typed http:// so the token never travels in cleartext', () => {
		expect(normalizeHost('http://git.example.com')).toBe('https://git.example.com');
		expect(normalizeHost('HTTP://git.example.com')).toBe('https://git.example.com');
	});

	it('keeps https as is', () => {
		expect(normalizeHost('https://git.example.com')).toBe('https://git.example.com');
	});
});
