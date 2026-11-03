import { describe, it, expect } from 'vitest';
import { evaluate } from './loader';
import { Plugin } from './plugin';

describe('evaluate', () => {

	it('returns the default export', () => {
		const Ctor = evaluate('a', `
			const { Plugin } = require('loom');
			exports.default = class extends Plugin {};
		`);

		expect(Ctor.prototype instanceof Plugin).toBe(true);
	});

	it('accepts module.exports as the class', () => {
		const Ctor = evaluate('a', `
			const { Plugin } = require('loom');
			module.exports = class extends Plugin {};
		`);

		expect(Ctor.prototype instanceof Plugin).toBe(true);
	});

	it('hands out only the allowed modules', () => {
		const code = (name: string) => `
			const m = require('${name}');
			module.exports = class extends require('loom').Plugin { static dep () { return m; } };
		`;

		[ 'react', 'react-dom', 'mobx', 'mobx-react' ].forEach(name => {
			expect(() => evaluate('a', code(name))).not.toThrow();
		});
	});

	it('throws on an unknown require', () => {
		expect(() => evaluate('a', `require('fs');`)).toThrow('cannot require "fs"');
	});

	it('rejects anything that does not extend Plugin', () => {
		expect(() => evaluate('a', `module.exports = class {};`)).toThrow('extending Plugin');
		expect(() => evaluate('a', `module.exports = { default: 5 };`)).toThrow('extending Plugin');
		expect(() => evaluate('a', ``)).toThrow('extending Plugin');
	});

	it('propagates syntax errors', () => {
		expect(() => evaluate('a', `module.exports = {`)).toThrow();
	});

});
