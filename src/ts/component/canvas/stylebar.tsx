import React, { useState } from 'react';
import { J, S, translate } from 'Lib';
import { CanvasController, CanvasElement, ElementType } from 'Lib/canvas';
import { CanvasIcon } from './icons';

interface Props {
	controller: CanvasController;
	onChange: () => void;
};

type Panel = '' | 'color' | 'fill' | 'stroke' | 'size';

const WIDTHS = [ 1, 2, 4 ];
const SIZES = [ 14, 16, 24, 32 ];
const COLORS = [ 'default' ].concat(J.Theme.icon.list);

const FILLABLE = [ ElementType.Rect, ElementType.Ellipse, ElementType.Sticky ];
const TEXTUAL = [ ElementType.Text, ElementType.Sticky, ElementType.Rect, ElementType.Ellipse ];
const STROKED = [ ElementType.Rect, ElementType.Ellipse, ElementType.Line, ElementType.Arrow, ElementType.Freehand ];

/**
 * One compact row of buttons. Each style group opens a small popover below the bar,
 * so the bar never grows tall enough to sit on top of the drawing area.
 */
const CanvasStylebar = ({ controller, onChange }: Props) => {

	const [ panel, setPanel ] = useState<Panel>('');
	const selected = controller.scene.selected();

	if (!selected.length || controller.isDragging) {
		return null;
	};

	const first = selected[0];
	const theme = J.Theme[S.Common.getThemeClass()] as any;
	const hasFill = selected.some(el => FILLABLE.includes(el.type));
	const hasText = selected.some(el => TEXTUAL.includes(el.type));
	const hasStroke = selected.some(el => STROKED.includes(el.type));
	const hasColor = selected.some(el => el.type != ElementType.Object);

	const apply = (patch: Partial<CanvasElement>) => {
		controller.setStyle(patch);
		setPanel('');
		onChange();
	};

	const toggle = (id: Panel) => setPanel(panel == id ? '' : id);

	const swatch = (name: string, active: boolean, onClick: () => void, soft = false) => {
		const value = soft ? (J.Theme.icon.text[name] || theme.graph.link) : theme.color[name];
		const cn = [ 'canvasSwatch' ];

		if (active) {
			cn.push('active');
		};

		return <div key={name} className={cn.join(' ')} style={{ background: value }} onClick={onClick} />;
	};

	const trigger = (id: Panel, title: string, content: React.ReactNode) => {
		const cn = [ 'canvasButton' ];

		if (panel == id) {
			cn.push('active');
		};

		return <div className={cn.join(' ')} title={translate(title)} onClick={() => toggle(id)}>{content}</div>;
	};

	let options = null;

	switch (panel) {
		case 'color':
			options = COLORS.map(name => swatch(name, (first.color || 'default') == name, () => apply({ color: name })));
			break;

		case 'fill':
			options = [
				<div key="none" className={[ 'canvasSwatch', 'none', (!first.fill ? 'active' : '') ].join(' ')} title={translate('canvasNoFill')} onClick={() => apply({ fill: '' })} />,
			].concat(J.Theme.icon.list.map((name: string) => swatch(name, first.fill == name, () => apply({ fill: name }), true)));
			break;

		case 'stroke':
			options = WIDTHS.map(w => (
				<div key={w} className={[ 'canvasOption', ((first.strokeWidth || 2) == w ? 'active' : '') ].join(' ')} onClick={() => apply({ strokeWidth: w })}>
					<span style={{ height: w }} />
				</div>
			));
			break;

		case 'size':
			options = SIZES.map(s => (
				<div key={s} className={[ 'canvasOption', ((first.fontSize || 16) == s ? 'active' : '') ].join(' ')} onClick={() => apply({ fontSize: s })}>{s}</div>
			));
			break;
	};

	return (
		<div className="canvasStylebar" onMouseDown={e => e.stopPropagation()}>
			<div className="bar">
				{hasColor ? trigger('color', 'canvasColor', <div className="canvasSwatch" style={{ background: theme.color[first.color || 'default'] }} />) : ''}
				{hasFill ? trigger('fill', 'canvasFill', <div className={[ 'canvasSwatch', (first.fill ? '' : 'none') ].join(' ')} style={first.fill ? { background: J.Theme.icon.text[first.fill] } : {}} />) : ''}
				{hasStroke ? trigger('stroke', 'canvasStroke', <div className="canvasOption"><span style={{ height: first.strokeWidth || 2 }} /></div>) : ''}
				{hasText ? trigger('size', 'canvasFontSize', <div className="canvasOption">{first.fontSize || 16}</div>) : ''}

				<div className="canvasDivider" />

				<div className="canvasButton" title={translate('canvasBringToFront')} onClick={() => { controller.reorder('front'); onChange(); }}><CanvasIcon.front /></div>
				<div className="canvasButton" title={translate('canvasSendToBack')} onClick={() => { controller.reorder('back'); onChange(); }}><CanvasIcon.back /></div>
				<div className="canvasButton" title={translate('commonDelete')} onClick={() => { controller.deleteSelection(); onChange(); }}><CanvasIcon.trash /></div>
			</div>

			{options ? <div className="options">{options}</div> : ''}
		</div>
	);

};

export default CanvasStylebar;
