import React from 'react';
import { translate } from 'Lib';
import { CanvasController, Tool } from 'Lib/canvas';
import { CanvasIcon } from './icons';

interface Props {
	controller: CanvasController;
	tool: Tool;
	readonly?: boolean;
	onAddObject: () => void;
	onChange: () => void;
};

const TOOLS: { id: Tool, key: string, shortcut: string }[] = [
	{ id: Tool.Select, key: 'select', shortcut: 'V' },
	{ id: Tool.Hand, key: 'hand', shortcut: 'H' },
	{ id: Tool.Rect, key: 'rect', shortcut: 'R' },
	{ id: Tool.Ellipse, key: 'ellipse', shortcut: 'O' },
	{ id: Tool.Line, key: 'line', shortcut: 'L' },
	{ id: Tool.Arrow, key: 'arrow', shortcut: 'A' },
	{ id: Tool.Pen, key: 'pen', shortcut: 'P' },
	{ id: Tool.Text, key: 'text', shortcut: 'T' },
	{ id: Tool.Sticky, key: 'sticky', shortcut: 'S' },
	{ id: Tool.Frame, key: 'frame', shortcut: 'F' },
];

const CanvasToolbar = ({ controller, tool, readonly, onAddObject, onChange }: Props) => {

	const zoom = Math.round(controller.viewport.zoom * 100);
	const tools = readonly ? TOOLS.slice(0, 2) : TOOLS;

	const button = (key: string, onClick: () => void, active = false, disabled = false, id = '') => {
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
			</div>
		);
	};

	return (
		<>
			<div className="canvasToolbar">
				{tools.map(item => button(item.key, () => controller.setTool(item.id), tool == item.id))}
				{!readonly ? (
					<>
						<div className="canvasDivider" />
						{button('object', onAddObject, false, false, 'canvasAddObject')}
					</>
				) : ''}
			</div>

			<div className="canvasZoom">
				{!readonly ? (
					<>
						{button('undo', () => { controller.undo(); onChange(); }, false, !controller.history.canUndo())}
						{button('redo', () => { controller.redo(); onChange(); }, false, !controller.history.canRedo())}
						<div className="canvasDivider" />
					</>
				) : ''}
				{button('minus', () => controller.zoomBy(1 / 1.2))}
				<div className="canvasZoomValue" onClick={() => controller.setViewport({ ...controller.viewport, zoom: 1 })}>{zoom}%</div>
				{button('plus', () => controller.zoomBy(1.2))}
				{button('fit', () => controller.fit())}
			</div>
		</>
	);

};

export default CanvasToolbar;
