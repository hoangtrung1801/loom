import React from 'react';
import { translate } from 'Lib';
import { CanvasController, Tool } from 'Lib/canvas';
import { CanvasIcon } from './icons';

interface Props {
	controller: CanvasController;
	tool: Tool;
	readonly?: boolean;
	onAddObject: () => void;
	onMenu: () => void;
	onLibrary: () => void;
	onChange: () => void;
};

interface Item {
	key: string;
	id?: Tool;
	hint?: string;
};

const TOOLS: Item[] = [
	{ key: 'hand', id: Tool.Hand },
	{ key: 'select', id: Tool.Select, hint: '1' },
	{ key: 'rect', id: Tool.Rect, hint: '2' },
	{ key: 'diamond', id: Tool.Diamond, hint: '3' },
	{ key: 'ellipse', id: Tool.Ellipse, hint: '4' },
	{ key: 'arrow', id: Tool.Arrow, hint: '5' },
	{ key: 'line', id: Tool.Line, hint: '6' },
	{ key: 'pen', id: Tool.Pen, hint: '7' },
	{ key: 'text', id: Tool.Text, hint: '8' },
	{ key: 'object', hint: '9' },
	{ key: 'eraser', id: Tool.Eraser, hint: '0' },
];

const EXTRA: Item[] = [
	{ key: 'sticky', id: Tool.Sticky },
	{ key: 'frame', id: Tool.Frame },
];

const CanvasToolbar = ({ controller, tool, readonly, onAddObject, onMenu, onLibrary, onChange }: Props) => {

	const zoom = Math.round(controller.viewport.zoom * 100);

	const button = (key: string, onClick: () => void, active = false, disabled = false, hint = '', id = '') => {
		const Icon = CanvasIcon[key];
		const cn = [ 'canvasButton' ];

		if (active) {
			cn.push('active');
		};
		if (disabled) {
			cn.push('disabled');
		};

		return (
			<div
				key={key}
				id={id}
				className={cn.join(' ')}
				title={translate(`canvasTool_${key}`)}
				onMouseDown={e => e.stopPropagation()}
				onClick={() => !disabled && onClick()}
			>
				<Icon />
				{hint ? <span className="hint">{hint}</span> : ''}
			</div>
		);
	};

	const tools = (list: Item[]) => list.map(item => {
		if (item.id) {
			return button(item.key, () => controller.setTool(item.id), tool == item.id, false, item.hint);
		};
		return button(item.key, onAddObject, false, false, item.hint, 'canvasAddObject');
	});

	return (
		<>
			<div className="canvasTop">
				<div className="canvasPill">
					{button('menu', onMenu, false, false, '', 'canvasMenuButton')}
				</div>

				<div className="canvasPill">
					{readonly ? tools(TOOLS.slice(0, 2)) : (
						<>
							{button(controller.locked ? 'lock' : 'unlock', () => { controller.toggleLock(); onChange(); }, controller.locked)}
							<div className="canvasDivider" />
							{tools(TOOLS)}
							<div className="canvasDivider" />
							{tools(EXTRA)}
						</>
					)}
				</div>

				<div className="canvasPill">
					{button('library', onLibrary)}
				</div>
			</div>

			<div className="canvasZoom">
				{button('minus', () => controller.zoomBy(1 / 1.2))}
				<div className="canvasZoomValue" onClick={() => controller.setViewport({ ...controller.viewport, zoom: 1 })}>{zoom}%</div>
				{button('plus', () => controller.zoomBy(1.2))}
				{button('fit', () => controller.fit())}

				{!readonly ? (
					<>
						<div className="canvasDivider" />
						{button('undo', () => { controller.undo(); onChange(); }, false, !controller.history.canUndo())}
						{button('redo', () => { controller.redo(); onChange(); }, false, !controller.history.canRedo())}
					</>
				) : ''}
			</div>
		</>
	);

};

export default CanvasToolbar;
