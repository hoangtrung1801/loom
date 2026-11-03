import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import raf from 'raf';
import { Editable } from 'Component';
import * as I from 'Interface';
import type { AgentMention } from 'Store/agent';
import { AgentCommand, commandQuery, matchCommands } from './commands';

interface Props {
	placeholder: string;
	onSend: (text: string, mentions: AgentMention[]) => void;
	/** Runs an action command (/new, /history...). Prompt commands are handled here. */
	onAction: (command: AgentCommand) => void;
};

export interface AgentComposerRef {
	send: () => void;
	focus: () => void;
};

const ID = 'agentComposer';
const MENU_MENTION = 'blockMention';
const MENU_COMMAND = 'select';
/** Wide enough for the longest command name next to its /name. */
const COMMAND_MENU_WIDTH = 300;
/** Characters after which a typed @ opens the mention menu (start of input, space, brackets...). */
const MENTION_BOUNDARY = [ ' ', '\n', '(', '[', '"', '\'' ];

/**
 * The agent's message input. "@" opens the editor's mention menu (blockMention) and inserts the
 * object as a mention mark; "/" at the start opens the command menu.
 */
const AgentComposer = forwardRef<AgentComposerRef, Props>((props, ref) => {

	const { placeholder, onSend, onAction } = props;
	const editableRef = useRef(null);
	const range = useRef<I.TextRange>({ from: 0, to: 0 });
	const marks = useRef<I.Mark[]>([]);
	/** Type names of mentioned objects, sent to the agent with the mention. */
	const typeNames = useRef<Map<string, string>>(new Map());
	const timeoutFilter = useRef(0);

	const getValue = (): string => String(editableRef.current?.getTextValue() || '');

	const setValue = (text: string, newMarks: I.Mark[], newRange: I.TextRange) => {
		const editable = editableRef.current;
		if (!editable) {
			return;
		};

		marks.current = Mark.checkRanges(text, newMarks);
		range.current = newRange;

		editable.setValue(Mark.toHtml(text, marks.current));
		editable.placeholderCheck();
		editable.setRange(newRange);
	};

	/** Reads text and marks back from the DOM after the user typed. */
	const syncFromDom = () => {
		const editable = editableRef.current;
		if (!editable) {
			return;
		};

		const parsed = Mark.fromHtml(editable.getHtmlValue(), []);

		range.current = editable.getRange() || range.current;
		marks.current = Mark.checkRanges(parsed.text, parsed.marks);
	};

	const menuParam = () => ({
		element: `#${ID}`,
		className: 'fixed',
		classNameWrap: 'fromSidebar',
		recalcRect: () => {
			const rect = U.Dom.getSelectionRect();
			return rect ? { ...rect, y: rect.y + window.scrollY } : null;
		},
		vertical: I.MenuDirection.Top,
		horizontal: I.MenuDirection.Left,
		offsetY: -8,
		noFlipX: true,
		onClose: () => editableRef.current?.setRange(range.current),
	});

	const openMention = () => {
		const caret = range.current.from;
		const from = caret - 1;
		// The menu inserts the object name where the @ was, into the text without it
		const value = U.String.cut(getValue(), from, caret);
		const baseMarks = Mark.adjust(U.Common.objectCopy(marks.current), from, -1);

		S.Common.filterSet(from, '');

		raf(() => {
			S.Menu.open(MENU_MENTION, {
				...menuParam(),
				data: {
					rootId: '',
					blockId: '',
					marks: baseMarks,
					onChange: (object: any, text: string, newMarks: I.Mark[], at: number, to: number) => {
						if (S.Menu.isAnimating(MENU_MENTION)) {
							return;
						};

						const type = object.type ? S.Record.getTypeById(object.type) : null;
						if (type?.name) {
							typeNames.current.set(object.id, type.name);
						};

						setValue(U.String.insert(value, text, at, at), newMarks, { from: to, to });
					},
				},
			});
		});
	};

	const commandOptions = (query: string) => matchCommands(query).map(it => ({
		id: it.id,
		name: translate(it.nameKey),
		caption: `/${it.id}`,
		command: it,
	}));

	const openCommands = (query: string) => {
		S.Menu.open(MENU_COMMAND, {
			...menuParam(),
			width: COMMAND_MENU_WIDTH,
			data: {
				options: commandOptions(query),
				noFilter: true,
				noClose: false,
				onSelect: (e: any, item: any) => runCommand(item.command),
			},
		});
	};

	const runCommand = (command: AgentCommand) => {
		S.Menu.close(MENU_COMMAND);

		if (command.kind == 'prompt') {
			const text = translate(command.promptKey);

			setValue(text, [], { from: text.length, to: text.length });
			editableRef.current?.setFocus();
			return;
		};

		setValue('', [], { from: 0, to: 0 });
		onAction(command);
	};

	const onKeyDown = (e: any) => {
		const hasMenu = S.Menu.isOpen(MENU_MENTION) || S.Menu.isOpen(MENU_COMMAND);

		// While a menu is open, Enter and the arrows belong to it
		if (hasMenu && [ 'Enter', 'ArrowUp', 'ArrowDown', 'Tab' ].includes(e.key)) {
			e.preventDefault();
			return;
		};

		if ((e.key == 'Enter') && !e.nativeEvent?.isComposing) {
			e.preventDefault();

			if (e.shiftKey) {
				insertText('\n');
			} else {
				send();
			};
		};
	};

	const onKeyUp = (e: any) => {
		syncFromDom();

		const value = getValue();
		const caret = range.current.from;
		const { filter } = S.Common;

		if (S.Menu.isOpen(MENU_MENTION)) {
			window.clearTimeout(timeoutFilter.current);
			timeoutFilter.current = window.setTimeout(() => {
				// Deleting the @ or moving the caret before it ends the mention
				if ((caret <= filter.from) || (value[filter.from] != '@')) {
					S.Menu.close(MENU_MENTION);
					return;
				};
				S.Common.filterSetText(value.substring(filter.from + 1, caret));
			}, 30);
			return;
		};

		const query = commandQuery(value, caret);

		if (S.Menu.isOpen(MENU_COMMAND)) {
			const options = (query === null) ? [] : commandOptions(query);

			if (!options.length) {
				S.Menu.close(MENU_COMMAND);
			} else {
				S.Menu.updateData(MENU_COMMAND, { options });
			};
			return;
		};

		if ((e.key == '@') || (value[caret - 1] == '@')) {
			const before = value[caret - 2];
			if ((value[caret - 1] == '@') && (!before || MENTION_BOUNDARY.includes(before))) {
				openMention();
			};
			return;
		};

		if ((query !== null) && (e.key == '/')) {
			openCommands(query);
		};
	};

	/** Replaces the selection with plain text, keeping the marks around it in place. */
	const insertText = (text: string) => {
		syncFromDom();

		const { from, to } = range.current;
		const value = getValue();
		const next = value.slice(0, from) + text + value.slice(to);
		const newMarks = Mark.adjustForReplace(U.Common.objectCopy(marks.current), from, to, text.length);
		const caret = from + text.length;

		setValue(next, newMarks, { from: caret, to: caret });
	};

	const onPaste = (e: any) => {
		e.preventDefault();
		insertText(String(e.clipboardData?.getData('text/plain') || '').replace(/\r\n?/g, '\n'));
	};

	const send = () => {
		syncFromDom();

		const text = getValue();
		if (!text.trim()) {
			return;
		};

		const mentions: AgentMention[] = marks.current
			.filter(it => (it.type == I.MarkType.Mention) && it.param)
			.map(it => ({
				id: it.param,
				name: text.slice(it.range.from, it.range.to),
				from: it.range.from,
				to: it.range.to,
				type: typeNames.current.get(it.param),
			}));

		setValue('', [], { from: 0, to: 0 });
		onSend(text, mentions);
	};

	useImperativeHandle(ref, () => ({
		send,
		focus: () => editableRef.current?.setFocus(),
	}));

	return (
		<div id={ID} className="composerInput">
			<Editable
				ref={editableRef}
				placeholder={placeholder}
				onKeyDown={onKeyDown}
				onKeyUp={onKeyUp}
				onPaste={onPaste}
				onMouseUp={syncFromDom}
			/>
		</div>
	);

});

export default AgentComposer;
