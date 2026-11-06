import React from 'react';
import { J, S, translate } from 'Lib';
import { CanvasController, CanvasElement, ElementType, Tool, DEFAULT_STYLE } from 'Lib/canvas';
import { CanvasIcon } from './icons';

interface Props {
	controller: CanvasController;
	tool: Tool;
	onChange: () => void;
};

const WIDTHS = [ 1, 2, 4 ];
const SIZES = [ { id: 'S', value: 16 }, { id: 'M', value: 20 }, { id: 'L', value: 28 }, { id: 'XL', value: 36 } ];
const COLORS = [ 'default' ].concat(J.Theme.icon.list);
const FILL_STYLES = [ 'hachure', 'cross', 'solid' ];
const STROKE_STYLES = [ 'solid', 'dashed', 'dotted' ];
const ROUGHNESS = [ 0, 1, 2 ];
const FAMILIES = [ 'hand', 'normal', 'code' ];
const ALIGNS = [ 'left', 'center', 'right' ];
const VERTICAL = [ 'top', 'middle', 'bottom' ];
const ARROW_TYPES = [ 'sharp', 'curve', 'elbow' ];
const HEADS = [ 'none', 'arrow', 'bar', 'dot', 'triangle' ];
const OPACITY_STEP = 10;

const SHAPES: ElementType[] = [ ElementType.Rect, ElementType.Diamond, ElementType.Ellipse ];
const LINEAR: ElementType[] = [ ElementType.Line, ElementType.Arrow ];

const TOOL_TYPE: { [key: string]: ElementType } = {
	[Tool.Rect]: ElementType.Rect,
	[Tool.Diamond]: ElementType.Diamond,
	[Tool.Ellipse]: ElementType.Ellipse,
	[Tool.Line]: ElementType.Line,
	[Tool.Arrow]: ElementType.Arrow,
	[Tool.Pen]: ElementType.Freehand,
	[Tool.Text]: ElementType.Text,
	[Tool.Sticky]: ElementType.Sticky,
};

interface Features {
	color: boolean;
	background: boolean;
	fillStyle: boolean;
	width: boolean;
	strokeStyle: boolean;
	roughness: boolean;
	edges: boolean;
	arrowType: boolean;
	heads: boolean;
	font: boolean;
	align: boolean;
	vertical: boolean;
	opacity: boolean;
};

const getFeatures = (types: ElementType[]): Features => {
	const has = (list: ElementType[]) => types.some(t => list.includes(t));
	const textual = [ ElementType.Text, ElementType.Sticky ].concat(SHAPES);

	return {
		color: has([ ElementType.Text, ElementType.Freehand ].concat(SHAPES, LINEAR)),
		background: has(SHAPES.concat([ ElementType.Sticky ])),
		fillStyle: has(SHAPES),
		width: has([ ElementType.Freehand ].concat(SHAPES, LINEAR)),
		strokeStyle: has(SHAPES.concat(LINEAR)),
		roughness: has(SHAPES.concat(LINEAR)),
		edges: has([ ElementType.Rect ]),
		arrowType: has(LINEAR),
		heads: has([ ElementType.Arrow ]),
		font: has(textual),
		align: has(textual),
		vertical: has([ ElementType.Sticky ].concat(SHAPES)),
		opacity: types.some(t => t != ElementType.Object),
	};
};

/**
 * Properties panel on the left. With a selection it edits the selected elements, with a drawing tool
 * active it edits the style that new elements will start with.
 */
const CanvasPanel = ({ controller, tool, onChange }: Props) => {

	if (controller.isDragging) {
		return null;
	};

	const selected = controller.scene.selected();
	const types = selected.length ? selected.map(el => el.type) : (TOOL_TYPE[tool] ? [ TOOL_TYPE[tool] ] : []);

	if (!types.length) {
		return null;
	};

	const f = getFeatures(types);
	const first: any = selected.length ? selected[0] : controller.defaults;
	const theme = J.Theme[S.Common.getThemeClass()] as any;
	const val = (key: string): any => (first[key] !== undefined) ? first[key] : (DEFAULT_STYLE as any)[key];

	const apply = (patch: Partial<CanvasElement>) => {
		controller.setStyle(patch);
		onChange();
	};

	const act = (callback: () => void) => {
		callback();
		onChange();
	};

	const section = (title: string, children: React.ReactNode) => (
		<div className="section">
			<div className="label">{translate(title)}</div>
			<div className="row">{children}</div>
		</div>
	);

	const swatch = (name: string, active: boolean, onClick: () => void, soft = false) => {
		const cn = [ 'canvasSwatch' ];

		if (active) {
			cn.push('active');
		};

		return <div key={name} className={cn.join(' ')} style={{ background: soft ? J.Theme.icon.text[name] : theme.color[name] }} onClick={onClick} />;
	};

	const option = (key: string, active: boolean, title: string, onClick: () => void, content: React.ReactNode, style: any = undefined) => {
		const cn = [ 'canvasOption' ];

		if (active) {
			cn.push('active');
		};

		return <div key={key} className={cn.join(' ')} title={translate(title)} style={style} onClick={onClick}>{content}</div>;
	};

	const line = (dash: string, width = 2) => (
		<svg width="16" height="16" viewBox="0 0 16 16"><path d="M1 8h14" stroke="currentColor" strokeWidth={width} strokeDasharray={dash} strokeLinecap="round" /></svg>
	);

	const head = (side: 'startHead' | 'endHead') => section(side == 'startHead' ? 'canvasPanelStartHead' : 'canvasPanelEndHead', HEADS.map(id => {
		const Icon = CanvasIcon[`head_${id}`];

		return option(id, val(side) == id, `canvasHead_${id}`, () => apply({ [side]: id }), <Icon flip={side == 'startHead'} />);
	}));

	return (
		<div className="canvasPanel" onMouseDown={e => e.stopPropagation()}>
			{f.color ? section('canvasPanelStroke', COLORS.map(name => swatch(name, (val('color') || 'default') == name, () => apply({ color: name })))) : ''}

			{f.background ? section('canvasPanelBackground', [
				<div key="none" className={[ 'canvasSwatch', 'none', (!val('fill') ? 'active' : '') ].join(' ')} title={translate('canvasNoFill')} onClick={() => apply({ fill: '' })} />,
			].concat(J.Theme.icon.list.map((name: string) => swatch(name, val('fill') == name, () => apply({ fill: name }), true))))
				: ''}

			{(f.fillStyle && val('fill')) ? section('canvasPanelFill', FILL_STYLES.map(id => {
				const Icon = CanvasIcon[`fill_${id}`];

				return option(id, val('fillStyle') == id, `canvasFill_${id}`, () => apply({ fillStyle: id as any }), <Icon />);
			})) : ''}

			{f.width ? section('canvasPanelWidth', WIDTHS.map(w => option(String(w), (val('strokeWidth') || 2) == w, `canvasWidth_${w}`, () => apply({ strokeWidth: w }), <span className="bar" style={{ height: w }} />))) : ''}

			{f.strokeStyle ? section('canvasPanelStrokeStyle', STROKE_STYLES.map(id => {
				const dash = (id == 'solid') ? '' : ((id == 'dashed') ? '4 3' : '0.1 3');

				return option(id, val('strokeStyle') == id, `canvasStrokeStyle_${id}`, () => apply({ strokeStyle: id as any }), line(dash));
			})) : ''}

			{f.roughness ? section('canvasPanelRoughness', ROUGHNESS.map(n => {
				const Icon = CanvasIcon[`rough_${n}`];

				return option(String(n), val('roughness') == n, `canvasRoughness_${n}`, () => apply({ roughness: n }), <Icon />);
			})) : ''}

			{f.edges ? section('canvasPanelEdges', [ false, true ].map(rounded => {
				const Icon = CanvasIcon[rounded ? 'edges_round' : 'edges_sharp'];

				return option(String(rounded), !!val('rounded') == rounded, rounded ? 'canvasEdges_round' : 'canvasEdges_sharp', () => apply({ rounded }), <Icon />);
			})) : ''}

			{f.arrowType ? section('canvasPanelArrowType', ARROW_TYPES.map(id => {
				const Icon = CanvasIcon[`route_${id}`];

				return option(id, val('arrowType') == id, `canvasArrowType_${id}`, () => apply({ arrowType: id as any }), <Icon />);
			})) : ''}

			{f.heads ? head('startHead') : ''}
			{f.heads ? head('endHead') : ''}

			{f.font ? section('canvasPanelFont', FAMILIES.map(id => option(
				id, val('fontFamily') == id, `canvasFont_${id}`, () => apply({ fontFamily: id as any }), 'Aa',
				{ fontFamily: (id == 'hand') ? 'Caveat, cursive' : ((id == 'code') ? 'monospace' : 'inherit'), fontSize: (id == 'hand') ? 16 : 12 },
			))) : ''}

			{f.font ? section('canvasPanelSize', SIZES.map(s => option(s.id, val('fontSize') == s.value, `canvasSize_${s.id}`, () => apply({ fontSize: s.value }), s.id))) : ''}

			{f.align ? section('canvasPanelAlign', ALIGNS.map(id => {
				const Icon = CanvasIcon[`align_${id}`];

				return option(id, val('textAlign') == id, `canvasAlign_${id}`, () => apply({ textAlign: id as any }), <Icon />);
			})) : ''}

			{f.vertical ? section('canvasPanelVertical', VERTICAL.map(id => option(id, val('verticalAlign') == id, `canvasVertical_${id}`, () => apply({ verticalAlign: id as any }), translate(`canvasVertical_${id}`)))) : ''}

			{f.opacity ? (
				<div className="section">
					<div className="label">{translate('canvasPanelOpacity')}</div>
					<input
						type="range"
						min={0}
						max={100}
						step={OPACITY_STEP}
						value={val('opacity') ?? 100}
						onChange={e => apply({ opacity: Math.max(OPACITY_STEP, Number(e.target.value)) })}
					/>
				</div>
			) : ''}

			{selected.length ? (
				<>
					{section('canvasPanelLayers', [
						[ 'back', 'canvasSendToBack', 'back' ],
						[ 'backward', 'canvasSendBackward', 'backward' ],
						[ 'forward', 'canvasBringForward', 'forward' ],
						[ 'front', 'canvasBringToFront', 'front' ],
					].map(([ id, title, icon ]) => {
						const Icon = CanvasIcon[icon];

						return option(id, false, title, () => act(() => controller.reorder(id as any)), <Icon />);
					}))}

					{section('canvasPanelActions', [
						option('duplicate', false, 'canvasDuplicate', () => act(() => controller.duplicate()), <CanvasIcon.duplicate />),
						option('delete', false, 'commonDelete', () => act(() => controller.deleteSelection()), <CanvasIcon.trash />),
					])}
				</>
			) : ''}
		</div>
	);

};

export default CanvasPanel;
