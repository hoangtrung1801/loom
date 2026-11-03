import React from 'react';
import * as ReactDOM from 'react-dom';
import * as mobx from 'mobx';
import * as mobxReact from 'mobx-react-lite';
import { Plugin } from './plugin';

export const sdk = { Plugin };

/**
 * Evaluates the CommonJS bundle of a plugin and returns its Plugin subclass.
 * Plugins can only require the modules the app hands them.
 */
export const evaluate = (id: string, code: string): typeof Plugin => {
	const module: { exports: any } = { exports: {} };
	const require = (name: string) => {
		switch (name) {
			case 'loom': return sdk;
			case 'react': return React;
			case 'react-dom': return ReactDOM;
			case 'mobx': return mobx;
			case 'mobx-react':
			case 'mobx-react-lite': return mobxReact;
		};
		throw new Error(`Plugin ${id}: cannot require "${name}"`);
	};

	new Function('module', 'exports', 'require', `${code}\n//# sourceURL=plugin:${id}/main.js`)(module, module.exports, require);

	const Ctor = module.exports?.default || module.exports;

	if (('function' != typeof(Ctor)) || !(Ctor.prototype instanceof Plugin)) {
		throw new Error(`Plugin ${id}: main.js must export a class extending Plugin`);
	};

	return Ctor;
};
