import React, { forwardRef, useRef, useEffect } from 'react';
import { history as historyPopup } from 'Lib/history';
import { Page } from 'Component';
import * as I from 'Interface';

interface Props extends I.Popup {};

const PopupPage = forwardRef<{}, Props>((props, ref) => {
	
	const { param, getId } = props;
	const { data } = param;
	const { matchPopup } = data;
	const scrollHandlerRef = useRef<(() => void) | null>(null);
	const isSidebar = (param.className || '').split(' ').includes('popupPageSidebar');

	// Side panel has no dimmer, so close it when the user clicks outside of it
	const onOutsideMouseDown = (e: MouseEvent) => {
		const target = e.target as HTMLElement;

		if (!target || !target.closest || !target.isConnected) {
			return;
		};

		// Ignore clicks inside the panel, menus and any other popup (e.g. confirm dialogs)
		if (target.closest('.innerWrap, .menuWrap, .menu, .popup, .tooltip')) {
			return;
		};

		S.Popup.close('page');
	};

	const getInnerWrap = (): HTMLElement | null => {
		const container = U.Dom.get(getId());
		return container ? U.Dom.select('.innerWrap', container) : null;
	};

	const rebind = () => {
		unbind();
		scrollHandlerRef.current = () => S.Menu.resizeAll();
		const wrap = getInnerWrap();
		if (wrap) {
			U.Dom.addEvent(wrap, 'scroll', scrollHandlerRef.current);
		};
	};

	const unbind = () => {
		if (scrollHandlerRef.current) {
			const wrap = getInnerWrap();
			if (wrap) {
				U.Dom.removeEvent(wrap, 'scroll', scrollHandlerRef.current);
			};
			scrollHandlerRef.current = null;
		};
	};

	useEffect(() => {
		rebind();
		historyPopup.pushMatch(matchPopup);

		S.Common.clearRightSidebarState(true);
		sidebar.init(true);

		if (isSidebar) {
			U.Dom.addEvent(document, 'mousedown', onOutsideMouseDown as EventListener);
		};

		return () => {
			U.Dom.removeEvent(document, 'mousedown', onOutsideMouseDown as EventListener);
			unbind();
			historyPopup.clear();
			keyboard.setWindowTitle();
		};
	}, []);

	return (
		<div id="wrap">
			<Page 
				{...props}
				rootId={matchPopup.params.id} 
				isPopup={true} 
				matchPopup={matchPopup} 
			/>
		</div>
	);

});

export default PopupPage;
