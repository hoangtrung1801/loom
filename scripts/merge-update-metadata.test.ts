import { describe, expect, test } from 'vitest';
// @ts-ignore plain CommonJS script
import { parse, merge, mergeText } from './merge-update-metadata.js';

const arm64 = `version: 0.1.2
files:
  - url: Loom-0.1.2-mac-arm64.zip
    sha512: AAAA+bb/cc==
    size: 111
    blockMapSize: 11
  - url: Loom-0.1.2-mac-arm64.dmg
    sha512: DDDD==
    size: 222
path: Loom-0.1.2-mac-arm64.zip
sha512: AAAA+bb/cc==
releaseDate: '2026-11-03T06:08:00.000Z'
`;

const x64 = `version: 0.1.2
files:
  - url: Loom-0.1.2-mac-x64.zip
    sha512: EEEE==
    size: 333
  - url: Loom-0.1.2-mac-x64.dmg
    sha512: FFFF==
    size: 444
path: Loom-0.1.2-mac-x64.zip
sha512: EEEE==
releaseDate: '2026-11-03T06:17:00.000Z'
`;

describe('parse', () => {
	test('reads scalars and the files list with all of an item\'s keys', () => {
		const doc = parse(arm64);
		expect(doc.version).toBe('0.1.2');
		expect(doc.files).toHaveLength(2);
		expect(doc.files[0]).toEqual({ url: 'Loom-0.1.2-mac-arm64.zip', sha512: 'AAAA+bb/cc==', size: '111', blockMapSize: '11' });
		expect(doc.releaseDate).toBe("'2026-11-03T06:08:00.000Z'");
	});

	test('refuses a line it does not understand instead of guessing', () => {
		expect(() => parse(arm64 + '  stray: value\n')).toThrow('unexpected line');
	});

	test('refuses a feed with no files', () => {
		expect(() => parse('version: 1.0.0\nreleaseDate: x\n')).toThrow('missing version or files');
	});
});

describe('merge', () => {
	test('lists the files of both architectures', () => {
		const out = merge([ parse(arm64), parse(x64) ]);
		expect(out.files.map((f: any) => f.url)).toEqual([
			'Loom-0.1.2-mac-arm64.zip', 'Loom-0.1.2-mac-arm64.dmg', 'Loom-0.1.2-mac-x64.zip', 'Loom-0.1.2-mac-x64.dmg',
		]);
	});

	test('points the legacy path at the non-arm64 file and keeps the newest release date', () => {
		const out = merge([ parse(arm64), parse(x64) ]);
		expect(out.path).toBe('Loom-0.1.2-mac-x64.zip');
		expect(out.sha512).toBe('EEEE==');
		expect(out.releaseDate).toBe("'2026-11-03T06:17:00.000Z'");
	});

	test('does not depend on the order of the inputs for the legacy path', () => {
		expect(merge([ parse(x64), parse(arm64) ]).path).toBe('Loom-0.1.2-mac-x64.zip');
	});

	test('refuses to merge two different versions', () => {
		expect(() => merge([ parse(arm64), parse(x64.replace('0.1.2\nfiles', '0.1.3\nfiles')) ])).toThrow('versions differ');
	});

	test('drops a duplicate url', () => {
		expect(merge([ parse(arm64), parse(arm64) ]).files).toHaveLength(2);
	});
});

describe('mergeText', () => {
	test('writes a document that parses back to the same thing', () => {
		const text = mergeText([ arm64, x64 ]);
		expect(parse(text)).toEqual(merge([ parse(arm64), parse(x64) ]));
		expect(text.startsWith('version: 0.1.2\nfiles:\n  - url: ')).toBe(true);
		expect(text.endsWith('\n')).toBe(true);
	});
});
