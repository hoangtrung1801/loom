import React from 'react';

const p = { width: 20, height: 20, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export const CanvasIcon: { [key: string]: () => JSX.Element } = {
	select: () => <svg {...p}><path d="M5 3l10 6.5-4.2 1.2L9 15z" /></svg>,
	hand: () => <svg {...p}><path d="M7 10V5.5a1 1 0 012 0V9m0-4.5a1 1 0 012 0V9m0-3a1 1 0 012 0v4m0-2a1 1 0 012 0v4.5a4.5 4.5 0 01-4.5 4.5H10a4 4 0 01-3.3-1.7L4 11.5a1 1 0 011.6-1.2L7 12" /></svg>,
	rect: () => <svg {...p}><rect x="3.5" y="5" width="13" height="10" rx="1" /></svg>,
	ellipse: () => <svg {...p}><ellipse cx="10" cy="10" rx="7" ry="5.5" /></svg>,
	line: () => <svg {...p}><path d="M4 16L16 4" /></svg>,
	arrow: () => <svg {...p}><path d="M4 16L16 4M9 4h7v7" /></svg>,
	pen: () => <svg {...p}><path d="M3 17l1-4L14 3l3 3L7 16z" /></svg>,
	text: () => <svg {...p}><path d="M4 5V3.5h12V5M10 3.5v13M7.5 16.5h5" /></svg>,
	sticky: () => <svg {...p}><path d="M4 4h12v8l-4 4H4z M12 16v-4h4" /></svg>,
	frame: () => <svg {...p}><path d="M6 3v14M14 3v14M3 6h14M3 14h14" /></svg>,
	object: () => <svg {...p}><rect x="3.5" y="4" width="13" height="12" rx="2" /><path d="M6.5 8h7M6.5 11.5h4" /></svg>,
	undo: () => <svg {...p}><path d="M7 5L3.5 8.5 7 12M4 8.5h8a4 4 0 010 8H9" /></svg>,
	redo: () => <svg {...p}><path d="M13 5l3.5 3.5L13 12M16 8.5H8a4 4 0 000 8h3" /></svg>,
	fit: () => <svg {...p}><path d="M3.5 7V3.5H7M13 3.5h3.5V7M16.5 13v3.5H13M7 16.5H3.5V13" /></svg>,
	plus: () => <svg {...p}><path d="M10 4v12M4 10h12" /></svg>,
	minus: () => <svg {...p}><path d="M4 10h12" /></svg>,
	front: () => <svg {...p}><rect x="3.5" y="3.5" width="8" height="8" rx="1" /><rect x="8.5" y="8.5" width="8" height="8" rx="1" fill="currentColor" /></svg>,
	back: () => <svg {...p}><rect x="3.5" y="3.5" width="8" height="8" rx="1" fill="currentColor" /><rect x="8.5" y="8.5" width="8" height="8" rx="1" /></svg>,
	trash: () => <svg {...p}><path d="M4 6h12M8 6V4h4v2M6 6l.7 10h6.6L14 6" /></svg>,
};
