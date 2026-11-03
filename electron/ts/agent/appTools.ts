import type { AgentTool } from '@earendil-works/pi-agent-core';
import { APP_TOOL_PREFIX } from './policy';

export const APP_TOOL_TIMEOUT = 15000;

export interface AppToolBridgeDeps {
	/** Delivers a request to the renderer tab that owns the run. */
	send: (tabId: string, payload: { id: string; name: string; args: any }) => void;
	timeoutMs?: number;
};

/**
 * Tools that only the open window can answer (what is selected, show this object). The main
 * process asks the tab over IPC and waits for agentAppToolResult.
 */
export class AppToolBridge {

	private pending: Map<string, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }> = new Map();
	private seq = 0;

	constructor (private deps: AppToolBridgeDeps) {};

	call (tabId: string, name: string, args: any, signal?: AbortSignal): Promise<any> {
		const id = `app-${Date.now()}-${++this.seq}`;

		return new Promise((resolve, reject) => {
			const done = () => {
				const item = this.pending.get(id);
				if (item) {
					clearTimeout(item.timer);
					this.pending.delete(id);
				};
			};

			const timer = setTimeout(() => {
				done();
				reject(new Error(`${name}: the app did not answer`));
			}, this.deps.timeoutMs ?? APP_TOOL_TIMEOUT);

			this.pending.set(id, {
				resolve: v => { done(); resolve(v); },
				reject: e => { done(); reject(e); },
				timer,
			});

			signal?.addEventListener('abort', () => this.pending.get(id)?.reject(new Error('aborted')), { once: true });
			this.deps.send(tabId, { id, name, args });
		});
	};

	resolve (id: string, result: any): void {
		this.pending.get(id)?.resolve(result);
	};

};

const text = (value: any) => ({ type: 'text' as const, text: typeof value == 'string' ? value : JSON.stringify(value) });

export const createAppTools = (bridge: AppToolBridge, getTabId: () => string): AgentTool<any>[] => [
	{
		name: `${APP_TOOL_PREFIX}get_context`,
		label: 'Get app context',
		description: 'What the user is looking at right now: the current space, the open object and any selected blocks with their text. Call this for requests such as "this page" or "the selected text".',
		parameters: { type: 'object', properties: {} },
		execute: async (_id: string, _params: any, signal?: AbortSignal) => {
			const result = await bridge.call(getTabId(), 'get_context', {}, signal);
			return { content: [ text(result) ], details: undefined };
		},
	},
	{
		name: `${APP_TOOL_PREFIX}open_object`,
		label: 'Open object',
		description: 'Shows an object to the user in the app. Takes the object id exactly as returned by find or read (not a result number). Changes only what is on screen.',
		parameters: {
			type: 'object',
			properties: { object: { type: 'string', description: 'object id' } },
			required: [ 'object' ],
		},
		execute: async (_id: string, params: any, signal?: AbortSignal) => {
			const result = await bridge.call(getTabId(), 'open_object', { object: String(params?.object || '') }, signal);
			return { content: [ text(result) ], details: undefined };
		},
	},
];

export const APP_TOOL_READ_ONLY = new Set([ `${APP_TOOL_PREFIX}get_context`, `${APP_TOOL_PREFIX}open_object` ]);
