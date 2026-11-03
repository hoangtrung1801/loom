import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Label, Icon, Button } from 'Component';
import type { AgentPart, AgentChatMessage } from 'Store/agent';
import { parseAgentMarkdown, type AgentInline } from 'Lib/agentMarkdown';
import { AGENT_NAME } from 'Lib/lo';

type ToolPart = Extract<AgentPart, { type: 'tool' }>;

/** Enter animation of a new message: a short rise and fade, eased out. */
export const MESSAGE_MOTION = {
	initial: { opacity: 0, y: 8 },
	animate: { opacity: 1, y: 0 },
	transition: { duration: 0.24, ease: [ 0.22, 1, 0.36, 1 ] as const },
};

/** Upper-cases only the first letter, keeping camelCase keys such as providerKey intact. */
export const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** The plain text of a message, for copying. */
export const messageText = (message: AgentChatMessage): string => message.parts.map(it => (it.type == 'text' ? it.text : '')).join('').trim();

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

const Markdown = ({ text, isStreaming }: { text: string; isStreaming: boolean }) => {
	const cn = [ 'markdown', (isStreaming ? 'isStreaming' : '') ];

	return (
		<div className={cn.join(' ')}>
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
};

/** Three dots that bounce in turn while Lo has not written anything yet. */
export const TypingDots = () => (
	<div className="typing" aria-label={translate('agentWorking')}>
		<span />
		<span />
		<span />
	</div>
);

/** Lo's avatar and name above its answers. */
export const AgentAuthor = () => (
	<div className="author">
		<div className="loAvatar" />
		<Label className="name" text={AGENT_NAME} />
	</div>
);

/** A user message, with each @-referenced object shown as a link that opens it. */
export const UserMessage = ({ message }: { message: AgentChatMessage }) => {
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

	return (
		<div className="message user">
			<div className="bubble">{out}</div>
		</div>
	);
};

const ToolRow = ({ part }: { part: ToolPart }) => {
	const cn = [ 'tool', part.status ];

	let statusIcon = null;
	switch (part.status) {
		case 'running': statusIcon = <span className="spinner" />; break;
		case 'done': statusIcon = <Icon className="statusIcon" name="common/tick" />; break;
		case 'error': statusIcon = <Icon className="statusIcon" name="common/alert" />; break;
		default: statusIcon = <span className="dot" />; break;
	};

	return (
		<div className={cn.join(' ')}>
			<div className="line">
				{statusIcon}
				<Label className="name" text={part.label} />
				{(part.status != 'done') ? <Label className="state" text={translate(`agentTool${cap(part.status)}`)} /> : ''}
			</div>

			<AnimatePresence initial={false}>
				{(part.status == 'approval') ? (
					<motion.div
						key="approval"
						className="approval"
						initial={{ height: 0, opacity: 0 }}
						animate={{ height: 'auto', opacity: 1 }}
						exit={{ height: 0, opacity: 0 }}
						transition={{ duration: 0.2, ease: 'easeOut' }}
					>
						<pre className="args">{JSON.stringify(part.args, null, 2)}</pre>
						<div className="buttons">
							<Button text={translate('agentApprove')} color="accent" className="c28" onClick={() => S.Agent.approve(part.callId, true)} />
							<Button text={translate('agentDeny')} color="blank" className="c28" onClick={() => S.Agent.approve(part.callId, false)} />
						</div>
					</motion.div>
				) : null}
			</AnimatePresence>

			{(part.status == 'error') && part.result ? <div className="result">{part.result}</div> : ''}
		</div>
	);
};

interface AssistantProps {
	message: AgentChatMessage;
	/** This is the answer being written: show the caret, or the typing dots before any text. */
	isStreaming: boolean;
};

export const AssistantMessage = ({ message, isStreaming }: AssistantProps) => {
	const text = messageText(message);
	const lastTextIndex = message.parts.map(it => it.type).lastIndexOf('text');
	const lastIsText = lastTextIndex == (message.parts.length - 1);
	const hasRunningTool = message.parts.some(it => (it.type == 'tool') && (it.status == 'running'));
	const cn = [ 'message', 'assistant', (isStreaming ? 'isStreaming' : '') ];

	return (
		<div className={cn.join(' ')}>
			<AgentAuthor />
			<div className="content">
				{message.parts.map((part, i) => (part.type == 'tool') ? (
					<ToolRow key={part.callId} part={part} />
				) : (
					<Markdown key={i} text={part.text} isStreaming={isStreaming && (i == lastTextIndex) && lastIsText} />
				))}
				{isStreaming && !lastIsText && !hasRunningTool ? <TypingDots /> : ''}
			</div>
			{!isStreaming && text ? (
				<div className="actions">
					<Icon
						className="copy"
						name="menu/action/copy"
						withBackground={true}
						tooltipParam={{ text: translate('agentCopy') }}
						onClick={() => U.Common.copyToast(translate('agentMessage'), text)}
					/>
				</div>
			) : ''}
		</div>
	);
};
