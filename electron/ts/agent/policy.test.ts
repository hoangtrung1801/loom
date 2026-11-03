import { describe, expect, test } from 'vitest';
import { contextSection, historySection, isMutating, resolveTier, trimMessages, truncateText } from './policy';

describe('resolveTier', () => {
	test('auto gives large to Anthropic and small to a custom endpoint', () => {
		expect(resolveTier({ provider: 'anthropic', tier: 'auto' })).toBe('large');
		expect(resolveTier({ provider: 'custom', tier: 'auto' })).toBe('small');
	});

	test('an explicit tier wins', () => {
		expect(resolveTier({ provider: 'anthropic', tier: 'small' })).toBe('small');
		expect(resolveTier({ provider: 'custom', tier: 'large' })).toBe('large');
	});
});

describe('truncateText', () => {
	test('leaves short text alone', () => {
		expect(truncateText('abc', 10)).toBe('abc');
	});

	test('cuts long text and says how much was dropped', () => {
		const out = truncateText('x'.repeat(30), 10);
		expect(out.startsWith('x'.repeat(10))).toBe(true);
		expect(out).toContain('truncated 20 characters');
	});
});

describe('trimMessages', () => {
	const m = (role: string, n: number) => ({ role, n });

	test('returns the list untouched when it fits', () => {
		const list = [ m('user', 1), m('assistant', 2) ];
		expect(trimMessages(list, 5)).toBe(list);
	});

	test('starts the kept window on a user message, never on a tool result', () => {
		const list = [ m('user', 1), m('assistant', 2), m('toolResult', 3), m('assistant', 4), m('user', 5), m('assistant', 6) ];
		const out = trimMessages(list, 4);
		expect(out.map(it => it.n)).toEqual([ 5, 6 ]);
	});

	test('keeps the leading system messages and the system message written before the kept user message', () => {
		const list = [ m('system', 0), m('user', 1), m('assistant', 2), m('system', 3), m('user', 4), m('assistant', 5) ];
		const out = trimMessages(list, 3);
		expect(out.map(it => it.n)).toEqual([ 0, 3, 4, 5 ]);
	});
});

describe('prompt sections', () => {
	test('isMutating treats a missing hint as a change', () => {
		expect(isMutating(true)).toBe(false);
		expect(isMutating(false)).toBe(true);
		expect(isMutating(undefined)).toBe(true);
	});

	test('contextSection names the space and the open object', () => {
		const out = contextSection({ spaceId: 's1', spaceName: 'Work', objectId: 'o1', objectName: 'Plan', objectType: 'Page' });
		expect(out).toContain('Work (id: s1)');
		expect(out).toContain('Plan [Page] (id: o1)');
	});

	test('contextSection lists @-referenced objects with their ids', () => {
		const out = contextSection({ mentions: [ { id: 'o2', name: 'Roadmap', type: 'Page' }, { id: '', name: 'skipped' }, { id: 'o3', name: '' } ] });
		expect(out).toContain('- Roadmap [Page] (id: o2)');
		expect(out).toContain('- Untitled (id: o3)');
		expect(out).not.toContain('skipped');
	});

	test('contextSection is empty with nothing open', () => {
		expect(contextSection({})).toBe('');
	});

	test('historySection folds earlier turns and skips empty ones', () => {
		const out = historySection([ { role: 'user', text: 'hi' }, { role: 'assistant', text: '' }, { role: 'assistant', text: 'hello' } ]);
		expect(out).toBe('<previous_conversation>\nuser: hi\nassistant: hello\n</previous_conversation>');
		expect(historySection([])).toBe('');
	});
});
