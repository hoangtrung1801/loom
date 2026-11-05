import React from 'react';
import { J, S, translate } from 'Lib';
import { CanvasController, CanvasElement, ElementType } from 'Lib/canvas';
import { CanvasIcon } from './icons';

interface Props {
	controller: CanvasController;
	onChange: () => void;
};

const WIDTHS = [ 1, 2, 4 ];
const SIZES = [ 14, 16, 24, 32 ];
const COLORS = [ 'default' ].concat(J.Theme.icon.list);

const FILLABLE = [ ElementType.Rect, ElementType.Ellipse, ElementType.Sticky ];
const TEXTUAL = [ ElementType.Text, ElementType.Sticky, ElementType.Rect, ElementType.Ellipse ];
const STROKED = [ ElementType.Rect, ElementType.Ellipse, ElementType.Line, ElementType.Arrow, ElementType.Freehand ];

const CanvasStylebar = ({ controller, onChange }: Props) => {

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
		onChange();
	};

	const swatch = (name: string, active: boolean, onClick: () => void, soft = false) => {
		const value = soft ? (J.Theme.icon.text[name] || theme.graph.link) : theme.color[name];
		const cn = [ 'canvasSwatch' ];

		if (active) {
			cn.push('active');
		};

		return <div key={name} className={cn.join(' ')} style={{ background: value }} onClick={onClick} />;
	};

	return (
		<div className="canvasStylebar" onMouseDown={e => e.stopPropagation()}>
			{hasColor ? (
				<div className="group">
					{COLORS.map(name => swatch(name, (first.color || 'default') == name, () => apply({ color: name })))}
				</div>
			) : ''}

			{hasFill ? (
				<div className="group">
					<div className={[ 'canvasSwatch', 'none', (!first.fill ? 'active' : '') ].join(' ')} title={translate('canvasNoFill')} onClick={() => apply({ fill: '' })} />
					{J.Theme.icon.list.map((name: string) => swatch(name, first.fill == name, () => apply({ fill: name }), true))}
				</div>
			) : ''}

			{hasStroke ? (
				<div className="group">
					{WIDTHS.map(w => (
						<div key={w} className={[ 'canvasOption', ((first.strokeWidth || 2) == w ? 'active' : '') ].join(' ')} onClick={() => apply({ strokeWidth: w })}>
							<span style={{ height: w }} />
						</div>
					))}
				</div>
			) : ''}

			{hasText ? (
				<div className="group">
					{SIZES.map(s => (
						<div key={s} className={[ 'canvasOption', ((first.fontSize || 16) == s ? 'active' : '') ].join(' ')} onClick={() => apply({ fontSize: s })}>{s}</div>
					))}
				</div>
			) : ''}

			<div className="group">
				<div className="canvasButton" title={translate('canvasBringToFront')} onClick={() => { controller.reorder('front'); onChange(); }}><CanvasIcon.front /></div>
				<div className="canvasButton" title={translate('canvasSendToBack')} onClick={() => { controller.reorder('back'); onChange(); }}><CanvasIcon.back /></div>
				<div className="canvasButton" title={translate('commonDelete')} onClick={() => { controller.deleteSelection(); onChange(); }}><CanvasIcon.trash /></div>
			</div>
		</div>
	);

};

export default CanvasStylebar;
