import { describe, it, expect, vi, beforeEach } from 'vitest';

// The icons registry pulls in every icon component and breaks under node — stub it out
vi.mock('Component/util/icons', () => ({
	getIconSvg: (name: string) => `<svg data-name="${name}"><path fill="currentColor"/></svg>`,
}));

import UtilObject from './object';

const decode = (uri: string) => Buffer.from(uri.replace('data:image/svg+xml;base64,', ''), 'base64').toString('utf8');

describe('UtilObject.webAppIcon', () => {

	beforeEach(() => {
		(globalThis as any).J = {
			Constant: {
				webAppIcons: [
					{ id: 'x', hosts: [ 'x.com', 'twitter.com' ] },
					{ id: 'facebook', hosts: [ 'facebook.com' ] },
				],
			},
			Theme: { '': { color: { default: '#252525' } } },
		};
		(globalThis as any).S = { Common: { getThemeClass: () => '' } };
		(globalThis as any).U = {
			String: {
				shortUrl: (url: string) => {
					if (!url) {
						return '';
					};
					try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; };
				},
			},
		};
	});

	it('returns the bundled icon for a known host', () => {
		const svg = decode(UtilObject.webAppIcon('https://x.com/callanxai/status/1', 16));

		expect(svg).toContain('data-name="web/x"');
		expect(svg).toContain('fill="#252525"');
	});

	it('matches subdomains and www', () => {
		expect(decode(UtilObject.webAppIcon('https://www.facebook.com/groups/1', 16))).toContain('web/facebook');
		expect(decode(UtilObject.webAppIcon('https://m.facebook.com/x', 16))).toContain('web/facebook');
		expect(decode(UtilObject.webAppIcon('https://mobile.twitter.com/x', 16))).toContain('web/x');
	});

	it('does not match look-alike hosts', () => {
		expect(UtilObject.webAppIcon('https://notx.com/a', 16)).toBe('');
		expect(UtilObject.webAppIcon('https://x.com.evil.org/a', 16)).toBe('');
	});

	it('returns an empty string for unknown or empty sources', () => {
		expect(UtilObject.webAppIcon('https://example.com', 16)).toBe('');
		expect(UtilObject.webAppIcon('', 16)).toBe('');
		expect(UtilObject.webAppIcon(undefined as any, 16)).toBe('');
	});

});
