import React, { forwardRef, useEffect, useRef, useState } from 'react';
import { Label, Icon, Button, Input, Switch, Textarea } from 'Component';
import * as I from 'Interface';
import type { AgentPart, AgentChatMessage } from 'Store/agent';
import { parseAgentMarkdown, type AgentInline } from 'Lib/agentMarkdown';

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

const SidebarPageAgent = forwardRef<{}, I.SidebarPageComponent>((props, ref: any) => {

	const { isPopup } = props;
	const spaceId = S.Common.space;
	const chatId = S.Agent.chatId(spaceId);
	const chat = S.Agent.getChat(chatId);
	const status = S.Agent.status;
	const [ isSettings, setIsSettings ] = useState(false);
	const [ keyDraft, setKeyDraft ] = useState('');
	const bodyRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef(null);
	const isRunning = chat.status == 'running';
	const lastText = chat.messages.length ? JSON.stringify(chat.messages[chat.messages.length - 1].parts) : '';

	useEffect(() => {
		S.Agent.loadStatus();
	}, []);

	useEffect(() => {
		const node = bodyRef.current;
		if (node) {
			node.scrollTop = node.scrollHeight;
		};
	}, [ chat.messages.length, lastText, chat.error ]);

	const onSend = () => {
		const value = inputRef.current?.getValue() || '';
		if (!value.trim()) {
			return;
		};

		inputRef.current.setValue('');
		S.Agent.send(value);
	};

	const onKeyDown = (e: any) => {
		if ((e.key == 'Enter') && !e.shiftKey && !e.nativeEvent?.isComposing) {
			e.preventDefault();
			onSend();
		};
	};

	const onReset = () => {
		S.Agent.reset();
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

		return (
			<div key={message.id} className={cn.join(' ')}>
				{message.parts.map((part, i) => {
					if (part.type == 'tool') {
						return renderTool(part);
					};
					return message.role == 'user' ? <div key={i} className="text">{part.text}</div> : <Markdown key={i} text={part.text} />;
				})}
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
					<Button text={translate('agentOpenSettings')} color="blank" className="c28" onClick={() => setIsSettings(true)} />
				) : ''}
			</div>
		);
	};

	const renderChat = () => (
		<>
			<div id="body" className="body" ref={bodyRef}>
				{!chat.messages.length ? (
					<div className="empty">
						<Icon className="sparkle" name="header/agent" />
						<Label className="title" text={translate('agentEmptyTitle')} />
						<Label className="text" text={translate('agentEmptyText')} />
					</div>
				) : chat.messages.map(renderMessage)}
				{isRunning ? <Label className="working" text={translate('agentWorking')} /> : ''}
				{renderError()}
			</div>

			<div className="footer">
				<Textarea
					ref={inputRef}
					rows={2}
					placeholder={translate('agentPlaceholder')}
					onKeyDown={onKeyDown}
				/>
				<div className="buttons">
					{isRunning ? <Button text={translate('agentStop')} color="blank" className="c28" onClick={() => S.Agent.stop()} /> : ''}
					<Button text={translate('agentSend')} color="accent" className="c28" onClick={onSend} />
				</div>
			</div>
		</>
	);

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
				{items.map(it => (
					<div key={it.id} className={[ 'choice', (it.id == value ? 'active' : '') ].join(' ')} onClick={() => S.Agent.setConfig({ [key]: it.id })}>
						{it.name}
					</div>
				))}
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

	return (
		<>
			<div id="head" className="head">
				<div className="side left">
					<Label text={translate(isSettings ? 'agentSettingsTitle' : 'agentTitle')} />
				</div>
				<div className="side right">
					{!isSettings ? (
						<Icon
							name="common/edit" withBackground={true}
							tooltipParam={{ text: translate('agentNewChat') }}
							onClick={onReset}
						/>
					) : ''}
					<Icon
						name="header/settings" withBackground={true}
						className={isSettings ? 'active' : ''}
						tooltipParam={{ text: translate('agentSettingsTitle') }}
						onClick={() => setIsSettings(!isSettings)}
					/>
					<Icon
						name="common/close" withBackground={true}
						onClick={() => sidebar.rightPanelClose(isPopup, true)}
					/>
				</div>
			</div>

			{isSettings ? renderSettings() : renderChat()}
		</>
	);

});

export default SidebarPageAgent;
