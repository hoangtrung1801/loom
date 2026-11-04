import { describe, expect, test } from 'vitest';
import { parseAgentMarkdown, parseInline } from './agentMarkdown';

describe('parseInline', () => {
	test('splits bold, italic and code from plain text', () => {
		expect(parseInline('a **b** c `d` *e*')).toEqual([
			{ type: 'text', text: 'a ' }, { type: 'bold', text: 'b' }, { type: 'text', text: ' c ' },
			{ type: 'code', text: 'd' }, { type: 'text', text: ' ' }, { type: 'italic', text: 'e' },
		]);
	});

	test('parses markdown and bare links', () => {
		expect(parseInline('see [docs](https://a.io/x) and https://b.io/y.')).toEqual([
			{ type: 'text', text: 'see ' }, { type: 'link', text: 'docs', url: 'https://a.io/x' },
			{ type: 'text', text: ' and ' }, { type: 'link', text: 'https://b.io/y', url: 'https://b.io/y' },
			{ type: 'text', text: '.' },
		]);
	});

	test('keeps html as literal text', () => {
		expect(parseInline('<img src=x onerror=alert(1)>')).toEqual([ { type: 'text', text: '<img src=x onerror=alert(1)>' } ]);
	});
});

describe('parseAgentMarkdown', () => {
	test('paragraphs are separated by blank lines', () => {
		const out = parseAgentMarkdown('one\ntwo\n\nthree');
		expect(out).toHaveLength(2);
		expect(out[0]).toMatchObject({ type: 'paragraph' });
	});

	test('bullet and numbered lists', () => {
		const out = parseAgentMarkdown('- a\n- b\n\n1. x\n2. y');
		expect(out).toMatchObject([ { type: 'list', ordered: false }, { type: 'list', ordered: true } ]);
		expect((out[0] as any).items).toHaveLength(2);
	});

	test('headings', () => {
		expect(parseAgentMarkdown('## Plan')[0]).toMatchObject({ type: 'heading' });
	});

	test('fenced code keeps its lines verbatim', () => {
		expect(parseAgentMarkdown('```ts\nconst a = 1;\n  b\n```')).toEqual([ { type: 'code', text: 'const a = 1;\n  b' } ]);
	});

	test('an unterminated fence still renders while the reply streams', () => {
		expect(parseAgentMarkdown('```\nhalf')).toEqual([ { type: 'code', text: 'half' } ]);
	});

	test('empty input gives no blocks', () => {
		expect(parseAgentMarkdown('')).toEqual([]);
	});
});
