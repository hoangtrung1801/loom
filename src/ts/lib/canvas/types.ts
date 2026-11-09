export enum ElementType {
	Rect		 = 'rect',
	Diamond		 = 'diamond',
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
	Diamond		 = 'diamond',
	Ellipse		 = 'ellipse',
	Line		 = 'line',
	Arrow		 = 'arrow',
	Pen			 = 'pen',
	Eraser		 = 'eraser',
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
export type FillStyle = 'hachure' | 'cross' | 'solid';
export type StrokeStyle = 'solid' | 'dashed' | 'dotted';
export type FontFamily = 'hand' | 'normal' | 'code';
export type TextAlign = 'left' | 'center' | 'right';
export type VerticalAlign = 'top' | 'middle' | 'bottom';
export type ArrowType = 'sharp' | 'curve' | 'elbow';
export type ArrowHead = 'none' | 'arrow' | 'bar' | 'dot' | 'triangle';

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
	/** Style fields below are optional so that elements saved before they existed still render the same (crisp, solid). */
	fillStyle?: FillStyle;
	strokeStyle?: StrokeStyle;
	/** 0 architect, 1 artist, 2 cartoonist. Missing means 0 (no hand-drawn wobble). */
	roughness?: number;
	/** Stable random seed so the hand-drawn wobble does not change between renders and clients. */
	seed?: number;
	rounded?: boolean;
	/** 10-100, missing means 100. */
	opacity?: number;
	fontFamily?: FontFamily;
	textAlign?: TextAlign;
	verticalAlign?: VerticalAlign;
	arrowType?: ArrowType;
	startHead?: ArrowHead;
	endHead?: ArrowHead;
	text?: string;
	points?: number[][];
	startId?: string;
	endId?: string;
	/** Where on the bound element each end is attached, as a 0-1 fraction of its width and height. Missing means the nearest border point toward the other end. */
	startFocus?: number[];
	endFocus?: number[];
	targetObjectId?: string;
};

/** Style applied to new elements; follows the last style the user picked, like in other whiteboards. */
export type ElementStyle = Pick<CanvasElement, 'color' | 'fill' | 'fillStyle' | 'strokeWidth' | 'strokeStyle' | 'roughness' | 'rounded' | 'opacity' | 'fontFamily' | 'fontSize' | 'textAlign' | 'verticalAlign' | 'arrowType' | 'startHead' | 'endHead'>;

export const DEFAULT_STYLE: ElementStyle = {
	color: 'default',
	fill: '',
	fillStyle: 'hachure',
	strokeWidth: 2,
	strokeStyle: 'solid',
	roughness: 1,
	rounded: false,
	opacity: 100,
	fontFamily: 'hand',
	fontSize: 20,
	textAlign: 'left',
	verticalAlign: 'middle',
	arrowType: 'sharp',
	startHead: 'none',
	endHead: 'arrow',
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
