import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import React, { forwardRef } from 'react';
import { observer } from 'mobx-react-lite';
import { autoObserverPlugin } from '../../../../vite.auto-observer';

const ROOT = path.resolve(__dirname, '../../../..');

// Components that read S.Plugin rely on the build-time auto-observer wrap to re-render when plugin state changes
const FILES = {
	'src/ts/component/block/dataview/view/custom.tsx': 'ViewCustom',
	'src/ts/component/page/main/settings/plugins.tsx': 'PageMainSettingsPlugins',
	'src/ts/component/page/main/settings/pluginSettings.tsx': 'PageMainSettingsPluginSettings',
	'src/ts/component/popup/command.tsx': 'PopupCommand',
};

describe('plugin components are observers', () => {

	const plugin: any = autoObserverPlugin();

	Object.entries(FILES).forEach(([ file, name ]) => {
		it(`${file} is wrapped in observer`, () => {
			const id = path.join(ROOT, file);
			const ret = plugin.transform(fs.readFileSync(id, 'utf8'), id);

			expect(ret).toBeTruthy();
			expect(ret).toContain(`export default observer(${name});`);
			expect(ret).toContain(`import { observer } from 'mobx-react-lite';`);
		});
	});

	it('observer accepts forwardRef components', () => {
		const Comp = forwardRef<any, any>((props, ref) => React.createElement('div', { ref }));

		expect(() => observer(Comp)).not.toThrow();
	});

});
