/**
 * Screens of the app to draw on canvases, grouped by section (one canvas per section).
 * Each `go` brings the running web app (dev build, `window.Loom.Lib` available) to the screen.
 */

const lib = (p, fn, arg) => p.evaluate(fn, arg);

const route = (p, object) => lib(p, (object) => window.Loom.Lib.U.Object.openRoute(object), object);
const settings = (p, id) => lib(p, (id) => window.Loom.Lib.Action.openSettings(id, ''), id);
const popup = (p, id, param) => lib(p, ([ id, param ]) => window.Loom.Lib.S.Popup.open(id, param || {}), [ id, param ]);

/** Object id by name, from the objects the app already has in its stores. */
const findObject = (p, name, layout) => lib(p, ([ name, layout ]) => new Promise(resolve => {
	const { C, I, S, J } = window.Loom.Lib;
	const filters = [ { relationKey: 'name', condition: I.FilterCondition.Equal, value: name } ];

	if (layout !== undefined) {
		filters.push({ relationKey: 'resolvedLayout', condition: I.FilterCondition.Equal, value: layout });
	};
	C.ObjectSearch(S.Common.space, filters, [], J.Relation.default, '', 0, 1, (m) => resolve((m.records && m.records[0]) || null));
}), [ name, layout ]);

const openByName = async (p, name, layout) => {
	const object = await findObject(p, name, layout);
	if (!object) {
		throw new Error(`Object not found: ${name}`);
	};
	await route(p, object);
	return object;
};

const home = (p) => openByName(p, 'Welcome to Anytype');

const SCREENS = [
	// ---- Main ---- //
	{ section: 'Main', name: 'Page · Welcome', go: home },
	{ section: 'Main', name: 'Page · Playground', go: p => openByName(p, 'Playground Page') },
	{ section: 'Main', name: 'Type · Pages', go: p => openByName(p, 'Page', 4) },
	{ section: 'Main', name: 'Type · Tasks', go: p => openByName(p, 'Task', 4) },
	{ section: 'Main', name: 'Type · Collections', go: p => openByName(p, 'Collection', 4) },
	{ section: 'Main', name: 'Type · Bookmarks', go: p => openByName(p, 'Bookmark', 4) },
	{ section: 'Main', name: 'Type · Images', go: p => openByName(p, 'Image', 4) },
	{ section: 'Main', name: 'Graph', go: p => route(p, { layout: 102 }), wait: 4000 },
	{ section: 'Main', name: 'Navigation', go: async p => { const o = await findObject(p, 'Welcome to Anytype'); await route(p, { id: o.id, layout: 101 }); } },
	{ section: 'Main', name: 'Version history', go: async p => { const o = await findObject(p, 'Welcome to Anytype'); await route(p, { id: o.id, layout: 103 }); }, wait: 4000 },
	{ section: 'Main', name: 'Date', go: p => lib(p, () => window.Loom.Lib.U.Object.openDateByTimestamp('', Math.floor(Date.now() / 1000), 'auto')) },
	{ section: 'Main', name: 'Bin', go: p => settings(p, 'archive') },

	// ---- Settings ---- //
	...[
		[ 'account', 'Account' ], [ 'personal', 'Preferences' ], [ 'language', 'Language' ], [ 'shortcuts', 'Keyboard shortcuts' ],
		[ 'pinIndex', 'Pin code' ], [ 'phrase', 'Login key' ], [ 'dataIndex', 'Local storage' ], [ 'spaceList', 'Channels' ],
		[ 'dataPublish', 'Sites' ], [ 'api', 'API keys' ], [ 'plugins', 'Plugins' ], [ 'delete', 'Delete vault' ],
	].map(([ id, name ]) => ({ section: 'App settings', name, go: p => settings(p, id) })),

	...[
		[ 'spaceIndex', 'General' ], [ 'spaceShare', 'Members' ], [ 'spaceNotifications', 'Notifications' ], [ 'spaceStorage', 'Storage' ],
		[ 'importIndex', 'Import' ], [ 'importNotion', 'Import · Notion' ], [ 'importCsv', 'Import · CSV' ], [ 'importObsidian', 'Import · Obsidian' ],
		[ 'exportIndex', 'Export' ], [ 'exportMarkdown', 'Export · Markdown' ], [ 'exportProtobuf', 'Export · Any-Block' ],
	].map(([ id, name ]) => ({ section: 'Space settings', name, go: p => settings(p, id) })),
	{ section: 'Space settings', name: 'Types', go: p => openByName(p, 'Types') },

	// ---- Popups ---- //
	{ section: 'Popups', name: 'Search', go: async p => { await home(p); await popup(p, 'search'); } },
	{ section: 'Popups', name: 'Keyboard shortcuts', go: async p => { await home(p); await popup(p, 'shortcut'); } },
	{ section: 'Popups', name: 'Experience gallery', go: async p => { await home(p); await popup(p, 'usecase'); }, wait: 4000 },
	{ section: 'Popups', name: 'Export', go: async p => { const o = await home(p); await popup(p, 'export', { data: { objectIds: [ o.id ] } }); } },
	{ section: 'Popups', name: 'Confirm', go: async p => { await home(p); await popup(p, 'confirm', { data: { title: 'Delete object?', text: 'It will be moved to the Bin.', textConfirm: 'Delete', colorConfirm: 'red' } }); } },
	{ section: 'Popups', name: 'About', go: async p => { await home(p); await popup(p, 'about'); } },
	{ section: 'Popups', name: 'Log out', go: async p => { await home(p); await popup(p, 'logout'); } },
	{ section: 'Popups', name: 'Login key', go: async p => { await home(p); await popup(p, 'phrase'); } },
	{ section: 'Popups', name: 'Create channel', go: async p => { await home(p); await popup(p, 'spaceCreate'); } },
	{ section: 'Popups', name: 'What’s new', go: async p => { await home(p); await popup(p, 'help', { data: { document: 'whatsNew' } }); } },
	{ section: 'Popups', name: 'Share', go: async p => { await home(p); await popup(p, 'share'); } },
	{ section: 'Popups', name: 'Command palette', go: async p => { await home(p); await popup(p, 'command'); } },
];

module.exports = { SCREENS, lib, route, settings, popup, findObject, openByName, home };
