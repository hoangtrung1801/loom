import React, { forwardRef, useEffect, useState } from 'react';
import { Loader } from 'Component';

// Larger documents are not worth inlining into an iframe, the user can download them instead
const MAX_SIZE = 10 * 1024 * 1024;

// No allow-same-origin: the document runs with an opaque origin, so its scripts can't reach
// the app window, its storage, the Electron bridge or the gateway. No allow-top-navigation / popups either.
const SANDBOX = 'allow-scripts';

interface Props {
	src: string;
	title?: string;
	sizeInBytes?: number;
	className?: string;
};

const MediaHtml = forwardRef<HTMLDivElement, Props>(({
	src,
	title = '',
	sizeInBytes = 0,
	className = '',
}, ref) => {

	const [ html, setHtml ] = useState<string>(null);
	const [ error, setError ] = useState('');
	const isTooLarge = sizeInBytes > MAX_SIZE;

	useEffect(() => {
		setHtml(null);
		setError('');

		if (!src) {
			return;
		};

		if (isTooLarge) {
			setError(translate('pageMainMediaHtmlTooLarge'));
			return;
		};

		const controller = new AbortController();

		fetch(src, { signal: controller.signal }).
			then(res => {
				if (!res.ok) {
					throw new Error(String(res.status));
				};
				return res.text();
			}).
			then(text => setHtml(text)).
			catch(e => {
				if (e?.name != 'AbortError') {
					setError(translate('pageMainMediaHtmlError'));
				};
			});

		return () => controller.abort();
	}, [ src, isTooLarge ]);

	const cn = [ 'mediaHtml', className ];

	let content = null;
	if (error) {
		content = <div className="error">{error}</div>;
	} else
	if (html === null) {
		content = <Loader />;
	} else {
		// srcdoc keeps the markup out of the gateway's origin: relative URLs don't resolve and
		// the page can't be navigated to as a top-level document.
		content = (
			<iframe
				title={title}
				className="htmlFrame"
				sandbox={SANDBOX}
				srcDoc={html}
				referrerPolicy="no-referrer"
			/>
		);
	};

	return (
		<div ref={ref} className={cn.join(' ')}>
			{content}
		</div>
	);

});

export default MediaHtml;
