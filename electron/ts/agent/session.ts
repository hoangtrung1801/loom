import { Agent, type AgentTool } from '@earendil-works/pi-agent-core';
import type { ResolvedModel } from './models';
import { APP_TOOL_READ_ONLY } from './appTools';
import {
	MAX_TURNS, READ_ONLY_NOTE, SYSTEM_PROMPT, contextSection, historySection, isMutating, trimMessages, truncateText,
} from './policy';
import type { AgentConfig, AgentRunParams, AgentUiEvent } from './types';

const READ_ONLY_DENIED = 'This run is read-only. Do not retry; tell the user to ask in the Lo side panel.';
const DENIED = 'The user declined this change. Do not retry it; ask what they would like instead.';

export interface SessionToolbox {
	tools: AgentTool<any>[];
	readOnly: Map<string, boolean>;
	instructions: string;
};

export interface SessionDeps {
	config: AgentConfig;
	resolved: ResolvedModel;
	toolbox: SessionToolbox;
	appTools: AgentTool<any>[];
	getApiKey: () => Promise<string | undefined> | string | undefined;
	emit: (event: AgentUiEvent) => void;
};

const textOf = (content: any[] = []): string => content.map(it => (it?.type == 'text' ? it.text : '')).join('');

/**
 * One chat. Wraps a pi Agent, which runs the model → tool → model loop, and adds what the app
 * needs around it: the approval gate for changes, the turn cap, result truncation and the
 * translation of pi events into the small set the sidebar renders.
 */
export class AgentSession {

	agent: Agent;
	private runId = '';
	private turns = 0;
	private seeded = false;
	private readOnlyRun = false;
	private approvals: Map<string, (allow: boolean) => void> = new Map();

	constructor (private deps: SessionDeps) {
		const { resolved, toolbox, appTools } = deps;
		const system = [ SYSTEM_PROMPT, toolbox.instructions ].filter(Boolean).join('\n\n');

		this.agent = new Agent({
			initialState: {
				systemPrompt: system,
				model: resolved.model,
				tools: [ ...toolbox.tools, ...appTools ],
			},
			streamFn: resolved.streamFn,
			getApiKey: () => deps.getApiKey(),
			identity: { attribution: { name: 'Loom', url: 'https://github.com/hoangtrung1801/loom' } },
			toolExecution: 'sequential',
			transformContext: async messages => trimMessages(messages as any[]) as any,
			beforeToolCall: async ({ toolCall }, signal) => {
				const name = toolCall.name;
				const readOnly = APP_TOOL_READ_ONLY.has(name) || !isMutating(toolbox.readOnly.get(name));

				if (readOnly) {
					return;
				};
				if (this.readOnlyRun) {
					return { block: true, reason: READ_ONLY_DENIED };
				};
				if (!this.deps.config.confirm) {
					return;
				};

				const allow = await this.askApproval(toolCall.id, name, toolCall.arguments, signal);
				return allow ? undefined : { block: true, reason: DENIED };
			},
			afterToolCall: async ({ result }) => {
				const content = (result.content || []).map((it: any) => (it.type == 'text' ? { ...it, text: truncateText(it.text) } : it));
				return { content };
			},
			finishTurn: async ({ message }) => {
				this.turns++;

				const stop = (message as any)?.stopReason;
				if ((stop == 'error') || (stop == 'aborted')) {
					return;
				};
				if (this.turns >= MAX_TURNS) {
					return { action: 'end' };
				};
			},
		});

		this.agent.subscribe(event => this.onEvent(event));
	};

	get isRunning (): boolean {
		return this.agent.state.isStreaming;
	};

	updateConfig (config: AgentConfig): void {
		this.deps.config = config;
	};

	async run (params: AgentRunParams): Promise<void> {
		const { runId, text, context, history } = params;

		this.runId = runId;
		this.turns = 0;
		this.readOnlyRun = !!params.readOnly;
		this.deps.emit({ runId, type: 'start' });

		// Sections replace by name, so the newest app context always wins
		const sections: Record<string, string> = {};
		const ctx = contextSection(context);

		if (ctx) {
			sections.context = ctx;
		};
		if (this.readOnlyRun) {
			sections.mode = READ_ONLY_NOTE;
		};
		if (!this.seeded && history?.length) {
			sections.history = historySection(history);
		};
		this.seeded = true;

		const now = Date.now();
		const input: any[] = [];

		if (Object.keys(sections).length) {
			input.push({ role: 'system', content: '', sections, timestamp: now });
		};
		input.push({ role: 'user', content: text, timestamp: now });

		let error = '';
		try {
			await this.agent.prompt(input);
		} catch (e: any) {
			error = String(e?.message || e);
		};

		const last = [ ...this.agent.state.messages ].reverse().find((it: any) => it.role == 'assistant') as any;
		const stopReason = error ? 'error' : String(last?.stopReason || 'stop');

		this.denyAll();
		this.deps.emit({ runId, type: 'end', stopReason, error: error || last?.errorMessage || undefined });
	};

	steer (text: string): void {
		this.agent.steer({ role: 'user', content: text, timestamp: Date.now() });
	};

	stop (): void {
		this.denyAll();
		this.agent.abort();
	};

	approve (callId: string, allow: boolean): void {
		const resolve = this.approvals.get(callId);

		if (resolve) {
			this.approvals.delete(callId);
			resolve(allow);
		};
	};

	private askApproval (callId: string, name: string, args: any, signal?: AbortSignal): Promise<boolean> {
		const label = this.deps.toolbox.tools.find(it => it.name == name)?.label || name;

		return new Promise(resolve => {
			this.approvals.set(callId, resolve);
			signal?.addEventListener('abort', () => this.approve(callId, false), { once: true });
			this.deps.emit({ runId: this.runId, type: 'approval', callId, name, label, args });
		});
	};

	private denyAll (): void {
		for (const id of [ ...this.approvals.keys() ]) {
			this.approve(id, false);
		};
	};

	private onEvent (event: any): void {
		const runId = this.runId;
		const { toolbox, appTools } = this.deps;

		switch (event.type) {
			case 'message_update': {
				const e = event.assistantMessageEvent;
				if (e?.type == 'text_delta') {
					this.deps.emit({ runId, type: 'text', delta: e.delta });
				};
				break;
			};

			case 'tool_execution_start': {
				const name = event.toolName;
				const tool = [ ...toolbox.tools, ...appTools ].find(it => it.name == name);
				const readOnly = APP_TOOL_READ_ONLY.has(name) || !isMutating(toolbox.readOnly.get(name));

				this.deps.emit({ runId, type: 'toolStart', callId: event.toolCallId, name, label: tool?.label || name, args: event.args, readOnly });
				break;
			};

			case 'tool_execution_end': {
				this.deps.emit({
					runId,
					type: 'toolEnd',
					callId: event.toolCallId,
					isError: !!event.isError,
					text: truncateText(textOf(event.result?.content), 2000),
				});
				break;
			};
		};
	};

};
