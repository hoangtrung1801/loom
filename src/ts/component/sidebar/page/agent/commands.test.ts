import { describe, expect, test } from 'vitest';
import { AGENT_COMMANDS, commandQuery, matchCommands } from './commands';

describe('commandQuery', () => {
	test('reads the filter after a leading slash', () => {
		expect(commandQuery('/', 1)).toBe('');
		expect(commandQuery('/sum', 4)).toBe('sum');
	});

	test('is null anywhere but the start of the input', () => {
		expect(commandQuery('see /tmp', 8)).toBeNull();
		expect(commandQuery('hi', 2)).toBeNull();
		expect(commandQuery('/sum more', 9)).toBeNull();
		expect(commandQuery('', 0)).toBeNull();
	});
});

describe('matchCommands', () => {
	test('matches by prefix and lists everything for an empty filter', () => {
		expect(matchCommands('su').map(it => it.id)).toEqual([ 'summarize' ]);
		expect(matchCommands('s').map(it => it.id)).toEqual([ 'summarize', 'settings', 'stop' ]);
		expect(matchCommands('')).toBe(AGENT_COMMANDS);
		expect(matchCommands('zzz')).toEqual([]);
	});

	test('every prompt command has a prompt', () => {
		expect(AGENT_COMMANDS.filter(it => (it.kind == 'prompt') && !it.promptKey)).toEqual([]);
	});
});
