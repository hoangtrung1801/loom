import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { hasAppData, resolveUserData } from './userData';

let appData = '';

const make = (name: string, files: Record<string, string>): string => {
	const dir = path.join(appData, name);

	for (const [ file, content ] of Object.entries(files)) {
		fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
		fs.writeFileSync(path.join(dir, file), content);
	};
	return dir;
};

const read = (...parts: string[]): string => fs.readFileSync(path.join(appData, ...parts), 'utf8');

beforeEach(() => {
	appData = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-userdata-'));
});

afterEach(() => {
	fs.rmSync(appData, { recursive: true, force: true });
});

describe('resolveUserData', () => {

	test('a fresh install uses <appData>/loom', () => {
		expect(resolveUserData(appData)).toBe(path.join(appData, 'loom'));
	});

	test('moves the legacy folder over when loom does not exist', () => {
		make('anytype', { 'data/account/store.db': 'notes', 'devconfig.json': '{}' });

		const dir = resolveUserData(appData);

		expect(dir).toBe(path.join(appData, 'loom'));
		expect(read('loom', 'data', 'account', 'store.db')).toBe('notes');
		expect(fs.existsSync(path.join(appData, 'anytype'))).toBe(false);
	});

	test('moves into a loom folder the CLI created first, keeping the CLI config', () => {
		make('anytype', { 'data/account/store.db': 'notes' });
		make('loom', { 'config.json': '{"api_key":"k"}' });

		const dir = resolveUserData(appData);

		expect(dir).toBe(path.join(appData, 'loom'));
		expect(read('loom', 'data', 'account', 'store.db')).toBe('notes');
		expect(read('loom', 'config.json')).toBe('{"api_key":"k"}');
		expect(fs.existsSync(path.join(appData, 'anytype'))).toBe(false);
	});

	test('never overwrites an entry that exists on both sides, and keeps the leftover', () => {
		make('anytype', { 'data/account/store.db': 'notes', 'config.json': 'legacy' });
		make('loom', { 'config.json': 'cli' });

		resolveUserData(appData);

		expect(read('loom', 'config.json')).toBe('cli');
		expect(read('anytype', 'config.json')).toBe('legacy');
		expect(read('loom', 'data', 'account', 'store.db')).toBe('notes');
	});

	test('a loom folder already in use is kept and the legacy one left alone', () => {
		make('loom', { 'devconfig.json': '{}' });
		make('anytype', { 'data/account/store.db': 'old' });

		expect(resolveUserData(appData)).toBe(path.join(appData, 'loom'));
		expect(read('anytype', 'data', 'account', 'store.db')).toBe('old');
	});

	test('tries the legacy names in order and skips folders without app data', () => {
		// distinct names: on macOS "anytype" and "Anytype" are one folder
		make('first', { 'logs/log.log': 'only logs' });
		make('second', { 'data/account/store.db': 'notes' });

		const dir = resolveUserData(appData, [ 'first', 'second' ]);

		expect(dir).toBe(path.join(appData, 'loom'));
		expect(hasAppData(dir)).toBe(true);
		expect(read('loom', 'data', 'account', 'store.db')).toBe('notes');
	});

});
