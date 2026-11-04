import React, { forwardRef, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, MotionConfig } from 'motion/react';
import { Label, Icon, Button, Input, Switch, Loader } from 'Component';
import * as I from 'Interface';
import type { AgentChatMessage } from 'Store/agent';
import AgentComposer, { type AgentComposerRef } from './composer';
import { AGENT_COMMANDS, type AgentCommand } from './commands';
import { AssistantMessage, AgentAuthor, MESSAGE_MOTION, TypingDots, UserMessage, cap } from './message';

type View = 'chat' | 'history' | 'settings';

/** How close to the bottom (px) still counts as "at the bottom": the chat follows new text there. */
const STICK_DISTANCE = 48;
const SUGGESTIONS = AGENT_COMMANDS.filter(it => it.kind == 'prompt');

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
	const [ isEmpty, setIsEmpty ] = useState(true);
	const [ showScrollDown, setShowScrollDown ] = useState(false);
	const stickRef = useRef(true);
	const countRef = useRef(0);
	const isRunning = chat.status == 'running';
	const lastMessage = chat.messages.length ? chat.messages[chat.messages.length - 1] : null;
	const lastText = lastMessage ? JSON.stringify(lastMessage.parts) : '';

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

	// A different chat or view starts at the bottom, without animation
	useEffect(() => {
		stickRef.current = true;
		countRef.current = chat.messages.length;
		setShowScrollDown(false);
		scrollToBottom(false);
	}, [ chatId, view, chat.loading ]);

	// New messages glide into view; streamed text follows instantly, so it never lags behind.
	// Neither happens while the user has scrolled up to read.
	useEffect(() => {
		const isNew = chat.messages.length > countRef.current;
		const isOwn = isNew && (lastMessage?.role == 'user');

		countRef.current = chat.messages.length;

		if (isOwn) {
			stickRef.current = true;
		};
		if (stickRef.current) {
			scrollToBottom(isNew);
		};
	}, [ chat.messages.length, lastText, chat.error, isRunning ]);

	const scrollToBottom = (smooth: boolean) => {
		const node = bodyRef.current;
		if (node) {
			node.scrollTo({ top: node.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
		};
	};

	const onScroll = () => {
		const node = bodyRef.current;
		if (!node) {
			return;
		};

		const atBottom = (node.scrollHeight - node.scrollTop - node.clientHeight) < STICK_DISTANCE;

		stickRef.current = atBottom;
		setShowScrollDown(!atBottom);
	};

	const onScrollDown = () => {
		stickRef.current = true;
		setShowScrollDown(false);
		scrollToBottom(true);
	};

	const onSend = () => {
		if (isRunning && isEmpty) {
			S.Agent.stop();
			return;
		};

		composerRef.current?.send();
	};

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

	const renderMessage = (message: AgentChatMessage) => {
		const isStreaming = isRunning && (message.id == lastMessage?.id);

		return (
			<motion.div key={message.id} className="messageWrap" {...MESSAGE_MOTION}>
				{(message.role == 'user') ? <UserMessage message={message} /> : <AssistantMessage message={message} isStreaming={isStreaming} />}
			</motion.div>
		);
	};

	const renderError = () => {
		if (!chat.error) {
			return null;
		};

		return (
			<motion.div key="error" className="error" {...MESSAGE_MOTION}>
				<Icon className="statusIcon" name="common/alert" />
				<div className="info">
					<Label text={translate(`agentError${cap(chat.error)}`)} />
					{chat.errorDetail ? <Label className="detail" text={chat.errorDetail} /> : ''}
					{[ 'providerKey', 'model', 'baseUrl' ].includes(chat.error) ? (
						<Button text={translate('agentOpenSettings')} color="blank" className="c28" onClick={() => setView('settings')} />
					) : ''}
				</div>
			</motion.div>
		);
	};

	const renderEmpty = () => (
		<div className="empty">
			<motion.div className="hero" {...MESSAGE_MOTION}>
				<div className="loAvatar big" />
				<Label className="title" text={translate('agentEmptyTitle')} />
				<Label className="text" text={translate('agentEmptyText')} />
			</motion.div>
			<div className="suggestions">
				{SUGGESTIONS.map((it, i) => (
					<motion.div
						key={it.id}
						className="suggestion"
						initial={{ opacity: 0, y: 6 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ ...MESSAGE_MOTION.transition, delay: 0.06 + i * 0.04 }}
						onClick={() => composerRef.current?.setText(translate(it.promptKey))}
					>
						<Label text={translate(it.nameKey)} />
						<Label className="caption" text={`/${it.id}`} />
					</motion.div>
				))}
			</div>
		</div>
	);

	const renderChat = () => {
		const waitingForStart = isRunning && (lastMessage?.role == 'user');
		const cnSend = [ 'sendButton', (isRunning && isEmpty ? 'isStop' : ''), (!isRunning && isEmpty ? 'isDisabled' : '') ];

		let content = null;
		if (chat.loading) {
			content = <Loader />;
		} else
		if (!chat.messages.length) {
			content = renderEmpty();
		} else {
			// Keyed by chat, so opening another session shows its messages without replaying the animation
			content = (
				<div key={chatId} className="messages">
					<AnimatePresence initial={false}>
						{chat.messages.map(renderMessage)}
						{waitingForStart ? (
							<motion.div key="waiting" className="messageWrap" {...MESSAGE_MOTION}>
								<div className="message assistant isStreaming">
									<AgentAuthor />
									<div className="content"><TypingDots /></div>
								</div>
							</motion.div>
						) : null}
						{renderError()}
					</AnimatePresence>
				</div>
			);
		};

		return (
			<>
				<div className="chatWrap">
					<div id="body" className="body" ref={bodyRef} onScroll={onScroll}>
						{content}
					</div>

					<AnimatePresence>
						{showScrollDown ? (
							<motion.div
								key="scrollDown"
								className="scrollDown"
								initial={{ opacity: 0, scale: 0.8 }}
								animate={{ opacity: 1, scale: 1 }}
								exit={{ opacity: 0, scale: 0.8 }}
								transition={{ duration: 0.15 }}
								onClick={onScrollDown}
							>
								<Icon name="chat/navigation/arrow" tooltipParam={{ text: translate('agentScrollDown') }} />
							</motion.div>
						) : null}
					</AnimatePresence>
				</div>

				<div className="composer">
					<div className="composerBox">
						<AgentComposer
							ref={composerRef}
							placeholder={translate('agentPlaceholder')}
							onSend={(text, mentions) => S.Agent.send(text, mentions)}
							onAction={onAction}
							onEmptyChange={setIsEmpty}
						/>
						<div
							className={cnSend.join(' ')}
							onClick={onSend}
						>
							<AnimatePresence initial={false} mode="popLayout">
								{(isRunning && isEmpty) ? (
									<motion.span key="stop" className="stopSquare" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }} transition={{ duration: 0.15 }} />
								) : (
									<motion.span key="send" className="sendIcon" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }} transition={{ duration: 0.15 }}>
										<Icon name="chat/buttons/send" />
									</motion.span>
								)}
							</AnimatePresence>
						</div>
					</div>
					<Label className="hint" text={translate(isRunning ? 'agentComposerHintRunning' : 'agentComposerHint')} />
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

	const cnView = [ 'view', view ];

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

			<MotionConfig reducedMotion="user">
				<AnimatePresence mode="wait" initial={false}>
					<motion.div
						key={view}
						className={cnView.join(' ')}
						initial={{ opacity: 0, x: (view == 'chat') ? -8 : 8 }}
						animate={{ opacity: 1, x: 0 }}
						exit={{ opacity: 0 }}
						transition={{ duration: 0.16, ease: 'easeOut' }}
					>
						{body}
					</motion.div>
				</AnimatePresence>
			</MotionConfig>
		</>
	);

});

export default SidebarPageAgent;
