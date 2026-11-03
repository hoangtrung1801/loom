import { describe, expect, test } from 'vitest';
import * as I from 'Interface';
import {
	LO_MARKER, isLoMessage, isLoText, stripLoMarker, withLoMarker, mentionsLo, shouldLoReply, textForLo, buildChatHistory, type ReplyContext,
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
