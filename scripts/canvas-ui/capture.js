/**
 * Draws the current page as canvas elements. Runs in the browser (page.evaluate) and returns
 * elements in page coordinates, in paint order: boxes (backgrounds, borders, separators), images,
 * SVG icons (sampled into freehand shapes) and text, with the real colors, sizes and font weights.
 *
 * Used by scripts/canvas-ui/run.js. Kept free of imports so it can be passed to page.evaluate as is.
 */
async function captureCanvasElements (options) {
	const opt = Object.assign({ skip: [], maxIconSamples: 90 }, options || {});
	const out = [];
	const vw = window.innerWidth;
	const vh = window.innerHeight;
	const svgCache = new Map();
	const imageCache = new Map();
	let counter = 0;
	let seq = 0;
	let emit = 0;
	// Paint order key of what is being emitted, see `walk`
	let paintKey = [];

	const id = () => `c${(++counter).toString(36)}`;
	const round = (n) => Math.round(n * 10) / 10;

	// --------------------------------------------------------- //
	// Colors

	const parseColor = (value) => {
		const m = String(value || '').match(/rgba?\(([^)]+)\)/);
		if (!m) {
			return null;
		};
		const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
		return { r: p[0], g: p[1], b: p[2], a: (p.length > 3) ? p[3] : 1 };
	};

	const blend = (top, bottom) => {
		const a = top.a;
		return {
			r: (top.r * a) + (bottom.r * (1 - a)),
			g: (top.g * a) + (bottom.g * (1 - a)),
			b: (top.b * a) + (bottom.b * (1 - a)),
			a: 1,
		};
	};

	const hex = (c) => '#' + [ c.r, c.g, c.b ].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

	/** Opaque colors are flattened over their background, see-through ones (dimmers, hovers, shadows) keep their alpha. */
	const solid = (c, opacity, bg) => {
		const a = c.a * opacity;
		if (a >= 0.97) {
			return hex(blend({ ...c, a: 1 }, bg));
		};
		return hex(c) + Math.round(a * 255).toString(16).padStart(2, '0');
	};

	// --------------------------------------------------------- //
	// Geometry

	const intersect = (a, b) => {
		const x = Math.max(a.x, b.x);
		const y = Math.max(a.y, b.y);
		const r = Math.min(a.x + a.w, b.x + b.w);
		const btm = Math.min(a.y + a.h, b.y + b.h);
		return ((r - x) > 0.5) && ((btm - y) > 0.5) ? { x, y, w: r - x, h: btm - y } : null;
	};

	const toRect = (r) => ({ x: r.left, y: r.top, w: r.width, h: r.height });

	/** First url() of a CSS value. Quoted data URLs can hold parentheses, so match up to the closing quote. */
	const cssUrl = (value) => {
		const m = String(value || '').match(/url\("((?:[^"\\]|\\.)*)"\)/) || String(value || '').match(/url\(([^)]+)\)/);
		return m ? m[1].replace(/\\"/g, '"') : '';
	};

	// --------------------------------------------------------- //
	// Emitters

	const push = (el) => {
		el.id = id();
		el._k = paintKey.concat([ ++emit ]);
		el.x = round(el.x);
		el.y = round(el.y);
		el.w = round(el.w);
		el.h = round(el.h);
		out.push(el);
		return el;
	};

	const box = (r, p) => {
		const radius = Math.min(p.radius || 0, r.w / 2, r.h / 2);
		const circle = (radius >= (Math.min(r.w, r.h) / 2) - 0.5) && (Math.abs(r.w - r.h) < 1.5) && (r.w > 4);

		if (circle) {
			return push({ type: 'ellipse', x: r.x, y: r.y, w: r.w, h: r.h, fill: p.fill || '', fillStyle: 'solid', color: p.stroke || p.fill, strokeWidth: p.stroke ? p.strokeWidth : 0.5 });
		};
		if (p.stroke) {
			return push({ type: 'rect', x: r.x, y: r.y, w: r.w, h: r.h, fill: p.fill || '', fillStyle: 'solid', color: p.stroke, strokeWidth: p.strokeWidth, radius: radius || undefined });
		};
		// A sticky has a fill and no border, which is what most UI surfaces are
		return push({ type: 'sticky', x: r.x, y: r.y, w: r.w, h: r.h, fill: p.fill, radius: radius || undefined });
	};

	const segment = (x1, y1, x2, y2, color, width) => {
		const x = Math.min(x1, x2);
		const y = Math.min(y1, y2);
		return push({ type: 'line', x, y, w: Math.max(Math.abs(x2 - x1), 0.5), h: Math.max(Math.abs(y2 - y1), 0.5), points: [ [ x1 - x, y1 - y ], [ x2 - x, y2 - y ] ], color, strokeWidth: width, startHead: 'none', endHead: 'none' });
	};

	const measure = document.createElement('canvas').getContext('2d');
	const appFont = getComputedStyle(document.body).fontFamily || 'sans-serif';

	const text = (value, r, cs, color) => {
		const size = parseFloat(cs.fontSize) || 14;
		const lh = Math.round(size * 1.3);
		const weight = parseInt(cs.fontWeight, 10) || 400;
		const family = /mono|menlo|consolas|courier/i.test(cs.fontFamily) ? 'code' : 'normal';
		let content = value;

		if (cs.textTransform == 'uppercase') {
			content = content.toUpperCase();
		} else
		if (cs.textTransform == 'capitalize') {
			content = content.replace(/\b\w/g, c => c.toUpperCase());
		};

		// The canvas draws text with the app font, which can be wider than the font on screen (serif titles):
		// size the box to whichever is wider so a line never wraps on the canvas
		measure.font = `${weight} ${size}px ${appFont}`;
		const width = Math.max(r.w, measure.measureText(content).width) + 4;

		return push({
			type: 'text', text: content, x: r.x, y: r.y + ((r.h - lh) / 2), w: width, h: lh,
			fontSize: round(size), fontWeight: (weight != 400) ? weight : undefined, fontFamily: family, color, textAlign: 'left', verticalAlign: 'top',
		});
	};

	// --------------------------------------------------------- //
	// Images: drawn as a small mosaic of their colors

	const loadImage = (src) => {
		if (!imageCache.has(src)) {
			imageCache.set(src, new Promise(resolve => {
				const img = new Image();
				img.crossOrigin = 'anonymous';
				img.onload = () => resolve(img);
				img.onerror = () => resolve(null);
				img.src = src;
				setTimeout(() => resolve(null), 3000);
			}));
		};
		return imageCache.get(src);
	};

	/**
	 * Picture as an image element holding a small WebP data URL (twice the display size at most, 480px on the long side),
	 * cropped or letterboxed like object-fit / background-size. Falls back to the color mosaic when the image can't be read.
	 */
	const pictureCache = new Map();
	const picture = async (src, r, radius, fit) => {
		const img = await loadImage(src);
		if (!img || !img.naturalWidth) {
			return mosaic(src, r, radius);
		};

		const k = Math.min(2, 480 / Math.max(r.w, r.h));
		const tw = Math.max(1, Math.round(r.w * k));
		const th = Math.max(1, Math.round(r.h * k));
		const key = [ src, tw, th, fit ].join('|');

		if (!pictureCache.has(key)) {
			let data = '';
			try {
				const c = document.createElement('canvas');
				c.width = tw;
				c.height = th;
				const ctx = c.getContext('2d');
				const iw = img.naturalWidth;
				const ih = img.naturalHeight;

				if (fit == 'cover') {
					const s = Math.max(tw / iw, th / ih);
					const sw = tw / s;
					const sh = th / s;
					ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, 0, 0, tw, th);
				} else
				if (fit == 'contain') {
					const s = Math.min(tw / iw, th / ih);
					ctx.drawImage(img, (tw - (iw * s)) / 2, (th - (ih * s)) / 2, iw * s, ih * s);
				} else {
					ctx.drawImage(img, 0, 0, tw, th);
				};
				data = c.toDataURL('image/webp', 0.82);
			} catch (e) {
				data = '';
			};
			pictureCache.set(key, data);
		};

		const data = pictureCache.get(key);
		if (!data) {
			return mosaic(src, r, radius);
		};
		push({ type: 'image', x: r.x, y: r.y, w: r.w, h: r.h, src: data, radius: radius || undefined });
	};

	const mosaic = async (src, r, radius) => {
		const img = await loadImage(src);
		// Cells of at least 4px, at most about 256 cells per picture
		const cell = Math.max(4, Math.sqrt((r.w * r.h) / 256));
		const cols = Math.max(1, Math.round(r.w / cell));
		const rows = Math.max(1, Math.round(r.h / cell));

		if (!img) {
			return;
		};

		try {
			const c = document.createElement('canvas');
			c.width = cols;
			c.height = rows;
			const ctx = c.getContext('2d');
			ctx.drawImage(img, 0, 0, cols, rows);
			const data = ctx.getImageData(0, 0, cols, rows).data;
			const cw = r.w / cols;
			const ch = r.h / rows;

			for (let j = 0; j < rows; j++) {
				for (let i = 0; i < cols; i++) {
					const k = ((j * cols) + i) * 4;
					const alpha = data[k + 3] / 255;
					if (alpha < 0.08) {
						continue;
					};
					const color = solid({ r: data[k], g: data[k + 1], b: data[k + 2], a: alpha }, 1, { r: 255, g: 255, b: 255, a: 1 });
					box({ x: r.x + (i * cw), y: r.y + (j * ch), w: cw + 0.5, h: ch + 0.5 }, { fill: color, radius: ((cols == 1) && (rows == 1)) ? radius : 0 });
				};
			};
		} catch (e) {
			box(r, { fill: '#e3e3e3', radius });
		};
	};

	// --------------------------------------------------------- //
	// SVG: every shape is sampled into points, filled shapes keep their holes by painting them with the background

	const host = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	host.setAttribute('style', 'position:fixed;left:-9999px;top:-9999px;width:100px;height:100px;opacity:0;pointer-events:none');
	document.body.appendChild(host);

	const loadSvg = (url) => {
		if (!svgCache.has(url)) {
			svgCache.set(url, fetch(url).then(r => r.ok ? r.text() : '').catch(() => ''));
		};
		return svgCache.get(url);
	};

	const polygonArea = (pts) => {
		let a = 0;
		for (let i = 0; i < pts.length; i++) {
			const p = pts[i];
			const q = pts[(i + 1) % pts.length];
			a += (p[0] * q[1]) - (q[0] * p[1]);
		};
		return Math.abs(a / 2);
	};

	const inside = (pt, poly) => {
		let c = false;
		for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
			const a = poly[i];
			const b = poly[j];
			if (((a[1] > pt[1]) != (b[1] > pt[1])) && (pt[0] < (((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1])) + a[0])) {
				c = !c;
			};
		};
		return c;
	};

	/** Samples a geometry element into subpaths (a jump between samples starts a new one), in screen space via `map`. */
	const sample = (shape, map, unit) => {
		let len = 0;
		try {
			len = shape.getTotalLength();
		} catch (e) {
			return [];
		};
		if (!len) {
			return [];
		};

		const step = Math.max(len / opt.maxIconSamples, unit * 0.6);
		const list = [];
		let cur = [];
		let prev = null;

		for (let d = 0; d <= len + 0.001; d += step) {
			const p = shape.getPointAtLength(Math.min(d, len));
			if (prev && (Math.hypot(p.x - prev.x, p.y - prev.y) > step * 2.5)) {
				list.push(cur);
				cur = [];
			};
			cur.push(map(p.x, p.y));
			prev = p;
		};
		list.push(cur);
		return list.filter(s => s.length > 1);
	};

	const drawShapes = (root, map, scale, bg, opacity, tint) => {
		const shapes = root.querySelectorAll('path, circle, ellipse, rect, line, polyline, polygon');
		const labels = root.querySelectorAll('text');

		shapes.forEach(shape => {
			if (shape.closest('defs, clipPath, mask')) {
				return;
			};

			const cs = getComputedStyle(shape);
			if ((cs.display == 'none') || (cs.visibility == 'hidden')) {
				return;
			};

			const op = opacity * parseFloat(cs.opacity || '1') * parseFloat(cs.fillOpacity || '1');
			// A tint (CSS mask painted with the background color) replaces the colors and keeps their alpha
			const paint = (c) => (c && tint) ? { ...tint, a: tint.a * c.a } : c;
			const fill = paint((cs.fill && (cs.fill != 'none')) ? parseColor(cs.fill) : null);
			const stroke = paint((cs.stroke && (cs.stroke != 'none')) ? parseColor(cs.stroke) : null);
			const subs = sample(shape, map, scale);

			if (!subs.length) {
				return;
			};

			if (fill && fill.a) {
				const color = solid(fill, op, bg);
				const hole = hex(bg);
				const sorted = subs.map(pts => ({ pts, area: polygonArea(pts) })).sort((a, b) => b.area - a.area);

				sorted.forEach((s, i) => {
					// Depth: how many bigger subpaths contain this one. Odd depth is a hole (evenodd and the usual nonzero icons)
					const depth = sorted.slice(0, i).filter(o => inside(s.pts[0], o.pts)).length;
					const c = (depth % 2) ? hole : color;
					freehand(s.pts, c, c, 0.4);
				});
			};

			if (stroke && stroke.a) {
				const width = (parseFloat(cs.strokeWidth) || 1) * scale;
				subs.forEach(pts => freehand(pts, solid(stroke, op, bg), '', width));
			};
		});

		// Text inside SVG (letter avatars and the like), centered on its box
		labels.forEach(label => {
			const value = (label.textContent || '').trim();
			if (!value) {
				return;
			};

			let bb = null;
			try {
				bb = label.getBBox();
			} catch (e) {
				return;
			};

			const cs = getComputedStyle(label);
			const fill = parseColor(cs.fill) || { r: 0, g: 0, b: 0, a: 1 };
			const p1 = map(bb.x, bb.y);
			const p2 = map(bb.x + bb.width, bb.y + bb.height);
			const size = (parseFloat(cs.fontSize) || 16) * scale;
			const lh = Math.round(size * 1.3);
			const cx = (p1[0] + p2[0]) / 2;
			const cy = (p1[1] + p2[1]) / 2;
			const w = Math.max(p2[0] - p1[0], size) + 8;

			push({
				type: 'text', text: value, x: cx - (w / 2), y: cy - (lh / 2), w, h: lh, fontSize: round(size), fontWeight: (parseInt(cs.fontWeight, 10) != 400) ? parseInt(cs.fontWeight, 10) : undefined,
				fontFamily: 'normal', color: solid(fill, opacity, bg), textAlign: 'center', verticalAlign: 'top',
			});
		});
	};

	const freehand = (pts, color, fill, width) => {
		const xs = pts.map(p => p[0]);
		const ys = pts.map(p => p[1]);
		const x = Math.min(...xs);
		const y = Math.min(...ys);
		push({
			type: 'freehand', x, y, w: Math.max(Math.max(...xs) - x, 0.5), h: Math.max(Math.max(...ys) - y, 0.5),
			points: pts.map(p => [ round(p[0] - x), round(p[1] - y) ]), color, fill: fill || '', strokeWidth: round(width),
		});
	};

	const iconFromUrl = async (url, area, cs, bg, opacity, tint) => {
		const source = await loadSvg(url);
		if (!source || !source.includes('<svg')) {
			return false;
		};

		const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
		const svg = doc.documentElement;
		if (!svg || (svg.nodeName != 'svg')) {
			return false;
		};

		let vb = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
		if (vb.length != 4) {
			vb = [ 0, 0, parseFloat(svg.getAttribute('width')) || 20, parseFloat(svg.getAttribute('height')) || 20 ];
		};

		// Where the image is painted inside the element: background-size and background-position
		const size = String(cs.backgroundSize || 'auto').split(' ');
		let w = 0;
		let h = 0;

		if ((size[0] == 'contain') || (size[0] == 'cover')) {
			const k = (size[0] == 'contain') ? Math.min(area.w / vb[2], area.h / vb[3]) : Math.max(area.w / vb[2], area.h / vb[3]);
			w = vb[2] * k;
			h = vb[3] * k;
		} else {
			const parse = (v, total) => v.endsWith('%') ? (parseFloat(v) / 100) * total : parseFloat(v);
			w = (size[0] && (size[0] != 'auto')) ? parse(size[0], area.w) : (parseFloat(svg.getAttribute('width')) || vb[2]);
			h = (size[1] && (size[1] != 'auto')) ? parse(size[1], area.h) : ((size[0] && (size[0] != 'auto')) ? (w * vb[3] / vb[2]) : (parseFloat(svg.getAttribute('height')) || vb[3]));
		};

		const pos = String(cs.backgroundPosition || '0% 0%').split(' ');
		const place = (v, free) => {
			if (!v) {
				return free / 2;
			};
			return v.endsWith('%') ? (parseFloat(v) / 100) * free : parseFloat(v);
		};
		const x0 = area.x + place(pos[0], area.w - w);
		const y0 = area.y + place(pos[1] || '50%', area.h - h);
		const k = Math.min(w / vb[2], h / vb[3]);

		host.innerHTML = '';
		host.setAttribute('viewBox', vb.join(' '));
		Array.from(svg.childNodes).forEach(n => host.appendChild(document.importNode(n, true)));

		drawShapes(host, (px, py) => [ x0 + ((px - vb[0]) * k), y0 + ((py - vb[1]) * k) ], k, bg, opacity, tint);
		host.innerHTML = '';
		return true;
	};

	const inlineSvg = (svg, bg, opacity) => {
		drawShapes(svg, (px, py) => {
			const shapeMatrix = svg.getScreenCTM();
			const p = new DOMPoint(px, py).matrixTransform(shapeMatrix);
			return [ p.x, p.y ];
		}, (svg.getScreenCTM() || { a: 1 }).a || 1, bg, opacity);
	};

	// --------------------------------------------------------- //
	// Text nodes: one element per rendered line, cut with an ellipsis where the box clips it

	const textLines = (node) => {
		const range = document.createRange();
		range.selectNodeContents(node);
		const rects = Array.from(range.getClientRects()).filter(r => (r.width > 0.5) && (r.height > 0.5));

		if (rects.length <= 1) {
			return rects.length ? [ { text: node.textContent, rect: toRect(rects[0]) } ] : [];
		};

		// Several lines: walk the characters and split where the line box changes
		const lines = [];
		const value = node.textContent;
		let start = 0;
		let top = null;
		let left = 0;
		let right = 0;
		let bottom = 0;
		let lineTop = 0;

		for (let i = 0; i < value.length; i++) {
			range.setStart(node, i);
			range.setEnd(node, i + 1);
			const r = range.getBoundingClientRect();
			if (!r.width && !r.height) {
				continue;
			};
			if ((top !== null) && (Math.abs(r.top - top) > (r.height / 2))) {
				lines.push({ text: value.slice(start, i), rect: { x: left, y: lineTop, w: right - left, h: bottom - lineTop } });
				start = i;
				top = null;
			};
			if (top === null) {
				top = r.top;
				lineTop = r.top;
				left = r.left;
				bottom = r.bottom;
			};
			right = Math.max(right, r.right);
			bottom = Math.max(bottom, r.bottom);
		};
		lines.push({ text: value.slice(start), rect: { x: left, y: lineTop, w: right - left, h: bottom - lineTop } });
		return lines;
	};

	const clipText = (node, line, clip) => {
		if ((line.rect.x + line.rect.w) <= (clip.x + clip.w + 1)) {
			return line;
		};

		// Find the last character that still fits, like text-overflow: ellipsis
		const range = document.createRange();
		const value = line.text;
		const offset = node.textContent.indexOf(value);
		let fit = 0;

		for (let i = 0; i < value.length; i++) {
			range.setStart(node, offset + i);
			range.setEnd(node, offset + i + 1);
			if (range.getBoundingClientRect().right > (clip.x + clip.w - 8)) {
				break;
			};
			fit = i + 1;
		};
		return { text: value.slice(0, fit).trimEnd() + '…', rect: { ...line.rect, w: clip.x + clip.w - line.rect.x } };
	};

	// --------------------------------------------------------- //
	// Walk

	const skip = (el) => opt.skip.some(s => el.matches(s));
	const white = { r: 255, g: 255, b: 255, a: 1 };

	const walk = async (el, clip, opacity, bg, key) => {
		const cs = getComputedStyle(el);

		if ((cs.display == 'none') || (cs.visibility == 'hidden') || skip(el)) {
			return;
		};

		const op = opacity * parseFloat(cs.opacity || '1');
		if (op < 0.04) {
			return;
		};

		// Stacking: positioned elements and other stacking contexts paint by z-index above the in-flow content
		// of their context, the way CSS does. Keys compare like tuples.
		const positioned = cs.position != 'static';
		const zIndex = parseInt(cs.zIndex, 10);
		const context = positioned || (cs.transform != 'none') || (parseFloat(cs.opacity) < 1) || (!isNaN(zIndex) && (cs.display != 'inline'));
		const ownKey = context ? key.concat([ isNaN(zIndex) ? 0 : zIndex, ++seq ]) : key;

		paintKey = context ? ownKey.concat([ -1e9 ]) : ownKey.concat([ -0.5 ]);

		const rect = toRect(el.getBoundingClientRect());
		const visible = intersect(rect, clip);
		const radius = parseFloat(cs.borderTopLeftRadius) || 0;
		const tag = el.tagName.toLowerCase();
		let childBg = bg;

		if (visible) {
			// Background
			const bgc = parseColor(cs.backgroundColor);
			const borders = [ 'Top', 'Right', 'Bottom', 'Left' ].map(side => ({
				width: parseFloat(cs[`border${side}Width`]) || 0,
				color: parseColor(cs[`border${side}Color`]),
				style: cs[`border${side}Style`],
			}));
			const shown = borders.map(b => (b.width > 0) && b.color && (b.color.a > 0.02) && (b.style != 'none') && (b.style != 'hidden'));
			const uniform = shown.every(Boolean) && borders.every(b => (b.width == borders[0].width) && (hex(b.color) == hex(borders[0].color)));
			// A CSS mask paints the background color through an SVG (logos, colored icons): trace the SVG in that color
			const mask = cs.maskImage || cs.webkitMaskImage || '';
			const maskUrl = (mask && (mask != 'none')) ? cssUrl(mask) : '';
			if (maskUrl && bgc && (bgc.a > 0.02) && visible) {
				const mcs = { backgroundSize: cs.maskSize || cs.webkitMaskSize || 'contain', backgroundPosition: cs.maskPosition || cs.webkitMaskPosition || '50% 50%' };
				if (await iconFromUrl(maskUrl, rect, mcs, bg, op, bgc)) {
					bgc.a = 0;
				};
			};

			// Frosted glass (backdrop-filter) shows what is behind it, keep only a hint of its color
			if (bgc && (cs.backdropFilter && (cs.backdropFilter != 'none'))) {
				bgc.a = Math.min(bgc.a, 0.25);
			};

			const fill = (bgc && (bgc.a > 0.02)) ? solid(bgc, op, bg) : '';

			if (fill) {
				childBg = blend({ ...bgc, a: bgc.a * op }, bg);
			};

			const area = intersect(rect, clip) || rect;
			const clipped = (area.w < rect.w - 1) || (area.h < rect.h - 1);
			const drawRect = clipped ? area : rect;

			// Box shadow: drawn as soft layers under the box (a 0-blur spread shadow is an exact ring, used as a border)
			if ((cs.boxShadow != 'none') && !clipped && (fill || uniform)) {
				const re = /(rgba?\([^)]+\))\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px(?:\s+(-?[\d.]+)px)?(\s+inset)?/g;
				let m = null;
				while ((m = re.exec(cs.boxShadow))) {
					const color = parseColor(m[1]);
					const dx = parseFloat(m[2]);
					const dy = parseFloat(m[3]);
					const blur = parseFloat(m[4]);
					const spread = parseFloat(m[5] || '0');
					if (m[6] || !color || (color.a < 0.01)) {
						continue;
					};
					const layers = blur ? [ [ blur * 0.5, 0.35 ], [ blur * 0.2, 0.45 ] ] : [ [ 0, 1 ] ];
					layers.forEach(([ grow, k ]) => {
						const g = grow + spread;
						box({ x: rect.x + dx - g, y: rect.y + dy - g, w: rect.w + (g * 2), h: rect.h + (g * 2) }, { fill: solid({ ...color, a: color.a * k }, op, bg), radius: radius ? radius + g : 0 });
					});
				};
			};

			if (uniform && !clipped) {
				box(drawRect, { fill, stroke: solid(borders[0].color, op, childBg), strokeWidth: borders[0].width, radius });
			} else {
				if (fill) {
					box(drawRect, { fill, radius: clipped ? 0 : radius });
				};
				const r = rect;
				const sides = [
					[ r.x, r.y, r.x + r.w, r.y ],
					[ r.x + r.w, r.y, r.x + r.w, r.y + r.h ],
					[ r.x, r.y + r.h, r.x + r.w, r.y + r.h ],
					[ r.x, r.y, r.x, r.y + r.h ],
				];
				shown.forEach((on, i) => {
					if (!on) {
						return;
					};
					const s = sides[i];
					const c = intersect({ x: Math.min(s[0], s[2]) - 0.5, y: Math.min(s[1], s[3]) - 0.5, w: Math.abs(s[2] - s[0]) + 1, h: Math.abs(s[3] - s[1]) + 1 }, clip);
					if (c) {
						const half = borders[i].width / 2;
						const horizontal = (i % 2) == 0;
						const at = (i == 0) ? r.y + half : (i == 2) ? r.y + r.h - half : (i == 1) ? r.x + r.w - half : r.x + half;
						if (horizontal) {
							segment(c.x, at, c.x + c.w, at, solid(borders[i].color, op, bg), borders[i].width);
						} else {
							segment(at, c.y, at, c.y + c.h, solid(borders[i].color, op, bg), borders[i].width);
						};
					};
				});
			};

			// Background image: SVG icons are traced, pictures become a color mosaic
			const bgi = cs.backgroundImage;
			const url = (bgi && (bgi != 'none')) ? cssUrl(bgi) : '';
			if (url && !clipped) {
				const svg = /\.svg(\?|$)/i.test(url) || url.startsWith('data:image/svg');
				if (svg) {
					await iconFromUrl(url, rect, cs, childBg, op);
				} else {
					const size = String(cs.backgroundSize || '');
					await picture(url, rect, radius, size.startsWith('contain') ? 'contain' : (size.startsWith('cover') ? 'cover' : 'fill'));
				};
			} else
			if (bgi && bgi.includes('gradient(') && !clipped) {
				const stops = (bgi.match(/rgba?\([^)]+\)/g) || []).map(parseColor).filter(Boolean);
				if (stops.length) {
					box(rect, { fill: solid(stops[Math.floor(stops.length / 2)], op, bg), radius });
				};
			};

			if ((tag == 'img') && !clipped) {
				const src = el.currentSrc || el.src || '';
				const emoji = src.match(/\/emoji\/([0-9a-f-]+)\.png/i);

				// Emoji images become the emoji character, everything else a color mosaic
				if (/^data:image\/svg|\.svg(\?|$)/i.test(src)) {
					if (!(await iconFromUrl(src, rect, { backgroundSize: 'contain', backgroundPosition: '50% 50%' }, childBg, op))) {
						await mosaic(src, rect, radius);
					};
				} else
				if (emoji) {
					const char = emoji[1].split('-').map(h => String.fromCodePoint(parseInt(h, 16))).join('');
					const size = Math.round(Math.min(rect.w, rect.h) * 0.82);
					push({ type: 'text', text: char, x: rect.x + ((rect.w - size * 1.2) / 2), y: rect.y + ((rect.h - (size * 1.3)) / 2), w: size * 1.25, h: size * 1.3, fontSize: size, fontFamily: 'normal', color: '#252525', textAlign: 'center', verticalAlign: 'top' });
				} else {
					const fit = cs.objectFit;
					await picture(src, rect, radius, (fit == 'cover') ? 'cover' : ((fit == 'contain') || (fit == 'scale-down')) ? 'contain' : 'fill');
				};
				return;
			};

			if (tag == 'svg') {
				inlineSvg(el, childBg, op);
				return;
			};

			if ((tag == 'canvas') || (tag == 'video') || (tag == 'iframe')) {
				return;
			};

			if ((tag == 'input') || (tag == 'textarea')) {
				const value = el.value || el.placeholder || '';
				if (value && ![ 'checkbox', 'radio', 'range', 'file', 'hidden', 'color' ].includes(el.type)) {
					const pl = parseFloat(cs.paddingLeft) || 0;
					const pt = parseFloat(cs.paddingTop) || 0;
					const color = el.value ? parseColor(cs.color) : (parseColor(getComputedStyle(el, '::placeholder').color) || parseColor(cs.color));
					const fs = parseFloat(cs.fontSize) || 14;
					const r = (tag == 'textarea') ? { x: rect.x + pl, y: rect.y + pt, w: rect.w - (pl * 2), h: fs * 1.3 } : { x: rect.x + pl, y: rect.y, w: rect.w - (pl * 2), h: rect.h };
					text(value.split('\n')[0], r, cs, solid(color, op, childBg));
				};
				return;
			};
		};

		// Children keep painting in DOM order, which matches the stacking of this app closely enough
		let nextClip = clip;
		if ((cs.overflowX != 'visible') || (cs.overflowY != 'visible')) {
			nextClip = visible || null;
			if (!nextClip) {
				return;
			};
		};

		for (const child of Array.from(el.childNodes)) {
			if (child.nodeType == Node.TEXT_NODE) {
				if (!child.textContent.trim() || !visible) {
					continue;
				};
				const color = parseColor(cs.color);
				if (!color || (color.a < 0.02)) {
					continue;
				};
				paintKey = ownKey.concat([ -0.5 ]);
				textLines(child).forEach(line => {
					const trimmed = line.text.replace(/\s+/g, ' ').trim();
					if (!trimmed || !intersect(line.rect, nextClip)) {
						return;
					};
					const cut = clipText(child, { ...line, text: trimmed }, nextClip);
					text(cut.text, cut.rect, cs, solid(color, op, childBg));
				});
			} else
			if (child.nodeType == Node.ELEMENT_NODE) {
				await walk(child, nextClip, op, childBg, ownKey);
			};
		};
	};

	const bodyBg = parseColor(getComputedStyle(document.body).backgroundColor);
	const base = (bodyBg && bodyBg.a) ? blend(bodyBg, white) : white;

	paintKey = [ -1e12 ];
	box({ x: 0, y: 0, w: vw, h: vh }, { fill: hex(base) });
	await walk(document.body, { x: 0, y: 0, w: vw, h: vh }, 1, base, []);
	host.remove();

	const compare = (a, b) => {
		for (let i = 0; i < Math.max(a.length, b.length); i++) {
			if (a[i] === undefined) {
				return -1;
			};
			if (b[i] === undefined) {
				return 1;
			};
			if (a[i] != b[i]) {
				return a[i] - b[i];
			};
		};
		return 0;
	};

	out.sort((a, b) => compare(a._k, b._k));
	out.forEach(el => delete el._k);
	return out;
};

if (typeof module != 'undefined') {
	module.exports = { captureCanvasElements };
};
