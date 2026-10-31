import { createRoot } from 'react-dom/client';
import Popup from './popup';
import Iframe from './iframe';
import Auth from './auth';
import Util from './lib/util';

import './scss/common.scss';

declare global {
	interface Window {
		isExtension: boolean;
		Electron: any;
		$: any;
		Loom: any;
		isWebVersion: boolean;
		LoomGlobalConfig: any;
	}
};

window.isExtension = true;
window.Electron = {
	currentWindow: () => ({}),
	Api: () => {},
	platform: '',
	tabId: () => null,
	winId: () => 0,
	on: () => {},
	removeAllListeners: () => {},
	send: () => {},
	getTheme: () => '',
};

window.Loom = {
	Lib: {
		C,
		U,
		S,
	},
};

window.LoomGlobalConfig = { 
	emojiUrl: J.Extension.clipper.emojiUrl, 
	menuBorderTop: 16, 
	menuBorderBottom: 16,
	flagsMw: { request: true, event: true },
};

let rootId = '';
let component: any = null;

if (Util.isPopup()) {
	rootId = `${J.Extension.clipper.prefix}-popup`;
	component = <Popup />;
} else 
if (Util.isIframe()) {
	rootId = `${J.Extension.clipper.prefix}-iframe`;
	component = <Iframe />;
} else 
if (Util.isAuth()) {
	rootId = `${J.Extension.clipper.prefix}-auth`;
	component = <Auth />;
};

if (!rootId) {
	console.error('[Entry] rootId is not defined');
} else {
	if (!document.getElementById(rootId)) {
		const rootEl = document.createElement('div');
		rootEl.id = rootId;
		document.body.appendChild(rootEl);
		document.documentElement.classList.add(rootId);
	};

	const root = createRoot(document.getElementById(rootId));
	root.render(component);
};