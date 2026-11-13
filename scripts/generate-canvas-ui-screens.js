#!/usr/bin/env node
/**
 * Generates wireframes of every Loom UI screen as canvas elements.
 *
 * Writes one file per section (Auth, Main, Settings, Popups, Menus) in the canvas clipboard format
 * ({ type: 'loom/canvas', elements: [...] }). Copy a file's content, open a Canvas object in Loom and paste (Ctrl/Cmd+V).
 *
 * Usage: node scripts/generate-canvas-ui-screens.js [outputDir]
 */

const fs = require('fs');
const path = require('path');

const OUT = process.argv[2] || path.join(__dirname, '..', 'docs', 'canvas', 'ui-screens');

const W = 1280;
const H = 800;
const GAP_X = 160;
const GAP_Y = 220;
const PER_ROW = 4;
const SIDEBAR = 260;
const HEADER = 52;

const elements = [];
let counter = 0;
let seed = 1;

const id = () => `ui${(++counter).toString(36)}`;

const base = (type, x, y, w, h, param = {}) => {
	const el = {
		id: id(),
		type,
		x: Math.round(x),
		y: Math.round(y),
		w: Math.round(w),
		h: Math.round(h),
		color: 'default',
		strokeWidth: 1,
		roughness: 0,
		seed: seed++,
		fontFamily: 'normal',
		...param,
	};

	elements.push(el);
	return el;
};

// --------------------------------------------------------- //
// Primitives, coordinates are relative to the current screen

let ox = 0;
let oy = 0;

const box = (x, y, w, h, p = {}) => base('rect', ox + x, oy + y, w, h, {
	fill: p.fill || '',
	fillStyle: 'solid',
	rounded: (p.rounded !== undefined) ? p.rounded : true,
	color: p.color || 'grey',
	strokeWidth: p.strokeWidth || 1,
	strokeStyle: p.dashed ? 'dashed' : 'solid',
	text: p.text || '',
	fontSize: p.fontSize || 14,
	textAlign: p.align || 'center',
	verticalAlign: 'middle',
	opacity: p.opacity,
});

const label = (x, y, text, p = {}) => {
	const size = p.size || 14;
	const w = p.w || Math.max(20, Math.ceil(text.length * size * 0.56));

	return base('text', ox + x, oy + y, w, Math.ceil(size * 1.3), {
		text,
		fontSize: size,
		color: p.color || 'default',
		textAlign: p.align || 'left',
		verticalAlign: 'top',
	});
};

const circle = (x, y, d, p = {}) => base('ellipse', ox + x, oy + y, d, d, {
	fill: p.fill || '',
	fillStyle: 'solid',
	color: p.color || 'grey',
	text: p.text || '',
	fontSize: p.fontSize || 12,
});

const line = (x1, y1, x2, y2, p = {}) => base(p.arrow ? 'arrow' : 'line', ox + Math.min(x1, x2), oy + Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1), {
	points: [ [ x1 - Math.min(x1, x2), y1 - Math.min(y1, y2) ], [ x2 - Math.min(x1, x2), y2 - Math.min(y1, y2) ] ],
	color: p.color || 'grey',
	strokeStyle: p.dashed ? 'dashed' : 'solid',
	arrowType: 'sharp',
	startHead: 'none',
	endHead: p.arrow ? 'arrow' : 'none',
	text: p.text || '',
	fontSize: 12,
});

const button = (x, y, w, text, p = {}) => box(x, y, w, p.h || 36, { fill: p.primary ? 'blue' : '', color: p.primary ? 'blue' : 'grey', text, fontSize: p.size || 14 });
const input = (x, y, w, placeholder, p = {}) => box(x, y, w, p.h || 36, { text: placeholder, align: 'left', fontSize: 13, color: 'grey' });
const icon = (x, y, d = 20, p = {}) => box(x, y, d, d, { fill: p.fill || 'grey', color: p.color || 'grey', rounded: true, text: p.text || '', fontSize: 10 });
const lines = (x, y, w, count, p = {}) => {
	for (let i = 0; i < count; i++) {
		const lw = (i == count - 1) ? w * 0.6 : w * (0.85 + ((i * 7) % 3) * 0.05);
		box(x, y + (i * (p.step || 22)), Math.min(w, lw), p.h || 8, { fill: 'grey', color: 'grey', rounded: true });
	};
};
const toggle = (x, y, on) => {
	box(x, y, 34, 20, { fill: on ? 'blue' : 'grey', color: on ? 'blue' : 'grey', rounded: true });
	circle(x + (on ? 16 : 2), y + 2, 16, { fill: 'grey', color: 'grey' });
};
const row = (x, y, w, title, value, p = {}) => {
	label(x, y + 8, title, { size: 14 });
	if (value == 'toggle' || value == 'toggleOff') {
		toggle(x + w - 34, y + 6, value == 'toggle');
	} else
	if (value) {
		label(x + w - 180, y + 8, `${value}  ⌄`, { size: 13, color: 'grey', w: 180, align: 'right' });
	};
	if (!p.last) {
		line(x, y + 36, x + w, y + 36);
	};
};

// --------------------------------------------------------- //
// Shared app parts

const WIDGETS = [
	[ 'Favorites', [ 'Project roadmap', 'Meeting notes', 'Reading list' ] ],
	[ 'Recently edited', [ 'Weekly review', 'Design system', 'Q4 plan' ] ],
	[ 'Pages', [ 'Getting started', 'Ideas' ] ],
	[ 'Tasks', [ 'Fix login bug', 'Write release notes' ] ],
];

const sidebarLeft = (active = '') => {
	box(0, 0, SIDEBAR, H, { fill: 'grey', color: 'grey', rounded: false, opacity: 60 });

	// Space header
	icon(16, 16, 28, { fill: 'blue', color: 'blue', text: 'L' });
	label(54, 20, 'My Space', { size: 15 });
	icon(SIDEBAR - 36, 20, 20);

	// Search and new object
	box(12, 60, SIDEBAR - 60, 32, { text: '⌕  Search', align: 'left', fontSize: 13 });
	box(SIDEBAR - 44, 60, 32, 32, { text: '+', fontSize: 16 });

	// System links
	const links = [ 'All Objects', 'Chat', 'Graph' ];
	links.forEach((name, i) => {
		const y = 104 + (i * 30);
		if (active == name) {
			box(8, y - 4, SIDEBAR - 16, 28, { fill: 'grey', color: 'grey' });
		};
		icon(18, y, 18);
		label(46, y, name, { size: 13 });
	});

	// Widgets
	let y = 210;
	WIDGETS.forEach(([ title, items ]) => {
		const h = 36 + (items.length * 28);
		box(8, y, SIDEBAR - 16, h, { fill: '', color: 'grey' });
		label(20, y + 10, title, { size: 13, color: 'grey' });
		items.forEach((name, i) => {
			icon(20, y + 36 + (i * 28), 16);
			label(44, y + 35 + (i * 28), name, { size: 13 });
		});
		y += h + 10;
	});

	// Bottom
	line(0, H - 52, SIDEBAR, H - 52);
	circle(16, H - 40, 28, { fill: 'purple', color: 'purple', text: 'A' });
	label(52, H - 34, 'Account', { size: 13 });
	icon(SIDEBAR - 76, H - 36, 20);
	icon(SIDEBAR - 44, H - 36, 20);
};

const header = (x, crumbs, p = {}) => {
	line(x, HEADER, W, HEADER);
	icon(x + 12, 16, 20);
	icon(x + 40, 16, 20);
	label(x + 72, 17, crumbs.join('  /  '), { size: 13, color: 'grey', w: 400 });

	let r = W - 16;
	(p.right || [ '⋯', '⇆', 'Share' ]).forEach(name => {
		const w = (name.length > 2) ? (name.length * 8) + 24 : 28;
		r -= w;
		box(r, 12, w, 28, { text: name, fontSize: 13, fill: (name == 'Share') ? 'blue' : '', color: (name == 'Share') ? 'blue' : 'grey' });
		r -= 8;
	});
	if (p.sync !== false) {
		circle(r - 20, 20, 12, { fill: 'lime', color: 'lime' });
	};
};

const sidebarRight = (title, sections) => {
	const x = W - 300;
	box(x, HEADER, 300, H - HEADER, { rounded: false, fill: '', color: 'grey' });
	label(x + 20, HEADER + 18, title, { size: 15 });
	let y = HEADER + 56;
	sections.forEach(([ name, value ]) => {
		icon(x + 20, y + 2, 16);
		label(x + 46, y, name, { size: 13, color: 'grey' });
		label(x + 150, y, value, { size: 13, w: 130 });
		y += 32;
	});
	button(x + 20, y + 10, 260, '+ Add property');
};

const objectHead = (x, y, title, p = {}) => {
	if (p.cover) {
		box((p.coverX !== undefined) ? p.coverX : x - 40, y - 40, p.coverW || 900, 140, { fill: 'ice', color: 'ice', rounded: false });
		y += 80;
	};
	icon(x, y, 56, { fill: p.iconFill || 'yellow', color: p.iconFill || 'yellow', text: p.emoji || '' });
	label(x, y + 72, title, { size: 32, w: 700 });
	if (p.description) {
		label(x, y + 120, p.description, { size: 15, color: 'grey', w: 700 });
	};
	return y + (p.description ? 156 : 124);
};

// --------------------------------------------------------- //
// Screens

const sections = [];
let current = null;

const section = (name) => {
	current = { name, screens: [] };
	sections.push(current);
};

const screen = (name, draw, p = {}) => current.screens.push({ name, draw, w: p.w || W, h: p.h || H });

// Content area of the main layout
const CX = SIDEBAR;
const CW = W - SIDEBAR;

const withShell = (crumbs, draw, p = {}) => () => {
	sidebarLeft(p.active);
	header(CX, crumbs, p.header || {});
	draw();
};

const dimmer = () => box(0, 0, W, H, { fill: 'grey', color: 'grey', rounded: false, opacity: 40 });
const popup = (w, h, title) => {
	const x = (W - w) / 2;
	const y = (H - h) / 2;
	box(x, y, w, h, { fill: '', color: 'default', strokeWidth: 1 });
	if (title) {
		label(x + 24, y + 24, title, { size: 20, w: w - 48 });
	};
	return { x, y };
};

const appBehind = () => {
	sidebarLeft();
	header(CX, [ 'My Space', 'Meeting notes' ]);
	objectHead(CX + 120, 110, 'Meeting notes');
	lines(CX + 120, 260, 600, 8);
	dimmer();
};

const menu = (x, y, w, items, p = {}) => {
	const h = 16 + items.reduce((acc, it) => acc + ((it == '-') ? 9 : (it[0] == '#') ? 28 : 32), 0);
	box(x, y, w, h, { fill: '', color: 'default' });
	let cy = y + 8;
	items.forEach(it => {
		if (it == '-') {
			line(x + 12, cy + 4, x + w - 12, cy + 4);
			cy += 9;
			return;
		};
		if (it[0] == '#') {
			label(x + 16, cy + 6, it.slice(1), { size: 12, color: 'grey' });
			cy += 28;
			return;
		};
		const [ name, caption ] = it.split('|');
		if (p.active == name) {
			box(x + 6, cy, w - 12, 30, { fill: 'grey', color: 'grey' });
		};
		if (p.icons !== false) {
			icon(x + 16, cy + 7, 16);
		};
		label(x + ((p.icons !== false) ? 42 : 16), cy + 7, name, { size: 13, color: name.startsWith('Delete') ? 'red' : 'default' });
		if (caption) {
			label(x + w - 90, cy + 7, caption, { size: 12, color: 'grey', w: 74, align: 'right' });
		};
		cy += 32;
	});
	return h;
};

// ---- Auth ---- //

section('Auth');

screen('Select', () => {
	box(0, 0, W, H, { fill: '', color: 'grey', rounded: false });
	circle(W / 2 - 160, 150, 320, { color: 'ice', fill: 'ice' });
	label(0, 300, 'a safe haven', { size: 44, w: W, align: 'center' });
	label(0, 360, 'for digital collaboration', { size: 28, w: W, align: 'center', color: 'grey' });
	button(W / 2 - 140, 520, 280, 'I am new here', { primary: true, h: 44 });
	button(W / 2 - 140, 576, 280, 'I already have a Key', { h: 44 });
	label(0, H - 50, 'By continuing you agree to the Terms of Use and Privacy Policy', { size: 12, w: W, align: 'center', color: 'grey' });
});

screen('Login', () => {
	icon(24, 24, 28, { text: '←' });
	label(0, 220, 'Welcome back', { size: 36, w: W, align: 'center' });
	label(0, 274, 'Enter your key to access your vault', { size: 16, w: W, align: 'center', color: 'grey' });
	box(W / 2 - 240, 330, 480, 120, { text: 'witch collapse practice feed shame open despair creek road again ice least', fontSize: 14, color: 'grey' });
	button(W / 2 - 140, 480, 280, 'Enter', { primary: true, h: 44 });
	label(0, 540, 'Lost your key?', { size: 13, w: W, align: 'center', color: 'grey' });
});

screen('Onboarding · Key', () => {
	icon(24, 24, 28, { text: '←' });
	box(W / 2 - 60, 60, 120, 6, { fill: 'blue', color: 'blue' });
	label(0, 150, 'This is your Key', { size: 36, w: W, align: 'center' });
	lines(W / 2 - 260, 210, 520, 2, { h: 10, step: 24 });
	box(W / 2 - 280, 290, 560, 160, { text: '•••• •••• •••• •••• •••• •••• •••• •••• •••• •••• •••• ••••', fontSize: 18 });
	button(W / 2 - 140, 490, 280, 'Show my Key', { primary: true, h: 44 });
	button(W / 2 - 140, 546, 280, 'Not now', { h: 44 });
});

screen('Onboarding · Email', () => {
	icon(24, 24, 28, { text: '←' });
	box(W / 2 - 60, 60, 120, 6, { fill: 'blue', color: 'blue' });
	label(0, 200, 'Stay in the loop', { size: 36, w: W, align: 'center' });
	lines(W / 2 - 260, 260, 520, 2, { h: 10, step: 24 });
	input(W / 2 - 200, 340, 400, 'Enter your email', { h: 44 });
	label(W / 2 - 200, 404, '☐  Subscribe to tips and product news', { size: 13, w: 400, color: 'grey' });
	button(W / 2 - 140, 470, 280, 'Continue', { primary: true, h: 44 });
	button(W / 2 - 140, 526, 280, 'Skip', { h: 44 });
});

screen('Onboarding · Use case', () => {
	label(0, 90, 'What will you use Loom for?', { size: 32, w: W, align: 'center' });
	[ 'Personal notes', 'Projects', 'Knowledge base', 'Team wiki', 'Journal', 'Empty space' ].forEach((name, i) => {
		const x = 220 + ((i % 3) * 290);
		const y = 180 + (Math.floor(i / 3) * 250);
		box(x, y, 260, 220, { color: (i == 1) ? 'blue' : 'grey' });
		box(x + 16, y + 16, 228, 130, { fill: 'grey', color: 'grey' });
		label(x + 16, y + 160, name, { size: 15 });
		label(x + 16, y + 184, 'Template with types and views', { size: 12, color: 'grey', w: 228 });
	});
	button(W / 2 - 140, 720, 280, 'Continue', { primary: true, h: 44 });
});

screen('Setup / Loading', () => {
	circle(W / 2 - 24, H / 2 - 60, 48, { color: 'blue' });
	label(0, H / 2 + 10, 'Setting up your vault…', { size: 16, w: W, align: 'center', color: 'grey' });
	box(W / 2 - 150, H / 2 + 50, 300, 6, { fill: 'grey', color: 'grey' });
	box(W / 2 - 150, H / 2 + 50, 180, 6, { fill: 'blue', color: 'blue' });
});

screen('Pin Check', () => {
	label(0, 260, 'Enter Pin', { size: 32, w: W, align: 'center' });
	for (let i = 0; i < 6; i++) {
		box(W / 2 - 165 + (i * 56), 330, 44, 52, { text: (i < 3) ? '•' : '', fontSize: 24 });
	};
	label(0, 420, 'Forgot your pin? Log in with your key', { size: 13, w: W, align: 'center', color: 'grey' });
});

screen('Deleted Account', () => {
	circle(W / 2 - 60, 160, 120, { color: 'red', text: '⏳', fontSize: 40 });
	label(0, 320, 'This profile is planned for deletion', { size: 28, w: W, align: 'center' });
	lines(W / 2 - 260, 380, 520, 3, { h: 10, step: 24 });
	button(W / 2 - 140, 490, 280, 'Cancel deletion', { primary: true, h: 44 });
	button(W / 2 - 140, 546, 280, 'Delete data now', { h: 44 });
	button(W / 2 - 140, 602, 280, 'Log out', { h: 44 });
});

screen('Migration', () => {
	label(0, 280, 'Migrating your data', { size: 32, w: W, align: 'center' });
	label(0, 330, 'This can take a few minutes, keep Loom open', { size: 15, w: W, align: 'center', color: 'grey' });
	box(W / 2 - 200, 400, 400, 8, { fill: 'grey', color: 'grey' });
	box(W / 2 - 200, 400, 260, 8, { fill: 'blue', color: 'blue' });
	label(0, 430, '65%', { size: 13, w: W, align: 'center', color: 'grey' });
});

// ---- Main ---- //

section('Main');

screen('Editor · Page', withShell([ 'My Space', 'Meeting notes' ], () => {
	const x = CX + 140;
	let y = objectHead(x, HEADER + 40, 'Meeting notes', { cover: true, coverX: CX, coverW: CW, emoji: '📝', description: 'Weekly sync with the product team' });
	label(x, y, 'Agenda', { size: 22 });
	y += 40;
	[ '☐  Review last week tasks', '☑  Roadmap update', '☐  Hiring' ].forEach((t, i) => label(x, y + (i * 28), t, { size: 15, w: 500 }));
	y += 100;
	lines(x, y, 700, 4);
	y += 100;
	box(x, y, 700, 100, { fill: 'grey', color: 'grey', text: 'const block = new Block();', fontSize: 13, align: 'left' });
	y += 120;
	box(x, y, 700, 50, { fill: 'yellow', color: 'yellow', text: '💡  Callout block', align: 'left' });
	// Block handle and add
	icon(x - 46, HEADER + 380, 16, { fill: '', text: '+' });
	icon(x - 26, HEADER + 380, 16, { fill: '', text: '⋮⋮' });
}));

screen('Editor · Page with properties', withShell([ 'My Space', 'Fix login bug' ], () => {
	const x = CX + 80;
	let y = objectHead(x, HEADER + 40, 'Fix login bug', { emoji: '✅', iconFill: 'lime' });
	lines(x, y, 520, 6);
	sidebarRight('Properties', [ [ 'Type', 'Task' ], [ 'Status', 'In progress' ], [ 'Priority', 'High' ], [ 'Assignee', 'Anna' ], [ 'Due date', 'Nov 20, 2026' ], [ 'Tag', 'auth, bug' ], [ 'Created', 'Nov 2, 2026' ] ]);
}));

screen('Set · Grid view', withShell([ 'My Space', 'Tasks' ], () => {
	const x = CX + 48;
	objectHead(x, HEADER + 30, 'Tasks', { emoji: '☑' });
	const ty = HEADER + 190;
	[ 'Grid', 'Board', 'Gallery', 'Calendar' ].forEach((v, i) => label(x + (i * 90), ty, v, { size: 14, color: i ? 'grey' : 'default' }));
	[ '⚲', '⇅', '⚙' ].forEach((v, i) => icon(W - 260 + (i * 32), ty, 20, { fill: '', text: v }));
	button(W - 150, ty - 6, 100, 'New ⌄', { primary: true, h: 30 });
	const cols = [ 'Name', 'Status', 'Priority', 'Assignee', 'Due date' ];
	const cw = (CW - 96) / cols.length;
	let y = ty + 40;
	line(x, y, W - 48, y);
	cols.forEach((c, i) => label(x + (i * cw) + 8, y + 10, c, { size: 13, color: 'grey' }));
	const data = [ [ 'Fix login bug', 'In progress', 'High', 'Anna', 'Nov 20' ], [ 'Write release notes', 'To do', 'Medium', 'Bao', 'Nov 22' ], [ 'Design review', 'Done', 'Low', 'Chi', 'Nov 10' ], [ 'Sync with API team', 'To do', 'High', 'Anna', 'Nov 25' ], [ 'Update docs', 'In review', 'Medium', 'Dung', 'Nov 18' ] ];
	data.forEach((r, j) => {
		y += 40;
		line(x, y, W - 48, y);
		r.forEach((c, i) => {
			if (i == 1) {
				box(x + (i * cw) + 8, y + 9, c.length * 8 + 16, 22, { fill: [ 'yellow', 'grey', 'lime', 'grey', 'blue' ][j], color: 'grey', text: c, fontSize: 12 });
			} else {
				label(x + (i * cw) + 8, y + 11, c, { size: 13 });
			};
		});
	});
	y += 40;
	line(x, y, W - 48, y);
	label(x + 8, y + 11, '+ New', { size: 13, color: 'grey' });
}));

screen('Set · Board view', withShell([ 'My Space', 'Tasks' ], () => {
	const x = CX + 48;
	label(x, HEADER + 30, 'Tasks', { size: 28 });
	[ 'Grid', 'Board', 'Gallery', 'Calendar' ].forEach((v, i) => label(x + (i * 90), HEADER + 90, v, { size: 14, color: (i == 1) ? 'default' : 'grey' }));
	[ [ 'To do', 3, 'grey' ], [ 'In progress', 2, 'yellow' ], [ 'In review', 1, 'blue' ], [ 'Done', 2, 'lime' ] ].forEach(([ name, n, color ], i) => {
		const cx = x + (i * 240);
		box(cx, HEADER + 130, n * 0 + name.length * 8 + 20, 24, { fill: color, color, text: name, fontSize: 12 });
		for (let k = 0; k < n; k++) {
			const cy = HEADER + 170 + (k * 110);
			box(cx, cy, 220, 96, { color: 'grey' });
			label(cx + 12, cy + 12, [ 'Fix login bug', 'Release notes', 'Docs', 'API sync' ][(i + k) % 4], { size: 14 });
			lines(cx + 12, cy + 42, 160, 2, { h: 6, step: 14 });
			circle(cx + 184, cy + 64, 22, { fill: 'purple', color: 'purple' });
		};
		label(cx + 4, HEADER + 170 + (n * 110), '+ New', { size: 13, color: 'grey' });
	});
}));

screen('Set · Gallery view', withShell([ 'My Space', 'Reading list' ], () => {
	const x = CX + 48;
	label(x, HEADER + 30, 'Reading list', { size: 28 });
	[ 'Gallery', 'Grid', 'List' ].forEach((v, i) => label(x + (i * 90), HEADER + 90, v, { size: 14, color: i ? 'grey' : 'default' }));
	for (let i = 0; i < 6; i++) {
		const cx = x + ((i % 3) * 300);
		const cy = HEADER + 130 + (Math.floor(i / 3) * 290);
		box(cx, cy, 280, 270, { color: 'grey' });
		box(cx, cy, 280, 160, { fill: [ 'ice', 'orange', 'teal', 'pink', 'lime', 'purple' ][i], color: 'grey', rounded: false });
		label(cx + 14, cy + 176, [ 'Deep Work', 'Atomic Habits', 'SICP', 'Clean Code', 'Dune', 'Sapiens' ][i], { size: 15 });
		lines(cx + 14, cy + 208, 220, 2, { h: 6, step: 16 });
	};
}));

screen('Set · Calendar view', withShell([ 'My Space', 'Events' ], () => {
	const x = CX + 48;
	label(x, HEADER + 30, 'Events', { size: 28 });
	label(x, HEADER + 90, 'November 2026', { size: 16 });
	button(W - 200, HEADER + 84, 70, 'Today', { h: 28 });
	icon(W - 120, HEADER + 88, 20, { fill: '', text: '‹' });
	icon(W - 90, HEADER + 88, 20, { fill: '', text: '›' });
	const cw = (CW - 96) / 7;
	[ 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun' ].forEach((d, i) => label(x + (i * cw) + 6, HEADER + 130, d, { size: 12, color: 'grey' }));
	for (let r = 0; r < 5; r++) {
		for (let c = 0; c < 7; c++) {
			const d = (r * 7) + c - 5;
			const bx = x + (c * cw);
			const by = HEADER + 154 + (r * 112);
			box(bx, by, cw, 112, { rounded: false, color: 'grey' });
			label(bx + 6, by + 6, (d > 0) && (d <= 30) ? String(d) : '', { size: 12, color: (d == 13) ? 'red' : 'grey' });
			if ([ 4, 13, 18, 25 ].includes(d)) {
				box(bx + 4, by + 32, cw - 8, 22, { fill: 'blue', color: 'blue', text: 'Meeting', fontSize: 11 });
			};
		};
	};
}));

screen('Collection / Query (Type page)', withShell([ 'My Space', 'Types', 'Task' ], () => {
	const x = CX + 48;
	objectHead(x, HEADER + 30, 'Task', { emoji: '☑', description: 'Things to do, with status and due date' });
	button(x, HEADER + 220, 120, 'Templates (3)', { h: 30 });
	button(x + 130, HEADER + 220, 120, 'Properties', { h: 30 });
	for (let i = 0; i < 3; i++) {
		box(x + (i * 200), HEADER + 270, 180, 120, { color: 'grey', text: [ 'Bug', 'Feature', 'Chore' ][i] });
	};
	label(x, HEADER + 420, 'Objects of this type', { size: 16 });
	for (let i = 0; i < 6; i++) {
		icon(x, HEADER + 460 + (i * 34), 18);
		label(x + 30, HEADER + 460 + (i * 34), [ 'Fix login bug', 'Write release notes', 'Design review', 'Sync with API team', 'Update docs', 'Plan Q1' ][i], { size: 14 });
	};
}));

screen('Canvas (whiteboard)', withShell([ 'My Space', 'Brainstorm' ], () => {
	box(CX + 280, 180, 160, 90, { color: 'blue', text: 'Idea' });
	base('diamond', ox + CX + 520, oy + 170, 160, 110, { color: 'orange', text: 'Decide', fontSize: 14, fontFamily: 'normal', roughness: 0 });
	box(CX + 760, 180, 200, 90, { fill: 'yellow', color: 'yellow', text: 'Sticky note' });
	line(CX + 440, 225, CX + 520, 225, { arrow: true, color: 'default' });
	line(CX + 680, 225, CX + 760, 225, { arrow: true, color: 'default' });
	box(CX + 280, 380, 300, 200, { color: 'grey', text: 'Object card', align: 'left' });
	// Toolbar
	box(CX + (CW / 2) - 230, H - 64, 460, 48, { fill: '', color: 'default' });
	[ '↖', '✋', '▢', '◇', '◯', '→', '／', '✎', '⌫', 'T', '▤', '▣' ].forEach((t, i) => icon(CX + (CW / 2) - 216 + (i * 37), H - 52, 26, { fill: (i == 0) ? 'blue' : '', color: 'grey', text: t }));
	// Zoom
	box(CX + 16, H - 56, 140, 36, { text: '−   100%   +', fontSize: 13 });
	// Style panel
	box(CX + 16, HEADER + 16, 200, 300, { fill: '', color: 'default' });
	label(CX + 30, HEADER + 30, 'Stroke', { size: 12, color: 'grey' });
	[ 'default', 'red', 'orange', 'blue', 'teal', 'lime' ].forEach((c, i) => circle(CX + 30 + (i * 28), HEADER + 54, 20, { fill: (c == 'default') ? 'grey' : c, color: c }));
	label(CX + 30, HEADER + 92, 'Background', { size: 12, color: 'grey' });
	[ 'grey', 'yellow', 'pink', 'ice', 'lime' ].forEach((c, i) => circle(CX + 30 + (i * 28), HEADER + 116, 20, { fill: c, color: c }));
	label(CX + 30, HEADER + 154, 'Stroke width', { size: 12, color: 'grey' });
	[ 1, 2, 3 ].forEach(i => box(CX + 30 + ((i - 1) * 40), HEADER + 176, 32, 28, { text: '—'.repeat(1), fontSize: 8 + (i * 4) }));
	label(CX + 30, HEADER + 220, 'Sloppiness', { size: 12, color: 'grey' });
	[ 1, 2, 3 ].forEach(i => box(CX + 30 + ((i - 1) * 40), HEADER + 242, 32, 28, { text: '~' }));
}, { header: { right: [ '⋯', '⇆', 'Share' ] } }));

screen('Graph', withShell([ 'My Space', 'Graph' ], () => {
	const nodes = [ [ 640, 380, 'Home' ], [ 480, 250, 'Projects' ], [ 820, 240, 'Notes' ], [ 450, 520, 'Tasks' ], [ 860, 540, 'People' ], [ 640, 180, 'Ideas' ], [ 1020, 380, 'Books' ], [ 360, 380, 'Archive' ], [ 700, 620, 'Inbox' ] ];
	nodes.slice(1).forEach(([ x, y ]) => line(640, 380, x, y));
	line(480, 250, 640, 180);
	line(820, 240, 1020, 380);
	line(450, 520, 700, 620);
	nodes.forEach(([ x, y, name ], i) => {
		circle(x - 14, y - 14, i ? 28 : 40, { fill: [ 'blue', 'orange', 'teal', 'lime', 'pink', 'yellow', 'purple', 'grey', 'ice' ][i], color: 'grey' });
		label(x - 40, y + (i ? 18 : 30), name, { size: 12, w: 80, align: 'center', color: 'grey' });
	});
	box(CX + 16, HEADER + 16, 240, 36, { text: '⌕  Search in graph', align: 'left', fontSize: 13 });
	box(W - 56, HEADER + 16, 36, 36, { text: '⚙' });
}, { active: 'Graph' }));

screen('Chat (space chat)', withShell([ 'My Space', 'Chat' ], () => {
	const x = CX + 120;
	const msgs = [ [ 'Anna', 'Hi team, the build is green 🎉', false ], [ 'Bao', 'Great! I will start the release notes.', false ], [ 'You', 'Thanks, I pushed the canvas paste feature.', true ], [ 'Chi', 'Reviewing it now', false ] ];
	msgs.forEach(([ name, text, own ], i) => {
		const y = HEADER + 60 + (i * 110);
		const bx = own ? W - 140 - 420 : x + 44;
		if (!own) {
			circle(x, y + 20, 34, { fill: [ 'purple', 'teal', '', 'orange' ][i], color: 'grey' });
		};
		box(bx, y, 420, 80, { fill: own ? 'ice' : '', color: 'grey' });
		label(bx + 14, y + 12, name, { size: 13, color: 'grey' });
		label(bx + 14, y + 38, text, { size: 14, w: 390 });
	});
	box(x, H - 110, CW - 240, 80, { text: 'Write a message…', align: 'left', fontSize: 14 });
	icon(W - 170, H - 60, 24, { fill: '', text: '📎' });
	icon(W - 140, H - 60, 24, { fill: 'blue', color: 'blue', text: '↑' });
}, { active: 'Chat' }));

screen('One-to-one chat', withShell([ 'Direct', 'Anna' ], () => {
	circle(CX + CW / 2 - 40, HEADER + 40, 80, { fill: 'purple', color: 'purple', text: 'A', fontSize: 28 });
	label(CX, HEADER + 130, 'Anna', { size: 20, w: CW, align: 'center' });
	label(CX, HEADER + 160, 'You are connected end-to-end encrypted', { size: 13, w: CW, align: 'center', color: 'grey' });
	box(CX + 120, HEADER + 230, 360, 60, { color: 'grey', text: 'Hey! Can you share the plan?', align: 'left' });
	box(W - 120 - 360, HEADER + 310, 360, 60, { fill: 'ice', color: 'grey', text: 'Sure, sending the link now', align: 'left' });
	box(CX + 120, H - 110, CW - 240, 80, { text: 'Write a message…', align: 'left' });
}));

screen('All Objects', withShell([ 'My Space', 'All Objects' ], () => {
	const x = CX + 48;
	label(x, HEADER + 30, 'All Objects', { size: 28 });
	[ 'Pages', 'Lists', 'Media', 'Bookmarks', 'Files', 'Types', 'Properties' ].forEach((t, i) => box(x + (i * 104), HEADER + 86, 96, 30, { text: t, fontSize: 13, fill: i ? '' : 'grey' }));
	box(W - 240, HEADER + 86, 190, 30, { text: '⌕  Search', align: 'left', fontSize: 13 });
	for (let i = 0; i < 12; i++) {
		const y = HEADER + 140 + (i * 44);
		icon(x, y + 10, 22);
		label(x + 36, y + 6, [ 'Meeting notes', 'Project roadmap', 'Q4 plan', 'Weekly review', 'Design system', 'Getting started', 'Ideas', 'Reading list', 'Brainstorm', 'Fix login bug', 'Release 0.55', 'Team wiki' ][i], { size: 14 });
		label(x + 36, y + 24, 'Page · edited 2 days ago', { size: 11, color: 'grey', w: 300 });
		line(x, y + 42, W - 48, y + 42);
	};
}, { active: 'All Objects' }));

screen('Media (image)', withShell([ 'My Space', 'photo.jpg' ], () => {
	box(CX + 120, HEADER + 60, CW - 240, 460, { fill: 'teal', color: 'grey', text: '🖼  Image preview' });
	label(CX + 120, HEADER + 540, 'photo.jpg', { size: 24 });
	[ [ 'Size', '2.4 MB' ], [ 'Dimensions', '3024 × 4032' ], [ 'Added', 'Nov 3, 2026' ] ].forEach(([ k, v ], i) => {
		label(CX + 120, HEADER + 590 + (i * 28), k, { size: 13, color: 'grey' });
		label(CX + 260, HEADER + 590 + (i * 28), v, { size: 13 });
	});
	button(W - 340, HEADER + 540, 100, 'Open', { h: 32 });
	button(W - 230, HEADER + 540, 110, 'Download', { h: 32 });
}));

screen('Date', withShell([ 'My Space', 'Nov 13, 2026' ], () => {
	const x = CX + 48;
	label(x, HEADER + 30, 'Friday, Nov 13, 2026', { size: 28, w: 600 });
	icon(x + 360, HEADER + 38, 22, { fill: '', text: '‹' });
	icon(x + 390, HEADER + 38, 22, { fill: '', text: '›' });
	icon(x + 420, HEADER + 38, 22, { fill: '', text: '📅' });
	[ 'Mentions', 'Created', 'Modified', 'Due date' ].forEach((t, i) => box(x + (i * 120), HEADER + 96, 110, 30, { text: t, fontSize: 13, fill: i ? '' : 'grey' }));
	for (let i = 0; i < 6; i++) {
		const y = HEADER + 150 + (i * 44);
		icon(x, y + 10, 22);
		label(x + 36, y + 12, [ 'Daily note', 'Fix login bug', 'Standup', 'Design review', 'Q4 plan', 'Lunch with Bao' ][i], { size: 14 });
		line(x, y + 42, W - 48, y + 42);
	};
}));

screen('Relation (property page)', withShell([ 'My Space', 'Properties', 'Status' ], () => {
	const x = CX + 80;
	objectHead(x, HEADER + 40, 'Status', { emoji: '◉' });
	label(x, HEADER + 200, 'Format: Select', { size: 14, color: 'grey' });
	[ [ 'To do', 'grey' ], [ 'In progress', 'yellow' ], [ 'In review', 'blue' ], [ 'Done', 'lime' ] ].forEach(([ t, c ], i) => box(x + (i * 130), HEADER + 240, 120, 26, { fill: c, color: c, text: t, fontSize: 12 }));
	label(x, HEADER + 300, 'Objects with this property', { size: 16 });
	lines(x, HEADER + 340, 700, 6, { step: 32 });
}));

screen('Version History', () => {
	box(0, 0, W - 300, H, { rounded: false, color: 'grey' });
	header(0, [ 'Meeting notes', 'Version history' ], { right: [ 'Restore' ], sync: false });
	objectHead(140, HEADER + 40, 'Meeting notes');
	lines(140, HEADER + 190, 600, 4);
	box(140, HEADER + 290, 600, 70, { fill: 'lime', color: 'lime', opacity: 50, text: '+ Added paragraph', align: 'left' });
	box(140, HEADER + 370, 600, 40, { fill: 'red', color: 'red', opacity: 40, text: '− Removed line', align: 'left' });
	const x = W - 300;
	label(x + 20, 20, 'Version history', { size: 16 });
	[ 'Today', 'Yesterday', 'Nov 10' ].forEach((d, g) => {
		label(x + 20, 70 + (g * 200), d, { size: 12, color: 'grey' });
		for (let i = 0; i < 3; i++) {
			const y = 96 + (g * 200) + (i * 50);
			if (!g && !i) {
				box(x + 10, y - 6, 280, 46, { fill: 'grey', color: 'grey' });
			};
			circle(x + 20, y, 24, { fill: 'purple', color: 'purple' });
			label(x + 54, y, `${10 + i}:${20 + (g * 7)} · Anna`, { size: 13 });
			label(x + 54, y + 18, `${3 + i} changes`, { size: 11, color: 'grey' });
		};
	});
});

screen('Bin (Archive)', withShell([ 'Settings', 'Bin' ], () => {
	const x = CX + 48;
	label(x, HEADER + 30, 'Bin', { size: 28 });
	[ 'Deleted', 'Suggestions (4)' ].forEach((t, i) => box(x + (i * 150), HEADER + 86, 140, 30, { text: t, fontSize: 13, fill: i ? '' : 'grey' }));
	button(W - 340, HEADER + 86, 130, 'Restore all', { h: 30 });
	button(W - 200, HEADER + 86, 150, 'Delete all', { h: 30 });
	for (let i = 0; i < 8; i++) {
		const y = HEADER + 140 + (i * 44);
		box(x, y + 12, 16, 16, { color: 'grey' });
		icon(x + 30, y + 10, 22);
		label(x + 66, y + 12, [ 'Old draft', 'Copy of roadmap', 'Untitled', 'Test page', 'Old meeting', 'Scratch', 'Temp list', 'Image 01' ][i], { size: 14 });
		label(W - 260, y + 12, 'Deleted 3 days ago', { size: 12, color: 'grey', w: 200, align: 'right' });
		line(x, y + 42, W - 48, y + 42);
	};
}));

screen('Navigation (links)', withShell([ 'My Space', 'Navigation' ], () => {
	const cy = HEADER + 300;
	box(CX + CW / 2 - 140, cy - 140, 280, 320, { color: 'default' });
	box(CX + CW / 2 - 140, cy - 140, 280, 120, { fill: 'ice', color: 'grey' });
	label(CX + CW / 2 - 120, cy, 'Meeting notes', { size: 18 });
	lines(CX + CW / 2 - 120, cy + 40, 230, 3, { h: 6, step: 16 });
	label(CX + 30, HEADER + 30, 'Links to (3)', { size: 13, color: 'grey' });
	label(W - 200, HEADER + 30, 'Linked from (2)', { size: 13, color: 'grey' });
	[ 0, 1, 2 ].forEach(i => {
		box(CX + 30, HEADER + 70 + (i * 90), 220, 70, { text: [ 'Roadmap', 'Q4 plan', 'Anna' ][i] });
		line(CX + 250, HEADER + 105 + (i * 90), CX + CW / 2 - 140, cy + 20, { arrow: false });
	});
	[ 0, 1 ].forEach(i => {
		box(W - 250, HEADER + 70 + (i * 90), 220, 70, { text: [ 'Weekly review', 'Team wiki' ][i] });
		line(CX + CW / 2 + 140, cy + 20, W - 250, HEADER + 105 + (i * 90));
	});
}));

screen('Invite', () => {
	box(0, 0, W, H, { rounded: false, color: 'grey' });
	popup(440, 380, '');
	circle(W / 2 - 40, 250, 80, { fill: 'blue', color: 'blue', text: 'T', fontSize: 28 });
	label(0, 350, 'Join “Team Space”', { size: 22, w: W, align: 'center' });
	label(0, 386, 'Anna invited you to collaborate', { size: 14, w: W, align: 'center', color: 'grey' });
	button(W / 2 - 180, 450, 360, 'Request to join', { primary: true, h: 40 });
	button(W / 2 - 180, 500, 360, 'Cancel', { h: 40 });
});

screen('Import (deep link)', () => {
	box(0, 0, W, H, { rounded: false, color: 'grey' });
	popup(440, 320, '');
	label(0, 300, 'Import experience', { size: 22, w: W, align: 'center' });
	label(0, 340, '“Project template” will be added to your space', { size: 14, w: W, align: 'center', color: 'grey' });
	button(W / 2 - 180, 410, 360, 'Import', { primary: true, h: 40 });
	button(W / 2 - 180, 460, 360, 'Cancel', { h: 40 });
});

screen('Blank / Void', () => {
	box(0, 0, W, H, { rounded: false, color: 'grey' });
	circle(W / 2 - 40, 300, 80, { color: 'grey', text: '∅', fontSize: 30 });
	label(0, 410, 'Nothing here yet', { size: 22, w: W, align: 'center' });
	label(0, 446, 'Create a space or join one to get started', { size: 14, w: W, align: 'center', color: 'grey' });
	button(W / 2 - 120, 500, 240, 'Create space', { primary: true, h: 40 });
});

screen('Vault (spaces list)', () => {
	box(0, 0, SIDEBAR, H, { fill: 'grey', color: 'grey', rounded: false, opacity: 60 });
	label(16, 20, 'Vault', { size: 18 });
	icon(SIDEBAR - 76, 20, 22, { fill: '', text: '⌕' });
	icon(SIDEBAR - 44, 20, 22, { fill: '', text: '+' });
	[ 'My Space', 'Team Space', 'Family', 'Anna (chat)', 'Book club', 'Side project' ].forEach((name, i) => {
		const y = 70 + (i * 60);
		if (!i) {
			box(8, y - 6, SIDEBAR - 16, 56, { fill: 'grey', color: 'grey' });
		};
		icon(18, y, 44, { fill: [ 'blue', 'teal', 'orange', 'purple', 'pink', 'lime' ][i], color: 'grey', text: name[0] });
		label(74, y + 4, name, { size: 14 });
		label(74, y + 24, i == 3 ? 'See you tomorrow!' : 'Edited today', { size: 12, color: 'grey', w: 170 });
	});
	label(SIDEBAR + 40, 40, 'Select a space on the left', { size: 18, color: 'grey', w: 400 });
});

// ---- Settings ---- //

section('Settings');

const SETTINGS_APP = [
	[ '', [ 'Account' ] ],
	[ 'Application', [ 'Preferences', 'Language', 'Keyboard shortcuts', 'Pin Code' ] ],
	[ 'Vault & Key', [ 'Login Key', 'Membership' ] ],
	[ 'Data Management', [ 'Local storage', 'Channels', 'Sites', 'API keys', 'Plugins' ] ],
];

const SETTINGS_SPACE = [
	[ 'Preferences', [ 'General', 'Members', 'Notifications', 'Storage', 'Bin' ] ],
	[ 'Content Model', [ 'Types', 'Properties' ] ],
	[ 'Integrations', [ 'Import', 'Export' ] ],
	[ '', [ 'Delete Channel' ] ],
];

const settingsShell = (groups, active, title, draw) => () => {
	box(0, 0, SIDEBAR, H, { fill: 'grey', color: 'grey', rounded: false, opacity: 60 });
	icon(16, 18, 20, { fill: '', text: '←' });
	label(44, 18, 'Settings', { size: 15 });
	let y = 64;
	groups.forEach(([ name, items ]) => {
		if (name) {
			label(16, y, name, { size: 12, color: 'grey' });
			y += 26;
		};
		items.forEach(it => {
			if (it == active) {
				box(8, y - 4, SIDEBAR - 16, 28, { fill: 'grey', color: 'grey' });
			};
			icon(18, y, 18);
			label(46, y, it, { size: 13, color: it.startsWith('Delete') ? 'red' : 'default' });
			y += 32;
		});
		y += 12;
	});
	line(0, H - 52, SIDEBAR, H - 52);
	label(16, H - 34, 'Log out', { size: 13, color: 'grey' });

	const x = SIDEBAR + 140;
	label(x, 50, title, { size: 28, w: 700 });
	draw(x, 110, W - SIDEBAR - 280);
};

const appSettings = (active, title, draw) => screen(`Settings · ${active}`, settingsShell(SETTINGS_APP, active, title || active, draw));
const spaceSettings = (active, title, draw) => screen(`Space settings · ${active}`, settingsShell(SETTINGS_SPACE, active, title || active, draw));

appSettings('Account', 'Account', (x, y, w) => {
	circle(x, y, 96, { fill: 'purple', color: 'purple', text: 'A', fontSize: 32 });
	label(x + 120, y + 20, 'Change picture', { size: 13, color: 'blue' });
	label(x, y + 130, 'Name', { size: 13, color: 'grey' });
	input(x, y + 154, w, 'Anna');
	label(x, y + 210, 'Description', { size: 13, color: 'grey' });
	input(x, y + 234, w, 'Product designer', { h: 80 });
	label(x, y + 340, 'Account ID', { size: 13, color: 'grey' });
	box(x, y + 364, w, 36, { fill: 'grey', color: 'grey', text: 'bafyreih…x4q', align: 'left', fontSize: 13 });
});

appSettings('Preferences', 'Preferences', (x, y, w) => {
	label(x, y, 'Appearance', { size: 16 });
	[ 'System', 'Light', 'Dark' ].forEach((t, i) => {
		box(x + (i * 150), y + 34, 136, 90, { fill: [ 'grey', '', 'grey' ][i], color: i ? 'grey' : 'blue', opacity: (i == 2) ? 100 : 100 });
		label(x + (i * 150), y + 132, t, { size: 13, w: 136, align: 'center' });
	});
	y += 180;
	[ [ 'Spell check', 'toggle' ], [ 'Open objects in', 'Full page' ], [ 'Show sidebar on hover', 'toggleOff' ], [ 'Auto-download updates', 'toggle' ], [ 'Hide tray icon', 'toggleOff' ], [ 'Date format', 'MMM D, YYYY' ], [ 'Relative dates', 'toggle' ] ].forEach(([ k, v ], i, a) => row(x, y + (i * 44), w, k, v, { last: i == a.length - 1 }));
});

appSettings('Language', 'Language', (x, y, w) => {
	row(x, y, w, 'Interface language', 'English');
	row(x, y + 44, w, 'Spelling languages', 'English, Vietnamese', { last: true });
	label(x, y + 110, 'Help us translate Loom into your language', { size: 13, color: 'blue', w: 400 });
});

appSettings('Keyboard shortcuts', 'Keyboard shortcuts', (x, y, w) => {
	input(x, y, w, '⌕  Search shortcuts');
	[ '#Basics', 'New object|Ctrl N', 'Search|Ctrl K', 'Settings|Ctrl ,', 'Lock / unlock page|Ctrl Shift L', '#Editor', 'Bold|Ctrl B', 'Italic|Ctrl I', 'Turn into heading|Ctrl Alt 1', 'Duplicate block|Ctrl D', '#Canvas', 'Rectangle|R', 'Arrow|A' ].forEach((it, i) => {
		const cy = y + 54 + (i * 36);
		if (it[0] == '#') {
			label(x, cy + 8, it.slice(1), { size: 12, color: 'grey' });
			return;
		};
		const [ k, v ] = it.split('|');
		label(x, cy + 8, k, { size: 14 });
		box(x + w - 140, cy + 4, 140, 26, { fill: 'grey', color: 'grey', text: v, fontSize: 12 });
	});
});

appSettings('Pin Code', 'Pin Code', (x, y, w) => {
	lines(x, y, w, 2, { h: 10, step: 24 });
	row(x, y + 70, w, 'Pin code', 'toggle');
	row(x, y + 114, w, 'Pin code check time-out', '5 minutes');
	row(x, y + 158, w, 'Change pin code', '›', { last: true });
});

appSettings('Login Key', 'Login Key', (x, y, w) => {
	lines(x, y, w, 3, { h: 10, step: 24 });
	box(x, y + 90, w, 150, { fill: 'grey', color: 'grey', text: '•••• •••• •••• •••• •••• •••• •••• •••• •••• •••• •••• ••••', fontSize: 18 });
	button(x, y + 260, 200, 'Show key', { primary: true });
	button(x + 210, y + 260, 200, 'Copy', {});
	label(x, y + 330, 'Delete vault', { size: 14, color: 'red' });
});

appSettings('Membership', 'Membership', (x, y, w) => {
	[ [ 'Explorer', 'Free', 'grey' ], [ 'Builder', '$99 / year', 'blue' ], [ 'Co-creator', '$299 / 3 years', 'purple' ] ].forEach(([ n, p, c ], i) => {
		const bx = x + (i * ((w + 20) / 3));
		const bw = ((w + 20) / 3) - 20;
		box(bx, y, bw, 360, { color: c });
		icon(bx + 16, y + 16, 40, { fill: c, color: c });
		label(bx + 16, y + 70, n, { size: 18 });
		lines(bx + 16, y + 106, bw - 32, 5, { h: 6, step: 18 });
		label(bx + 16, y + 220, p, { size: 16 });
		button(bx + 16, y + 300, bw - 32, i ? 'Upgrade' : 'Current', { primary: !!i });
	});
});

appSettings('Local storage', 'Data Management', (x, y, w) => {
	label(x, y, 'Local storage', { size: 16 });
	box(x, y + 34, w, 10, { fill: 'grey', color: 'grey' });
	box(x, y + 34, w * 0.4, 10, { fill: 'blue', color: 'blue' });
	label(x, y + 52, '1.2 GB of 3 GB used on this device', { size: 13, color: 'grey', w: 400 });
	row(x, y + 100, w, 'Offload files', '›');
	row(x, y + 144, w, 'Data location', '~/Library/Loom');
	row(x, y + 188, w, 'Debug mode', 'toggleOff', { last: true });
});

appSettings('Channels', 'Channels', (x, y, w) => {
	const cols = [ 'Name', 'Access', 'Network', 'Device' ];
	cols.forEach((c, i) => label(x + (i * w / 4), y, c, { size: 12, color: 'grey' }));
	[ 'My Space', 'Team Space', 'Family', 'Book club' ].forEach((n, j) => {
		const cy = y + 30 + (j * 48);
		line(x, cy, x + w, cy);
		icon(x, cy + 12, 24, { fill: [ 'blue', 'teal', 'orange', 'pink' ][j], color: 'grey' });
		label(x + 34, cy + 15, n, { size: 14 });
		label(x + w / 4, cy + 15, j ? 'Editor' : 'Owner', { size: 13 });
		label(x + w / 2, cy + 15, 'Synced', { size: 13, color: 'lime' });
		label(x + 3 * w / 4, cy + 15, 'Synced', { size: 13, color: 'lime' });
	});
});

appSettings('Sites', 'Sites', (x, y, w) => {
	lines(x, y, w, 2, { h: 10, step: 24 });
	[ 'Product docs', 'Changelog', 'Personal blog' ].forEach((n, j) => {
		const cy = y + 70 + (j * 64);
		box(x, cy, w, 56, { color: 'grey' });
		label(x + 16, cy + 9, n, { size: 14 });
		label(x + 16, cy + 30, `loom.site/anna/${n.toLowerCase().replace(/ /g, '-')}`, { size: 12, color: 'grey', w: 400 });
		icon(x + w - 36, cy + 18, 20, { fill: '', text: '⋯' });
	});
});

appSettings('API keys', 'API keys', (x, y, w) => {
	lines(x, y, w, 2, { h: 10, step: 24 });
	button(x, y + 64, 160, 'Create new', { primary: true });
	[ 'Raycast', 'CLI on laptop' ].forEach((n, j) => {
		const cy = y + 130 + (j * 48);
		line(x, cy, x + w, cy);
		label(x, cy + 15, n, { size: 14 });
		label(x + w / 2, cy + 15, 'Created Nov 1, 2026', { size: 13, color: 'grey', w: 200 });
		label(x + w - 60, cy + 15, 'Revoke', { size: 13, color: 'red' });
	});
});

appSettings('Plugins', 'Plugins', (x, y, w) => {
	input(x, y, w, '⌕  Search plugins');
	[ [ 'Kanban plus', 'Custom board view for dataview' ], [ 'Pomodoro', 'Focus timer in the sidebar' ], [ 'Word count', 'Shows word count in header' ] ].forEach(([ n, d ], j) => {
		const cy = y + 60 + (j * 80);
		box(x, cy, w, 68, { color: 'grey' });
		icon(x + 16, cy + 16, 36, { fill: [ 'teal', 'red', 'yellow' ][j], color: 'grey' });
		label(x + 66, cy + 14, n, { size: 14 });
		label(x + 66, cy + 36, d, { size: 12, color: 'grey', w: 400 });
		toggle(x + w - 50, cy + 24, j != 2);
	});
});

spaceSettings('General', 'Channel Settings', (x, y, w) => {
	icon(x, y, 96, { fill: 'blue', color: 'blue', text: 'M', fontSize: 32 });
	input(x + 120, y + 10, w - 120, 'My Space', { h: 40 });
	input(x + 120, y + 60, w - 120, 'Add a description');
	row(x, y + 140, w, 'Home', 'Meeting notes');
	row(x, y + 184, w, 'Default object type', 'Page');
	row(x, y + 228, w, 'Created by', 'Anna');
	row(x, y + 272, w, 'Space ID', 'bafyrei…', { last: true });
});

spaceSettings('Members', 'Members', (x, y, w) => {
	box(x, y, w, 90, { color: 'grey' });
	label(x + 16, y + 14, 'Invite link', { size: 14 });
	box(x + 16, y + 44, w - 160, 32, { fill: 'grey', color: 'grey', text: 'https://invite.loom.app/…', align: 'left', fontSize: 12 });
	button(x + w - 130, y + 44, 114, 'Copy', { primary: true, h: 32 });
	[ [ 'Anna', 'Owner' ], [ 'Bao', 'Editor' ], [ 'Chi', 'Viewer' ], [ 'Dung', 'Request' ] ].forEach(([ n, r ], j) => {
		const cy = y + 120 + (j * 52);
		circle(x, cy, 36, { fill: [ 'purple', 'teal', 'orange', 'pink' ][j], color: 'grey', text: n[0] });
		label(x + 50, cy + 8, n, { size: 14 });
		if (r == 'Request') {
			button(x + w - 200, cy + 2, 90, 'Approve', { primary: true, h: 30 });
			button(x + w - 100, cy + 2, 90, 'Reject', { h: 30 });
		} else {
			label(x + w - 120, cy + 8, `${r}  ⌄`, { size: 13, color: 'grey', w: 120, align: 'right' });
		};
	});
});

spaceSettings('Notifications', 'Notifications', (x, y, w) => {
	[ [ 'All activity', true ], [ 'Mentions only', false ], [ 'Mute', false ] ].forEach(([ t, on ], j) => {
		circle(x, y + (j * 44) + 8, 18, { fill: on ? 'blue' : '', color: on ? 'blue' : 'grey' });
		label(x + 30, y + (j * 44) + 8, t, { size: 14 });
	});
});

spaceSettings('Storage', 'Remote storage', (x, y, w) => {
	box(x, y, w, 10, { fill: 'grey', color: 'grey' });
	box(x, y, w * 0.18, 10, { fill: 'blue', color: 'blue' });
	label(x, y + 20, '180 MB of 1 GB used', { size: 13, color: 'grey', w: 300 });
	button(x, y + 60, 160, 'Get more space');
	label(x, y + 130, 'Not synced files (2)', { size: 16 });
	lines(x, y + 170, w, 2, { step: 30 });
});

spaceSettings('Types', 'Types', (x, y, w) => {
	input(x, y, w - 130, '⌕  Search types');
	button(x + w - 120, y, 120, 'New type', { primary: true });
	[ 'Page', 'Note', 'Task', 'Project', 'Book', 'Person', 'Bookmark', 'Canvas', 'Collection' ].forEach((t, j) => {
		const cy = y + 56 + (j * 40);
		icon(x, cy + 8, 22);
		label(x + 34, cy + 10, t, { size: 14 });
		label(x + w - 120, cy + 10, `${(j * 7) % 23 + 2} objects`, { size: 12, color: 'grey', w: 120, align: 'right' });
		line(x, cy + 38, x + w, cy + 38);
	});
});

spaceSettings('Properties', 'Properties', (x, y, w) => {
	input(x, y, w - 150, '⌕  Search properties');
	button(x + w - 140, y, 140, 'New property', { primary: true });
	[ [ 'Status', 'Select' ], [ 'Priority', 'Select' ], [ 'Due date', 'Date' ], [ 'Assignee', 'Object' ], [ 'Tag', 'Multi-select' ], [ 'URL', 'Link' ], [ 'Done', 'Checkbox' ], [ 'Estimate', 'Number' ] ].forEach(([ t, f ], j) => {
		const cy = y + 56 + (j * 40);
		icon(x, cy + 8, 22);
		label(x + 34, cy + 10, t, { size: 14 });
		label(x + w - 140, cy + 10, f, { size: 12, color: 'grey', w: 140, align: 'right' });
		line(x, cy + 38, x + w, cy + 38);
	});
});

spaceSettings('Import', 'Import', (x, y, w) => {
	[ 'Notion', 'Markdown', 'HTML', 'TXT', 'Protobuf', 'CSV', 'Obsidian', 'Any-Block' ].forEach((t, j) => {
		const bx = x + ((j % 4) * ((w + 16) / 4));
		const by = y + (Math.floor(j / 4) * 130);
		box(bx, by, (w + 16) / 4 - 16, 114, { color: 'grey' });
		icon(bx + ((w + 16) / 8) - 28, by + 20, 40);
		label(bx, by + 76, t, { size: 13, w: (w + 16) / 4 - 16, align: 'center' });
	});
	label(x, y + 290, 'AI structure enrichment', { size: 16, w: 400 });
	row(x, y + 324, w, 'Provider', 'Local (Ollama)');
	row(x, y + 368, w, 'Model', 'llama3.1:8b', { last: true });
});

spaceSettings('Export', 'Export Channel', (x, y, w) => {
	[ [ 'Any-Block', 'Full backup, re-import into Loom' ], [ 'Any-Block v2 (preview)', 'New format' ], [ 'Markdown', 'Readable files for other apps' ] ].forEach(([ t, d ], j) => {
		const cy = y + (j * 80);
		box(x, cy, w, 68, { color: 'grey' });
		icon(x + 16, cy + 16, 36);
		label(x + 66, cy + 14, t, { size: 14, w: 300 });
		label(x + 66, cy + 36, d, { size: 12, color: 'grey', w: 400 });
		label(x + w - 30, cy + 22, '›', { size: 18, color: 'grey' });
	});
});

spaceSettings('Delete Channel', 'Delete Channel', (x, y, w) => {
	lines(x, y, w, 3, { h: 10, step: 24 });
	label(x, y + 100, 'Type the channel name to confirm', { size: 13, color: 'grey', w: 400 });
	input(x, y + 126, w, 'My Space');
	button(x, y + 190, 200, 'Delete', { primary: false });
});

// ---- Popups ---- //

section('Popups');

screen('Search (Ctrl K)', () => {
	appBehind();
	const { x, y } = popup(640, 520, '');
	box(x, y, 640, 56, { text: '⌕  Search for an object · / to filter...', align: 'left', fontSize: 15, color: 'grey' });
	label(x + 20, y + 72, 'Recent', { size: 12, color: 'grey' });
	[ 'Meeting notes', 'Project roadmap', 'Fix login bug', 'Weekly review', 'Design system', 'Reading list', 'Brainstorm', 'Q4 plan' ].forEach((t, i) => {
		const cy = y + 96 + (i * 48);
		if (!i) {
			box(x + 8, cy - 4, 624, 44, { fill: 'grey', color: 'grey' });
		};
		icon(x + 20, cy + 6, 24);
		label(x + 56, cy + 2, t, { size: 14 });
		label(x + 56, cy + 20, [ 'Page', 'Project', 'Task', 'Note', 'Page', 'Collection', 'Canvas', 'Page' ][i], { size: 11, color: 'grey' });
	});
});

screen('Usecase / Gallery', () => {
	appBehind();
	const { x, y } = popup(900, 600, 'Experience gallery');
	input(x + 24, y + 70, 852, '⌕  Search');
	for (let i = 0; i < 6; i++) {
		const bx = x + 24 + ((i % 3) * 290);
		const by = y + 124 + (Math.floor(i / 3) * 230);
		box(bx, by, 270, 210, { color: 'grey' });
		box(bx, by, 270, 130, { fill: [ 'ice', 'orange', 'lime', 'pink', 'teal', 'purple' ][i], color: 'grey', rounded: false });
		label(bx + 12, by + 144, [ 'Second brain', 'CRM', 'Habit tracker', 'Recipes', 'Travel', 'Wiki' ][i], { size: 14 });
		label(bx + 12, by + 168, 'by Loom', { size: 12, color: 'grey' });
	};
});

screen('Confirm', () => {
	appBehind();
	const { x, y } = popup(400, 220, 'Delete object?');
	label(x + 24, y + 70, 'It will be moved to the Bin. You can restore it within 30 days.', { size: 14, color: 'grey', w: 352 });
	button(x + 24, y + 150, 168, 'Cancel');
	button(x + 208, y + 150, 168, 'Delete', { primary: true });
});

screen('Export object', () => {
	appBehind();
	const { x, y } = popup(420, 420, 'Export Object');
	[ [ 'Export format', 'Markdown' ], [ 'Zip archive', 'toggle' ], [ 'Include linked objects', 'toggle' ], [ 'Include files', 'toggle' ], [ 'Include archived', 'toggleOff' ] ].forEach(([ k, v ], i) => row(x + 24, y + 70 + (i * 44), 372, k, v, { last: i == 4 }));
	button(x + 24, y + 350, 372, 'Export', { primary: true, h: 40 });
});

screen('Share / Publish', () => {
	appBehind();
	const x = W - 420;
	const y = 60;
	box(x, y, 380, 400, { fill: '', color: 'default' });
	[ 'Members', 'Publish' ].forEach((t, i) => box(x + 16 + (i * 120), y + 16, 110, 30, { text: t, fontSize: 13, fill: i ? 'grey' : '' }));
	label(x + 16, y + 70, 'Publish to web', { size: 16 });
	box(x + 16, y + 102, 348, 36, { fill: 'grey', color: 'grey', text: 'loom.site/anna/meeting-notes', align: 'left', fontSize: 13 });
	row(x + 16, y + 150, 348, 'Join space button', 'toggle');
	row(x + 16, y + 194, 348, 'Include linked objects', 'toggleOff', { last: true });
	button(x + 16, y + 340, 348, 'Publish', { primary: true, h: 40 });
});

screen('Object Manager / Relations', () => {
	appBehind();
	const { x, y } = popup(560, 520, 'Add property');
	input(x + 24, y + 70, 512, '⌕  Search or create property');
	[ 'Status', 'Priority', 'Due date', 'Assignee', 'Tag', 'URL', 'Estimate', 'Done' ].forEach((t, i) => {
		const cy = y + 120 + (i * 44);
		icon(x + 24, cy + 10, 20);
		label(x + 56, cy + 10, t, { size: 14 });
		line(x + 24, cy + 42, x + 536, cy + 42);
	});
});

screen('Shortcuts', () => {
	appBehind();
	const { x, y } = popup(720, 560, 'Keyboard shortcuts');
	[ 'Basics', 'Editor', 'Navigation', 'Markdown', 'Canvas' ].forEach((t, i) => box(x + 24 + (i * 110), y + 70, 100, 30, { text: t, fontSize: 13, fill: i ? '' : 'grey' }));
	for (let i = 0; i < 9; i++) {
		const cy = y + 120 + (i * 44);
		lines(x + 24, cy + 10, 300, 1);
		box(x + 560, cy + 4, 136, 26, { fill: 'grey', color: 'grey', text: 'Ctrl  Shift  K', fontSize: 12 });
	};
});

screen('Help / What’s new', () => {
	appBehind();
	const { x, y } = popup(720, 600, 'What’s new in Loom 0.55');
	box(x + 24, y + 70, 672, 220, { fill: 'ice', color: 'grey', text: 'Release illustration' });
	label(x + 24, y + 310, 'Canvas: paste canvas JSON', { size: 18, w: 600 });
	lines(x + 24, y + 350, 672, 6);
});

screen('About', () => {
	appBehind();
	const { x, y } = popup(360, 300, '');
	icon(x + 140, y + 40, 80, { fill: 'blue', color: 'blue', text: 'L', fontSize: 30 });
	label(x, y + 140, 'Loom', { size: 22, w: 360, align: 'center' });
	label(x, y + 176, 'Version 0.55.0', { size: 13, w: 360, align: 'center', color: 'grey' });
	button(x + 100, y + 220, 160, 'Copy debug info', { h: 32 });
});

screen('Logout', () => {
	appBehind();
	const { x, y } = popup(420, 260, 'Make sure you saved your login key');
	label(x + 24, y + 96, 'Without it you will not be able to log in again', { size: 14, color: 'grey', w: 372 });
	button(x + 24, y + 190, 180, 'Show key');
	button(x + 216, y + 190, 180, 'Log out', { primary: true });
});

screen('Phrase / Pin', () => {
	appBehind();
	const { x, y } = popup(520, 340, 'This is your Key');
	box(x + 24, y + 70, 472, 140, { fill: 'grey', color: 'grey', text: 'witch collapse practice feed shame open despair creek road again ice least', fontSize: 14 });
	button(x + 24, y + 260, 472, 'Copy', { primary: true, h: 40 });
});

screen('Preview (link hover)', () => {
	appBehind();
	const x = 520;
	const y = 260;
	box(x, y, 320, 220, { fill: '', color: 'default' });
	box(x, y, 320, 90, { fill: 'ice', color: 'grey', rounded: false });
	label(x + 16, y + 104, 'Project roadmap', { size: 16 });
	lines(x + 16, y + 140, 280, 3, { h: 6, step: 16 });
	label(x + 16, y + 194, 'Page', { size: 12, color: 'grey' });
});

screen('Upload / Image picker', () => {
	appBehind();
	const { x, y } = popup(520, 420, 'Change cover');
	[ 'Gallery', 'Upload', 'Unsplash' ].forEach((t, i) => box(x + 24 + (i * 110), y + 64, 100, 30, { text: t, fontSize: 13, fill: i ? '' : 'grey' }));
	for (let i = 0; i < 8; i++) {
		box(x + 24 + ((i % 4) * 120), y + 116 + (Math.floor(i / 4) * 90), 108, 76, { fill: [ 'ice', 'orange', 'lime', 'pink', 'teal', 'purple', 'yellow', 'red' ][i], color: 'grey' });
	};
	box(x + 24, y + 310, 472, 80, { dashed: true, text: 'Drop an image here or click to upload', fontSize: 13 });
});

// ---- Menus ---- //

section('Menus');

screen('Menus · Block', () => {
	sidebarLeft();
	header(CX, [ 'My Space', 'Meeting notes' ]);
	objectHead(CX + 140, HEADER + 40, 'Meeting notes');
	lines(CX + 140, HEADER + 190, 600, 2);
	label(CX + 140, HEADER + 250, '/', { size: 15 });
	menu(CX + 140, HEADER + 280, 300, [ '#Text', 'Text', 'Title|# ', 'Heading|##', 'Checkbox|[]', 'Bulleted list|-', '#Objects', 'Page', 'Task', 'Canvas', '#Other', 'Divider|---', 'Table', 'Code|```' ], { active: 'Text' });
	menu(CX + 520, HEADER + 260, 260, [ 'Turn into', 'Color', 'Background', 'Align', '-', 'Duplicate|Ctrl D', 'Move to', 'Copy link', '-', 'Delete|Del' ], { active: 'Turn into' });
	menu(CX + 784, HEADER + 268, 200, [ 'Text', 'Title', 'Heading', 'Subheading', 'Quote', 'Callout', 'Toggle' ], { icons: false });
});

screen('Menus · Object & dataview', () => {
	sidebarLeft();
	header(CX, [ 'My Space', 'Tasks' ]);
	menu(W - 280, HEADER - 4, 260, [ 'Favorite', 'Lock page', 'History', 'Undo|Ctrl Z', 'Redo|Ctrl Shift Z', '-', 'Link to', 'Template', 'Export', 'Print|Ctrl P', '-', 'Copy link', 'Duplicate', 'Delete' ], { active: 'Favorite' });
	menu(CX + 48, HEADER + 100, 280, [ '#Filter', 'Status is In progress', 'Priority is High', '+ Add filter' ], { icons: false });
	menu(CX + 48, HEADER + 280, 280, [ '#View', 'Grid', 'Board', 'Gallery', 'List', 'Calendar', 'Graph', '-', 'Duplicate view', 'Delete view' ], { active: 'Board' });
	menu(CX + 360, HEADER + 100, 240, [ '#Status', 'To do', 'In progress', 'In review', 'Done', '-', '+ Create option' ], { active: 'In progress' });
});

screen('Sidebar · Widget editing', () => {
	sidebarLeft();
	header(CX, [ 'My Space', 'Meeting notes' ]);
	menu(SIDEBAR + 4, 210, 240, [ '#Widget', 'Change source', 'Change type', '-', 'Link', 'Tree', 'List', 'Compact list', 'View', '-', 'Show 6 items ⌄', 'Remove widget' ], { active: 'Tree' });
	box(8, H - 110, SIDEBAR - 16, 40, { dashed: true, text: '+ Add widget', fontSize: 13 });
});

// --------------------------------------------------------- //
// Layout: one file per section (a canvas stays under the soft element limit), each screen is a frame

const write = (file, list) => {
	fs.writeFileSync(path.join(OUT, file), JSON.stringify({ type: 'loom/canvas', version: 1, elements: list }));
	console.log(`${file}: ${list.length} elements`);
};

fs.mkdirSync(OUT, { recursive: true });

let total = 0;

sections.forEach((s, n) => {
	elements.length = 0;
	ox = 0;
	oy = 0;
	label(0, 0, `Loom UI · ${s.name}`, { size: 64, w: 1600 });

	s.screens.forEach((sc, i) => {
		const fx = (i % PER_ROW) * (W + GAP_X);
		const fy = 160 + (Math.floor(i / PER_ROW) * (H + GAP_Y));

		base('frame', fx, fy, sc.w, sc.h, { text: sc.name });
		ox = fx;
		oy = fy;
		sc.draw();
		ox = 0;
		oy = 0;
	});

	total += elements.length;
	write(`${n + 1}-${s.name.toLowerCase()}.json`, elements.slice());
});

console.log(`${sections.reduce((acc, s) => acc + s.screens.length, 0)} screens, ${total} elements -> ${path.relative(process.cwd(), OUT)}`);
