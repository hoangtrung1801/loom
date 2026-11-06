import { CanvasElement } from './types';
import { unionBounds } from './geometry';

/** A reusable group of elements the user saved from a canvas. Stored per user, not in any canvas. */
export interface LibraryItem {
	id: string;
	name: string;
	thumb: string;
	elements: CanvasElement[];
};

export const LIBRARY_KEY = 'canvasLibrary';
export const LIBRARY_LIMIT = 100;

/** Moves the elements so their top left corner is the origin and drops anything that points outside the group. */
export const toLibraryElements = (elements: CanvasElement[]): CanvasElement[] => {
	const list = elements.filter(el => el && !el.deleted && (el.type != 'object'));
	const ids = new Set(list.map(el => el.id));
	const b = unionBounds(list);

	if (!b) {
		return [];
	};

	return list.map(el => ({
		...el,
		x: el.x - b.x,
		y: el.y - b.y,
		startId: ids.has(el.startId) ? el.startId : '',
		endId: ids.has(el.endId) ? el.endId : '',
	}));
};

export const loadLibrary = (): LibraryItem[] => {
	try {
		const list = JSON.parse(window.localStorage.getItem(LIBRARY_KEY) || '[]');

		return Array.isArray(list) ? list.filter(it => it && it.id && Array.isArray(it.elements)) : [];
	} catch (e) {
		return [];
	};
};

export const saveLibrary = (list: LibraryItem[]): boolean => {
	try {
		window.localStorage.setItem(LIBRARY_KEY, JSON.stringify(list.slice(0, LIBRARY_LIMIT)));
		return true;
	} catch (e) {
		return false;
	};
};
