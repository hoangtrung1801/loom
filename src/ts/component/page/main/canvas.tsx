import React, { forwardRef, useEffect, useRef, useState } from 'react';
import { Header, Deleted, Loader } from 'Component';
import { I, C, S, U, Action, keyboard } from 'Lib';
import MediaCanvas from 'Component/canvas';

const PageMainCanvas = forwardRef<I.PageRef, I.PageComponent>((props, ref) => {

	const { isPopup } = props;
	const [ isLoading, setIsLoading ] = useState(false);
	const [ isDeleted, setIsDeleted ] = useState(false);
	const [ ready, setReady ] = useState(false);
	const headerRef = useRef(null);
	const idRef = useRef('');
	const rootId = keyboard.getRootId(isPopup);

	const open = () => {
		if (!rootId) {
			return;
		};

		close();
		idRef.current = rootId;
		setIsDeleted(false);
		setReady(false);
		setIsLoading(true);

		C.ObjectOpen(rootId, '', S.Common.space, (message: any) => {
			setIsLoading(false);

			if (!U.Common.checkErrorOnOpen(rootId, message.error.code)) {
				return;
			};

			const object = S.Detail.get(rootId, rootId, []);

			if (object.isDeleted) {
				setIsDeleted(true);
				return;
			};

			S.Common.setRightSidebarState(isPopup, { rootId });
			headerRef.current?.forceUpdate();
			setReady(true);
		});
	};

	const close = () => {
		if (idRef.current) {
			Action.pageClose(isPopup, idRef.current, true);
		};
		idRef.current = '';
	};

	const onOpenObject = (id: string) => {
		const object = S.Detail.get(rootId, id, [ 'layout' ], true);

		U.Object.openConfig(null, { id, layout: object.layout });
	};

	useEffect(() => {
		open();
		return () => close();
	}, [ rootId ]);

	const canWrite = U.Space.canMyParticipantWrite();
	let content = null;

	if (isDeleted) {
		content = <Deleted {...props} />;
	} else {
		content = (
			<>
				<Header
					{...props}
					component="mainObject"
					ref={headerRef}
					rootId={rootId}
				/>

				<div key={rootId} className="canvasPage">
					{isLoading ? <Loader id="loader" /> : ''}
					{ready ? (
						<MediaCanvas
							rootId={rootId}
							readonly={!canWrite}
							isPopup={isPopup}
							onOpenObject={onOpenObject}
						/>
					) : ''}
				</div>
			</>
		);
	};

	return content;

});

export default PageMainCanvas;
