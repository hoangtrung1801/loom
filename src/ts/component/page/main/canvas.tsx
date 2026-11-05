import React, { forwardRef, useEffect, useRef, useState } from 'react';
import { Header, Deleted, Loader } from 'Component';
import { I, C, S, U, Action, keyboard, translate } from 'Lib';
import MediaCanvas from 'Component/canvas';

const PageMainCanvas = forwardRef<I.PageRef, I.PageComponent>((props, ref) => {

	const { isPopup } = props;
	const [ isLoading, setIsLoading ] = useState(false);
	const [ isDeleted, setIsDeleted ] = useState(false);
	const [ ready, setReady ] = useState(false);
	const [ name, setName ] = useState('');
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

			setName(String(object.name || ''));
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

	const onNameBlur = () => {
		const object = S.Detail.get(rootId, rootId, [ 'name' ]);
		const value = name.trim();

		if (value != String(object.name || '')) {
			U.Object.setName(rootId, value, () => headerRef.current?.forceUpdate());
		};
	};

	const onNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		e.stopPropagation();

		if (e.key == 'Enter') {
			e.preventDefault();
			(e.target as HTMLInputElement).blur();
		};
		if (e.key == 'Escape') {
			setName(String(S.Detail.get(rootId, rootId, [ 'name' ]).name || ''));
			(e.target as HTMLInputElement).blur();
		};
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
						<input
							className="canvasTitle"
							value={name}
							readOnly={!canWrite}
							placeholder={translate('defaultNamePage')}
							onChange={e => setName(e.target.value)}
							onFocus={e => e.target.select()}
							onBlur={onNameBlur}
							onKeyDown={onNameKeyDown}
							onKeyUp={e => e.stopPropagation()}
						/>
					) : ''}
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
