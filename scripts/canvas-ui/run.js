#!/usr/bin/env node
/**
 * Draws every screen of the running Loom web app onto canvases.
 *
 * 1. Start the app in web mode (dev build): `bun run start:web` (in a cloud container: `bash scripts/setup-cloud.sh` first)
 * 2. Create an account in that browser profile once (or let this script do it, see --signup)
 * 3. `node scripts/canvas-ui/run.js --url "<web url printed by start:web>" [--profile dir] [--out dir] [--canvas] [--only text]`
 *
 * For each screen it opens the screen, reads the DOM with capture.js and turns it into canvas elements
 * (boxes, borders, text, SVG icons, image mosaics), framed and laid out in a grid, one file per section.
 * With --canvas it also creates one Canvas object per section in the app and pastes the elements into it.
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { captureCanvasElements } = require('./capture');
const { SCREENS, home } = require('./screens');

const args = process.argv.slice(2);
const arg = (name, def) => {
	const i = args.indexOf(`--${name}`);
	return (i >= 0) ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : def;
};

const URL = arg('url', 'http://127.0.0.1:3030/');
const PROFILE = path.resolve(arg('profile', path.join(process.cwd(), '.canvas-ui-profile')));
const OUT = path.resolve(arg('out', path.join(__dirname, '..', '..', 'docs', 'canvas', 'ui-screens')));
const ONLY = arg('only', '');
const W = 1280;
const H = 800;
const GAP_X = 160;
const GAP_Y = 200;
const PER_ROW = 4;
const LIMIT = 2400;
const SECTION_ORDER = [ 'Auth', 'Main', 'Popups', 'Menus', 'App settings', 'Space settings' ];

const log = (...a) => console.log('[canvas-ui]', ...a);

const prepare = async (p) => {
	await p.evaluate(() => {
		const { S } = window.Loom.Lib;
		S.Menu.close('onboarding');
		// The web mode badge is not part of the app
		Array.from(document.querySelectorAll('body *')).filter(el => (el.childElementCount == 0) && (el.textContent.trim() == 'Web Mode')).forEach(el => el.style.display = 'none');
	});
};

const capture = (p) => p.evaluate(`(${captureCanvasElements.toString()})({})`);

const resetUi = async (p) => {
	await p.evaluate(() => {
		const { S } = window.Loom.Lib;
		S.Popup.closeAll();
		S.Menu.closeAll();
	});
	await p.keyboard.press('Escape').catch(() => {});
	await p.waitForTimeout(500);
};

const createCanvas = (p, name) => p.evaluate((name) => new Promise((resolve, reject) => {
	const { C, S } = window.Loom.Lib;
	const type = S.Record.getTypes().find(t => t.recommendedLayout == 28);

	C.ObjectCreate({ name, layout: 28 }, [], '', type ? type.uniqueKey : 'ot-canvas', S.Common.space, (m) => m.error?.code ? reject(new Error(m.error.description)) : resolve(m.objectId));
}), name);

const openCanvas = async (p, id) => {
	await p.evaluate((id) => window.Loom.Lib.U.Object.openRoute({ id, layout: 28 }), id);
	await p.waitForSelector('.canvasWrap', { timeout: 15000 });
	await p.waitForTimeout(1500);
};

const paste = (p, elements) => p.evaluate((json) => {
	const target = document.querySelector('.canvasWrap');
	const dt = new DataTransfer();

	target.focus();
	dt.setData('text/plain', json);
	target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, JSON.stringify({ type: 'loom/canvas', version: 1, elements }));

// --------------------------------------------------------- //

const AUTH = [
	// The intro animates in for a few seconds
	{ section: 'Auth', name: 'Select', go: async p => { await p.waitForTimeout(6000); } },
	{ section: 'Auth', name: 'Login', go: async p => { await p.getByText('I already have a Key').click(); } },
];

const MENUS = [
	{ section: 'Menus', name: 'Object menu', go: async p => { await home(p); await p.waitForTimeout(1500); await p.click('#button-header-more'); } },
	{ section: 'Menus', name: 'Channel menu', go: async p => { await home(p); await p.waitForTimeout(1500); await p.locator('.sidebarPage .spaceName .name').first().click(); } },
	{ section: 'Menus', name: 'Text style', go: async p => {
		await home(p);
		await p.waitForTimeout(1500);
		await p.locator('.block.blockText .editable').filter({ hasText: 'This short video' }).first().dblclick({ position: { x: 40, y: 8 } });
	} },
	{ section: 'Menus', name: 'Add block (/)', go: async p => {
		// A scratch page, so that typing does not change real documents. Deleted afterwards.
		const id = await p.evaluate(() => new Promise(resolve => {
			const { C, S } = window.Loom.Lib;
			C.ObjectCreate({ name: 'Meeting notes' }, [], '', 'ot-page', S.Common.space, m => resolve(m.objectId));
		}));
		p.scratchId = id;
		await p.evaluate((id) => window.Loom.Lib.U.Object.openRoute({ id, layout: 0 }), id);
		await p.waitForTimeout(2500);
		await p.locator('.block.blockText .editable').first().click();
		await p.keyboard.press('End');
		await p.keyboard.press('Enter');
		await p.waitForTimeout(500);
		await p.keyboard.type('/');
	}, after: async p => {
		await p.keyboard.press('Escape');
		await p.evaluate((id) => window.Loom.Lib.C.ObjectListDelete([ id ]), p.scratchId);
	} },
];

const CANVAS = [
	{ section: 'Main', name: 'Canvas', go: async p => {
		p.scratchId = await createCanvas(p, 'Whiteboard');
		await openCanvas(p, p.scratchId);
	}, after: async p => {
		await p.evaluate((id) => window.Loom.Lib.C.ObjectListDelete([ id ]), p.scratchId);
	} },
];

// --------------------------------------------------------- //

const run = async () => {
	const screens = []
		.concat(AUTH, SCREENS.filter(s => !/Graph/.test(s.name)), CANVAS, MENUS)
		.filter(s => !ONLY || s.name.includes(ONLY) || s.section.includes(ONLY))
		// Settings last: they leave the settings navigation in the sidebar
		.sort((a, b) => SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section));
	const results = new Map();

	// Auth screens need a signed out browser profile
	const authScreens = screens.filter(s => s.section == 'Auth');
	if (authScreens.length) {
		const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(require('os').tmpdir(), 'canvas-ui-auth-')), { viewport: { width: W, height: H } });
		const p = ctx.pages()[0] || await ctx.newPage();

		for (const s of authScreens) {
			await p.goto(URL);
			await p.waitForTimeout(5000);
			await s.go(p);
			await p.waitForTimeout(2500);
			await p.evaluate(() => Array.from(document.querySelectorAll('body *')).filter(el => (el.childElementCount == 0) && (el.textContent.trim() == 'Web Mode')).forEach(el => el.style.display = 'none'));
			results.set(s, await capture(p));
			log(s.section, '/', s.name, results.get(s).length);
		};
		await ctx.close();
	};

	const ctx = await chromium.launchPersistentContext(PROFILE, { viewport: { width: W, height: H } });
	const p = ctx.pages()[0] || await ctx.newPage();

	await p.goto(URL);
	await p.waitForTimeout(8000);

	// The channel list (vault) is part of the default layout
	await p.evaluate(() => {
		const { sidebar, I } = window.Loom.Lib;
		sidebar.leftPanelOpen(sidebar.getData(I.SidebarPanel.Left).width || 300, false, true);
	});
	await p.waitForTimeout(1000);

	for (const s of screens.filter(s => s.section != 'Auth')) {
		try {
			await resetUi(p);
			await s.go(p);
			await p.waitForTimeout(s.wait || 2500);
			await prepare(p);
			results.set(s, await capture(p));
			log(s.section, '/', s.name, results.get(s).length);
			if (s.after) {
				await s.after(p);
			};
		} catch (e) {
			log(s.section, '/', s.name, 'FAILED', e.message.split('\n')[0]);
		};
	};

	// Layout: one canvas per section, screens in a grid of frames
	fs.mkdirSync(OUT, { recursive: true });

	const sections = SECTION_ORDER.filter(name => screens.some(s => (s.section == name) && results.has(s)));
	const files = [];

	// A canvas holds about 2500 elements comfortably, bigger sections are split into parts
	const groups = [];
	sections.forEach(name => {
		const list = screens.filter(s => (s.section == name) && results.has(s));
		const parts = [];
		let part = [];
		let size = 0;

		list.forEach(s => {
			const n = results.get(s).length + 1;
			if (part.length && ((size + n) > LIMIT)) {
				parts.push(part);
				part = [];
				size = 0;
			};
			part.push(s);
			size += n;
		});
		parts.push(part);
		parts.forEach((list, i) => groups.push({ name: (parts.length > 1) ? `${name} ${i + 1}` : name, list }));
	});

	groups.forEach(({ name, list }, n) => {
		const elements = [];
		let counter = 0;

		list.forEach((s, i) => {
			const fx = (i % PER_ROW) * (W + GAP_X);
			const fy = Math.floor(i / PER_ROW) * (H + GAP_Y);

			elements.push({ id: `f${i}`, type: 'frame', x: fx, y: fy, w: W, h: H, text: s.name });
			results.get(s).forEach(el => {
				const copy = { ...el, id: `e${(++counter).toString(36)}`, x: el.x + fx, y: el.y + fy };
				elements.push(copy);
			});
		});

		const file = `${n + 1}-${name.toLowerCase().replace(/\s+/g, '-')}.json`;
		fs.writeFileSync(path.join(OUT, file), JSON.stringify({ type: 'loom/canvas', version: 1, elements }));
		files.push({ name, file, count: elements.length, screens: list.length });
		log(`${file}: ${list.length} screens, ${elements.length} elements`);
	});

	if (arg('canvas', false)) {
		for (const f of files) {
			const id = await createCanvas(p, `Loom UI · ${f.name}`);
			await openCanvas(p, id);
			await paste(p, JSON.parse(fs.readFileSync(path.join(OUT, f.file), 'utf8')).elements);
			await p.waitForTimeout(3000);
			f.objectId = id;
			log('canvas created', f.name, id);
		};
		fs.writeFileSync(path.join(OUT, 'canvases.json'), JSON.stringify(files, null, '\t'));
	};

	await ctx.close();
};

run().catch(e => {
	console.error(e);
	process.exit(1);
});
