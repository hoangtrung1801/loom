import React, { useEffect, useState } from 'react';
import { translate } from 'Lib';
import { CanvasController } from 'Lib/canvas';
import { CanvasRenderer } from './renderer';
import { CanvasIcon } from './icons';

interface Props {
	controller: CanvasController;
	renderer: CanvasRenderer;
	name: string;
	onClose: () => void;
};

const SCALES = [ 1, 2, 3 ];
const PREVIEW_SIZE = 260;

/** Export dialog: draws the canvas (or only the selection) into a PNG. */
const CanvasExport = ({ controller, renderer, name, onClose }: Props) => {

	const hasSelection = controller.scene.selected().length > 0;
	const [ background, setBackground ] = useState(true);
	const [ onlySelected, setOnlySelected ] = useState(hasSelection);
	const [ scale, setScale ] = useState(2);
	const [ preview, setPreview ] = useState('');

	const getElements = () => (onlySelected && hasSelection) ? controller.scene.selected() : controller.scene.list();

	const draw = (size?: number) => renderer.exportImage(getElements(), { scale: size ? 1 : scale, background, maxSize: size });

	useEffect(() => {
		const canvas = draw(PREVIEW_SIZE * 2);

		setPreview(canvas ? canvas.toDataURL('image/png') : '');
	}, [ background, onlySelected ]);

	const getBlob = (): Promise<Blob | null> => new Promise(resolve => {
		const canvas = draw();

		canvas ? canvas.toBlob(blob => resolve(blob), 'image/png') : resolve(null);
	});

	const onDownload = async () => {
		const blob = await getBlob();
		if (!blob) {
			return;
		};

		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');

		a.href = url;
		a.download = `${(name || 'canvas').replace(/[\\/:*?"<>|]+/g, '_')}.png`;
		a.click();
		window.setTimeout(() => URL.revokeObjectURL(url), 1000);
		onClose();
	};

	const onCopy = async () => {
		const blob = await getBlob();
		if (!blob) {
			return;
		};

		try {
			await navigator.clipboard.write([ new ClipboardItem({ 'image/png': blob }) ]);
		} catch (e) {};
		onClose();
	};

	const check = (label: string, value: boolean, onChange: (v: boolean) => void, disabled = false) => (
		<label className={[ 'check', (disabled ? 'disabled' : '') ].join(' ')}>
			<input type="checkbox" checked={value} disabled={disabled} onChange={e => onChange(e.target.checked)} />
			<span>{translate(label)}</span>
		</label>
	);

	return (
		<div className="canvasDialogWrap" onMouseDown={e => e.stopPropagation()}>
			<div className="canvasDialogBg" onClick={onClose} />
			<div className="canvasDialog" role="dialog" aria-label={translate('canvasExportTitle')}>
				<div className="head">
					<div className="title">{translate('canvasExportTitle')}</div>
					<div className="canvasButton" onClick={onClose}><CanvasIcon.close /></div>
				</div>

				<div className="preview">
					{preview ? <img src={preview} alt="" /> : <div className="empty">{translate('canvasExportEmpty')}</div>}
				</div>

				<div className="options">
					{check('canvasExportBackground', background, setBackground)}
					{check('canvasExportSelected', onlySelected, setOnlySelected, !hasSelection)}
				</div>

				<div className="scale">
					<div className="label">{translate('canvasExportScale')}</div>
					<div className="segments">
						{SCALES.map(n => <div key={n} className={[ 'segment', (scale == n ? 'active' : '') ].join(' ')} onClick={() => setScale(n)}>{n}x</div>)}
					</div>
				</div>

				<div className="buttons">
					<div className="button primary" onClick={onDownload}>PNG</div>
					<div className="button" onClick={onCopy}>{translate('canvasExportCopy')}</div>
				</div>
			</div>
		</div>
	);

};

export default CanvasExport;
