import { describe, expect, test } from 'vitest';
import { updaterChannel } from './updateChannel';

describe('updaterChannel', () => {
	test('latest becomes null so the provider takes the newest release', () => {
		expect(updaterChannel('latest')).toBeNull();
	});

	test('an empty or missing channel is the default channel too', () => {
		expect(updaterChannel('')).toBeNull();
		expect(updaterChannel(undefined as any)).toBeNull();
	});

	test('alpha and beta keep their names', () => {
		expect(updaterChannel('beta')).toBe('beta');
		expect(updaterChannel('alpha')).toBe('alpha');
	});
});
