import React, { forwardRef, useEffect, useRef, useState } from 'react';
import { Label, Icon, Button, Input, Switch, Loader } from 'Component';
import * as I from 'Interface';
import type { AgentPart, AgentChatMessage } from 'Store/agent';
import { parseAgentMarkdown, type AgentInline } from 'Lib/agentMarkdown';
import AgentComposer, { type AgentComposerRef } from './composer';
import type { AgentCommand } from './commands';

type View = 'chat' | 'history' | 'settings';

/** Upper-cases only the first letter, keeping camelCase keys such as providerKey intact. */
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

const Inline = ({ items }: { items: AgentInline[] }) => (
	<>
		{items.map((it, i) => {
			if (it.type == 'bold') {
				return <b key={i}>{it.text}</b>;
			};
			if (it.type == 'italic') {
				return <i key={i}>{it.text}</i>;
			};
			if (it.type == 'code') {
				return <code key={i}>{it.text}</code>;
			};
			return <React.Fragment key={i}>{it.text}</React.Fragment>;
		})}
	</>
);

const Markdown = ({ text }: { text: string }) => (
	<div className="markdown">
		{parseAgentMarkdown(text).map((block, i) => {
			if (block.type == 'code') {
				return <pre key={i}><code>{block.text}</code></pre>;
			};
			if (block.type == 'heading') {
				return <div key={i} className="heading"><Inline items={block.inline} /></div>;
			};
			if (block.type == 'list') {
				const Tag = block.ordered ? 'ol' : 'ul';
				return <Tag key={i}>{block.items.map((item, j) => <li key={j}><Inline items={item} /></li>)}</Tag>;
			};
			return <p key={i}><Inline items={block.inline} /></p>;
		})}
	</div>
);

/** A user message, with each @-referenced object shown as a link that opens it. */
const UserText = ({ message }: { message: AgentChatMessage }) => {
	const text = message.parts.map(it => (it.type == 'text' ? it.text : '')).join('');
	const mentions = [ ...(message.mentions || []) ].sort((a, b) => a.from - b.from);
	const out: React.ReactNode[] = [];

	let at = 0;
	mentions.forEach((it, i) => {
		if ((it.from < at) || (it.to > text.length)) {
			return;
		};

		out.push(text.slice(at, it.from));
		out.push(
			<span key={i} className="mention" onClick={() => S.Agent.openObject(it.id)}>
				{text.slice(it.from, it.to)}
			</span>
		);
		at = it.to;
	});
	out.push(text.slice(at));

	return <div className="text">{out}</div>;
};

const SidebarPageAgent = forwardRef<{}, I.SidebarPageComponent>((props, ref: any) => {

	const { isPopup } = props;
	const spaceId = S.Common.space;
	const chatId = S.Agent.chatId(spaceId);
	const chat = S.Agent.getChat(chatId);
	const status = S.Agent.status;
	const [ view, setView ] = useState<View>('chat');
	const [ keyDraft, setKeyDraft ] = useState('');
	const bodyRef = useRef<HTMLDivElement>(null);
	const composerRef = useRef<AgentComposerRef>(null);
	const isRunning = chat.status == 'running';
	const lastText = chat.messages.length ? JSON.stringify(chat.messages[chat.messages.length - 1].parts) : '';

	useEffect(() => {
		S.Agent.loadStatus();
	}, []);

	useEffect(() => {
		S.Agent.restore(spaceId);
	}, [ spaceId ]);

	useEffect(() => {
		if (view == 'history') {
			S.Agent.loadSessions(spaceId);
		};
	}, [ view, spaceId ]);

	useEffect(() => {
		const node = bodyRef.current;
		if (node) {
			node.scrollTop = node.scrollHeight;
		};
	}, [ chat.messages.length, lastText, chat.error, view ]);

	const onNewChat = () => {
		S.Agent.newChat(spaceId);
		setView('chat');
		window.setTimeout(() => composerRef.current?.focus(), 0);
	};

	const onAction = (command: AgentCommand) => {
		switch (command.id) {
			case 'new': onNewChat(); break;
			case 'history': setView('history'); break;
			case 'settings': setView('settings'); break;
			case 'stop': S.Agent.stop(); break;
		};
	};

	const onOpenSession = (objectId: string) => {
		S.Agent.openSession(spaceId, objectId);
		setView('chat');
	};

	const renderTool = (part: Extract<AgentPart, { type: 'tool' }>) => {
		const cn = [ 'tool', part.status ];

		return (
			<div key={part.callId} className={cn.join(' ')}>
				<div className="line">
					<Label className="name" text={part.label} />
					<Label className="state" text={translate(`agentTool${cap(part.status)}`)} />
				</div>
				{part.status == 'approval' ? (
					<div className="approval">
						<pre className="args">{JSON.stringify(part.args, null, 2)}</pre>
						<div className="buttons">
							<Button text={translate('agentApprove')} color="blank" className="c28" onClick={() => S.Agent.approve(part.callId, true)} />
							<Button text={translate('agentDeny')} color="blank" className="c28" onClick={() => S.Agent.approve(part.callId, false)} />
						</div>
					</div>
				) : ''}
				{(part.status == 'error') && part.result ? <div className="result">{part.result}</div> : ''}
			</div>
		);
	};

	const renderMessage = (message: AgentChatMessage) => {
		const cn = [ 'message', message.role ];

		if (message.role == 'user') {
			return (
				<div key={message.id} className={cn.join(' ')}>
					<UserText message={message} />
				</div>
			);
		};

		return (
			<div key={message.id} className={cn.join(' ')}>
				{message.parts.map((part, i) => (part.type == 'tool') ? renderTool(part) : <Markdown key={i} text={part.text} />)}
			</div>
		);
	};

	const renderError = () => {
		if (!chat.error) {
			return null;
		};

		return (
			<div className="error">
				<Label text={translate(`agentError${cap(chat.error)}`)} />
				{chat.errorDetail ? <Label className="detail" text={chat.errorDetail} /> : ''}
				{[ 'providerKey', 'model', 'baseUrl' ].includes(chat.error) ? (
					<Button text={translate('agentOpenSettings')} color="blank" className="c28" onClick={() => setView('settings')} />
				) : ''}
			</div>
		);
	};

	const renderChat = () => {
		let content = null;

		if (chat.loading) {
			content = <Loader />;
		} else
		if (!chat.messages.length) {
			content = (
				<div className="empty">
					<Icon className="sparkle" name="header/agent" />
					<Label className="title" text={translate('agentEmptyTitle')} />
					<Label className="text" text={translate('agentEmptyText')} />
				</div>
			);
		} else {
			content = chat.messages.map(renderMessage);
		};

		return (
			<>
				<div id="body" className="body" ref={bodyRef}>
					{content}
					{isRunning ? <Label className="working" text={translate('agentWorking')} /> : ''}
					{renderError()}
				</div>

				<div className="composer">
					<div className="textareaWrap">
						<AgentComposer
							ref={composerRef}
							placeholder={translate('agentPlaceholder')}
							onSend={(text, mentions) => S.Agent.send(text, mentions)}
							onAction={onAction}
						/>
					</div>
					<div className="buttons">
						{isRunning ? <Button text={translate('agentStop')} color="blank" className="c28" onClick={() => S.Agent.stop()} /> : ''}
						<Button text={translate('agentSend')} color="accent" className="c28" onClick={() => composerRef.current?.send()} />
					</div>
				</div>
			</>
		);
	};

	const renderHistory = () => {
		const { sessions, sessionsLoading } = S.Agent;

		let content = null;
		if (sessionsLoading && !sessions.length) {
			content = <Loader />;
		} else
		if (!sessions.length) {
			content = <Label className="note" text={translate('agentHistoryEmpty')} />;
		} else {
			content = sessions.map(it => {
				const cn = [ 'session', (it.id == chat.objectId ? 'active' : '') ];

				return (
					<div key={it.id} className={cn.join(' ')} onClick={() => onOpenSession(it.id)}>
						<div className="info">
							<Label className="name" text={it.name || translate('agentUntitled')} />
							<Label className="date" text={it.lastModifiedDate ? U.Date.timeAgo(it.lastModifiedDate) : ''} />
						</div>
						<Icon
							className="delete"
							name="common/bin"
							withBackground={true}
							tooltipParam={{ text: translate('agentDeleteSession') }}
							onClick={(e: any) => {
								e.stopPropagation();
								S.Agent.deleteSession(spaceId, it.id);
							}}
						/>
					</div>
				);
			});
		};

		return <div id="body" className="body history">{content}</div>;
	};

	const renderSettings = () => {
		if (S.Agent.unsupported) {
			return <div id="body" className="body"><Label className="note" text={translate('agentErrorUnsupported')} /></div>;
		};
		if (!status) {
			return <div id="body" className="body" />;
		};

		const { config } = status;
		const isCustom = config.provider == 'custom';
		const providers = [
			{ id: 'anthropic', name: translate('agentProviderAnthropic') },
			{ id: 'custom', name: translate('agentProviderCustom') },
		];
		const tiers = [
			{ id: 'auto', name: translate('agentTierAuto') },
			{ id: 'large', name: translate('agentTierLarge') },
			{ id: 'small', name: translate('agentTierSmall') },
		];

		const choices = (items: any[], value: string, key: string) => (
			<div className="choices">
				{items.map(it => {
					const cn = [ 'choice', (it.id == value ? 'active' : '') ];

					return (
						<div key={it.id} className={cn.join(' ')} onClick={() => S.Agent.setConfig({ [key]: it.id })}>
							{it.name}
						</div>
					);
				})}
			</div>
		);

		return (
			<div id="body" className="body settings">
				<div className="field">
					<Label text={translate('agentSettingsProvider')} />
					{choices(providers, config.provider, 'provider')}
				</div>

				<div className="field">
					<Label text={translate('agentSettingsKey')} />
					<Input
						type="password"
						value={keyDraft}
						placeholder={status.hasProviderKey ? translate('agentSettingsKeySaved') : ''}
						onChange={(e: any, v: string) => setKeyDraft(v)}
						onBlur={() => {
							if (keyDraft) {
								S.Agent.setProviderKey(keyDraft);
								setKeyDraft('');
							};
						}}
					/>
					<Label className="hint" text={translate(isCustom ? 'agentSettingsKeyHintCustom' : 'agentSettingsKeyHint')} />
				</div>

				<div className="field">
					<Label text={translate('agentSettingsModel')} />
					<Input value={config.model} onBlur={(e: any, v: string) => S.Agent.setConfig({ model: v })} />
				</div>

				{isCustom ? (
					<div className="field">
						<Label text={translate('agentSettingsBaseUrl')} />
						<Input value={config.baseUrl} placeholder="http://localhost:11434/v1" onBlur={(e: any, v: string) => S.Agent.setConfig({ baseUrl: v })} />
					</div>
				) : ''}

				<div className="field">
					<Label text={translate('agentSettingsTier')} />
					{choices(tiers, config.tier, 'tier')}
				</div>

				<div className="field row">
					<div className="info">
						<Label text={translate('agentSettingsConfirm')} />
						<Label className="hint" text={translate('agentSettingsConfirmHint')} />
					</div>
					<Switch value={config.confirm} onChange={(e: any, v: boolean) => S.Agent.setConfig({ confirm: v })} />
				</div>
			</div>
		);
	};

	const titles: Record<View, string> = {
		chat: translate('agentTitle'),
		history: translate('agentHistory'),
		settings: translate('agentSettingsTitle'),
	};

	let body = null;
	switch (view) {
		case 'history': body = renderHistory(); break;
		case 'settings': body = renderSettings(); break;
		default: body = renderChat(); break;
	};

	return (
		<>
			<div id="head" className="head">
				<div className="side left">
					{view != 'chat' ? (
						<Icon name="common/back" withBackground={true} tooltipParam={{ text: translate('agentBack') }} onClick={() => setView('chat')} />
					) : ''}
					<Label text={titles[view]} />
				</div>
				<div className="side right">
					<Icon
						name="common/edit" withBackground={true}
						tooltipParam={{ text: translate('agentNewChat') }}
						onClick={onNewChat}
					/>
					<Icon
						name="common/clock" withBackground={true}
						className={view == 'history' ? 'active' : ''}
						tooltipParam={{ text: translate('agentHistory') }}
						onClick={() => setView(view == 'history' ? 'chat' : 'history')}
					/>
					<Icon
						name="header/settings" withBackground={true}
						className={view == 'settings' ? 'active' : ''}
						tooltipParam={{ text: translate('agentSettingsTitle') }}
						onClick={() => setView(view == 'settings' ? 'chat' : 'settings')}
					/>
					<Icon
						name="common/close" withBackground={true}
						onClick={() => sidebar.rightPanelClose(isPopup, true)}
					/>
				</div>
			</div>

			{body}
		</>
	);

});

export default SidebarPageAgent;
