// Plain CommonJS, no build step. Copy this folder to <userData>/plugins/sample/ and enable it in Settings > Plugins.
const { Plugin } = require('loom');

// RelationType: Number = 2, Checkbox = 6
const FORMAT_NUMBER = 2;
const FORMAT_CHECKBOX = 6;

module.exports = class SamplePlugin extends Plugin {

	async onload () {
		const h = this.app.React.createElement;

		// Progress view: one bar per record, taken from a number (0-100) or checkbox property chosen in the view settings
		this.registerView('progress', {
			name: 'Progress',
			settings: [
				{ id: 'relation', name: 'Property key', type: 'text', default: 'done' },
				{ id: 'showNumbers', name: 'Show numbers', type: 'switch', default: true },
			],
			component: (props) => {
				const { records, config, relations, open } = props;
				const relation = relations.find(it => it.key == config.relation);

				const getValue = (record) => {
					const value = record[config.relation];

					if (relation && (relation.format == FORMAT_CHECKBOX)) {
						return value ? 100 : 0;
					};
					return Math.max(0, Math.min(100, Number(value) || 0));
				};

				if (!records.length) {
					return h('div', { className: 'sampleProgress' }, h('div', { className: 'empty' }, 'No records'));
				};

				return h('div', { className: 'sampleProgress' }, records.map(record => {
					const value = getValue(record);

					return h('div', { className: 'row', key: record.id },
						h('div', { className: 'name', onClick: () => open(record.id) }, record.name || 'Untitled'),
						h('div', { className: 'bar' }, h('div', { className: 'fill', style: { width: `${value}%` } })),
						config.showNumbers ? h('div', { className: 'value' }, `${value}%`) : null
					);
				}));
			},
		});

		this.addCommand({
			id: 'say-hello',
			name: 'Sample: say hello',
			hotkey: 'Mod+Alt+Y',
			callback: async () => {
				const data = await this.loadData();
				const count = (Number(data.hello) || 0) + 1;

				await this.saveData({ ...data, hello: count });
				this.app.notice(`Hello from the sample plugin (${count})`);
			},
		});

		this.addSettingTab({
			name: 'Sample',
			render: (container) => {
				const text = document.createElement('p');

				text.textContent = `Running on Loom ${this.app.version}, ${this.app.theme()} theme.`;
				container.appendChild(text);

				return () => text.remove();
			},
		});

		// styles.css is injected by the app. addStyle does the same from code
		this.registerEvent('theme-change', (theme) => console.log('[sample] theme changed to', theme));
	};

	onunload () {
		console.log('[sample] unloaded');
	};

};
