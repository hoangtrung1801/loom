import { describe, expect, test } from 'vitest';
import * as I from 'Interface';
import {
	LO_MARKER, isLoMessage, isLoText, stripLoMarker, withLoMarker, mentionsLo, shouldLoReply, textForLo, buildChatHistory, formatLoInline, isLoParts, partsMentionLo, partsToText, markdownToBlocks, type ReplyContext,
} from './lo';

const LO = 'lo-object';
const ME = 'me';

const msg = (id: string, text: string, extra: any = {}) => ({ id, creator: ME, content: { text, marks: [] as any[] }, ...extra });
const mention = (from: number, to: number, param = LO) => ({ type: I.MarkType.Mention, param, range: { from, to } });

const ctx = (patch: Partial<ReplyContext> = {}, known: any[] = []): ReplyContext => ({
	loId: LO,
	accountId: ME,
	configured: true,
	getMessage: id => known.find(it => it.id == id) || null,
	answered: new Set<string>(),
	...patch,
});

describe('marker', () => {
	test('is invisible and recognised only at the end', () => {
		expect(LO_MARKER.length).toBe(3);
		expect(isLoText(`hi${LO_MARKER}`)).toBe(true);
		expect(isLoText(`${LO_MARKER}hi`)).toBe(false);
		expect(isLoText('')).toBe(false);
		expect(isLoMessage(msg('1', `x${LO_MARKER}`))).toBe(true);
		expect(isLoMessage(msg('1', 'x'))).toBe(false);
	});

	test('strip and add are inverse and idempotent', () => {
		expect(stripLoMarker(withLoMarker('hi'))).toBe('hi');
		expect(withLoMarker(withLoMarker('hi'))).toBe(`hi${LO_MARKER}`);
		expect(stripLoMarker('plain')).toBe('plain');
		expect(stripLoMarker(undefined as any)).toBe('');
	});
});

describe('mentionsLo', () => {
	test('needs a mention mark of the Lo object', () => {
		expect(mentionsLo({ content: { marks: [ mention(0, 3) ] } }, LO)).toBe(true);
		expect(mentionsLo({ content: { marks: [ mention(0, 3, 'other') ] } }, LO)).toBe(false);
		expect(mentionsLo({ content: { marks: [ { type: I.MarkType.Bold, param: LO } ] } }, LO)).toBe(false);
		expect(mentionsLo({ content: { marks: [ mention(0, 3) ] } }, '')).toBe(false);
	});
});

describe('shouldLoReply', () => {
	const mentioned = (patch: any = {}) => msg('m1', 'Lo hello', { content: { text: 'Lo hello', marks: [ mention(0, 2) ] }, ...patch });

	test('answers the owner when Lo is mentioned', () => {
		expect(shouldLoReply(mentioned(), ctx())).toBe(true);
	});

	test('answers a reply to a Lo message without a mention', () => {
		const lo = msg('l1', `Hi${LO_MARKER}`);
		const reply = msg('m2', 'and then?', { replyToMessageId: 'l1' });

		expect(shouldLoReply(reply, ctx({}, [ lo ]))).toBe(true);
		expect(shouldLoReply(msg('m3', 'x', { replyToMessageId: 'unknown' }), ctx({}, [ lo ]))).toBe(false);
		expect(shouldLoReply(msg('m4', 'x', { replyToMessageId: 'o1' }), ctx({}, [ msg('o1', 'plain') ]))).toBe(false);
	});

	test('ignores other people, Lo itself, answered messages and unconfigured agents', () => {
		expect(shouldLoReply(mentioned({ creator: 'other' }), ctx())).toBe(false);
		expect(shouldLoReply(mentioned({ content: { text: `Lo${LO_MARKER}`, marks: [ mention(0, 2) ] } }), ctx())).toBe(false);
		expect(shouldLoReply(mentioned(), ctx({ answered: new Set([ 'm1' ]) }))).toBe(false);
		expect(shouldLoReply(mentioned(), ctx({ configured: false }))).toBe(false);
		expect(shouldLoReply(mentioned(), ctx({ loId: '' }))).toBe(false);
		expect(shouldLoReply(msg('m5', 'no mention'), ctx())).toBe(false);
	});
});

describe('textForLo', () => {
	test('removes the mention of Lo and tidies spaces', () => {
		const m = msg('1', 'Hey Lo  what is up', { content: { text: 'Hey Lo  what is up', marks: [ mention(4, 6) ] } });
		expect(textForLo(m, LO)).toBe('Hey what is up');
	});

	test('keeps the text when only the mention is there', () => {
		const m = msg('1', 'Lo', { content: { text: 'Lo', marks: [ mention(0, 2) ] } });
		expect(textForLo(m, LO)).toBe('Lo');
	});

	test('keeps text without a mention', () => {
		expect(textForLo(msg('1', '  plain '), LO)).toBe('plain');
	});
});

describe('buildChatHistory', () => {
	const author = (c: string) => (c == ME ? 'Ann' : 'Bob');
	const list = [
		msg('1', 'question'),
		msg('2', `answer${LO_MARKER}`),
		msg('3', 'from bob', { creator: 'bob' }),
		msg('4', ''),
		msg('5', 'current'),
		msg('6', 'later'),
	];

	test('maps authors, stops at the current message and skips empty ones', () => {
		expect(buildChatHistory(list, '5', author)).toEqual([
			{ role: 'user', text: 'Ann: question' },
			{ role: 'assistant', text: 'answer' },
			{ role: 'user', text: 'Bob: from bob' },
		]);
	});

	test('keeps only the newest within the limit', () => {
		expect(buildChatHistory(list, '5', author, 2).map(it => it.text)).toEqual([ 'answer', 'Bob: from bob' ]);
	});

	test('works without an author name and for an unknown current id', () => {
		expect(buildChatHistory([ msg('1', 'a') ], 'zz', () => '')).toEqual([ { role: 'user', text: 'a' } ]);
		expect(buildChatHistory([], '1', author)).toEqual([]);
	});
});

describe('formatLoInline', () => {
	test('turns inline markdown into marks', () => {
		const out = formatLoInline('**Open** the `read` tool, see [docs](https://x.io) or *this*.');

		expect(out.text).toBe('Open the read tool, see docs or this.');
		expect(out.marks).toEqual([
			{ type: I.MarkType.Bold, param: '', range: { from: 0, to: 4 } },
			{ type: I.MarkType.Code, param: '', range: { from: 9, to: 13 } },
			{ type: I.MarkType.Link, param: 'https://x.io', range: { from: 24, to: 28 } },
			{ type: I.MarkType.Italic, param: '', range: { from: 32, to: 36 } },
		]);
	});

	test('makes headings bold and leaves code fences alone', () => {
		const out = formatLoInline('## Spaces\n```\n**not bold**\n```');

		expect(out.text).toBe('Spaces\n```\n**not bold**\n```');
		expect(out.marks).toEqual([ { type: I.MarkType.Bold, param: '', range: { from: 0, to: 6 } } ]);
	});

	test('keeps unfinished markdown while streaming', () => {
		expect(formatLoInline('a **half').text).toBe('a **half');
	});
});

describe('discussion comments', () => {
	const part = (text: string, marks: any[] = [], extra: any = {}) => ({ text, marks, type: I.BlockType.Text, ...extra });

	test('a comment is Lo\'s when its last text ends with the marker', () => {
		expect(isLoParts([ part('a'), part(`b${LO_MARKER}`) ])).toBe(true);
		expect(isLoParts([ part(`a${LO_MARKER}`), part('b') ])).toBe(false);
		expect(isLoParts([])).toBe(false);
	});

	test('finds the Lo mention in any part', () => {
		expect(partsMentionLo([ part('hi'), part('@Lo help', [ mention(0, 3) ]) ], LO)).toBe(true);
		expect(partsMentionLo([ part('@Lo', [ mention(0, 3, 'other') ]) ], LO)).toBe(false);
		expect(partsMentionLo([ part('@Lo', [ mention(0, 3) ]) ], '')).toBe(false);
	});

	test('partsToText cuts Lo\'s mention and the marker', () => {
		const parts = [ part('@Lo summarize this', [ mention(0, 3) ]), part('thanks') ];
		expect(partsToText(parts, LO)).toBe('summarize this\nthanks');
		expect(partsToText([ part(`done${LO_MARKER}`) ])).toBe('done');
	});

	test('markdownToBlocks makes a block per line, with lists, code and the marker last', () => {
		const blocks = markdownToBlocks('Intro **bold**\n\n- one\n- two\n1. first\n```ts\nconst a = 1;\n\nlet b;\n```\nEnd');
		const styles = blocks.map(it => it.text.style);

		expect(styles).toEqual([
			I.TextStyle.Paragraph, I.TextStyle.Bulleted, I.TextStyle.Bulleted, I.TextStyle.Numbered, I.TextStyle.Code, I.TextStyle.Paragraph,
		]);
		expect(blocks[0].text.text).toBe('Intro bold');
		expect(blocks[0].text.marks[0].type).toBe(I.MarkType.Bold);
		expect(blocks[4].text.text).toBe('const a = 1;\n\nlet b;');
		expect(blocks[4].text.lang).toBe('ts');
		expect(isLoText(blocks[5].text.text)).toBe(true);
		expect(stripLoMarker(blocks[5].text.text)).toBe('End');
	});

	test('markdownToBlocks keeps an unclosed fence as code while streaming and never returns nothing', () => {
		expect(markdownToBlocks('```\nabc')[0].text.style).toBe(I.TextStyle.Code);
		expect(markdownToBlocks('').length).toBe(1);
		expect(isLoText(markdownToBlocks('')[0].text.text)).toBe(true);
	});
});
