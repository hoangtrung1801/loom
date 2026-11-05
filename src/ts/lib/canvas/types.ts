export enum ElementType {
	Rect		 = 'rect',
	Ellipse		 = 'ellipse',
	Line		 = 'line',
	Arrow		 = 'arrow',
	Freehand	 = 'freehand',
	Text		 = 'text',
	Sticky		 = 'sticky',
	Frame		 = 'frame',
	Object		 = 'object',
};

export enum Tool {
	Select		 = 'select',
	Hand		 = 'hand',
	Rect		 = 'rect',
	Ellipse		 = 'ellipse',
	Line		 = 'line',
	Arrow		 = 'arrow',
	Pen			 = 'pen',
	Text		 = 'text',
	Sticky		 = 'sticky',
	Frame		 = 'frame',
};

export interface Point {
	x: number;
	y: number;
};

export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
};

export interface Viewport {
	x: number;
	y: number;
	zoom: number;
};

/**
 * A single canvas element. Persisted as JSON in the text of one embed block
 * (processor CanvasElement) so that every element syncs and merges on its own.
 */
export interface CanvasElement {
	id: string;
	type: ElementType;
	x: number;
	y: number;
	w: number;
	h: number;
	angle: number;
	z: string;
	v: number;
	nonce: number;
	deleted?: boolean;
	color?: string;
	fill?: string;
	strokeWidth?: number;
	fontSize?: number;
	text?: string;
	points?: number[][];
	startId?: string;
	endId?: string;
	targetObjectId?: string;
};

export interface SceneChange {
	ids: string[];
	reason: 'local' | 'remote' | 'load';
};

export interface Guide {
	axis: 'x' | 'y';
	value: number;
	from: number;
	to: number;
};

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 8;
export const MIN_SIZE = 8;
export const SOFT_ELEMENT_LIMIT = 2500;
