import { baseKeymap, chainCommands, exitCode, setBlockType, toggleMark, wrapIn } from 'prosemirror-commands';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { history, redo, undo } from 'prosemirror-history';
import { InputRule, inputRules, textblockTypeInputRule, wrappingInputRule } from 'prosemirror-inputrules';
import { keymap } from 'prosemirror-keymap';
import { Fragment, Slice, type MarkType, type Node as PmNode } from 'prosemirror-model';
import { liftListItem, sinkListItem, splitListItem, wrapInList } from 'prosemirror-schema-list';
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from 'prosemirror-state';
import { columnResizing, goToNextCell, tableEditing } from 'prosemirror-tables';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import { newBlockId, WIKILINK } from '../../core/doc.js';
import { markdownToDoc } from '../../core/markdown.js';
import { editorEnv } from './env.js';
import { ID_BLOCKS, schema } from './schema.js';

// ---------------------------------------------------------------- block ids

const idTypes = new Set<string>(ID_BLOCKS);

/** Gives every block a unique, stable id. Splitting a block copies its attrs, so duplicates are re-issued here. */
function blockIdPlugin(): Plugin {
  return new Plugin({
    appendTransaction(trs, _old, state) {
      if (!trs.some((t) => t.docChanged)) return null;
      const seen = new Set<string>();
      let tr: Transaction | null = null;
      state.doc.descendants((node, pos) => {
        if (!idTypes.has(node.type.name)) return;
        const id = node.attrs.id as string | null;
        if (id && !seen.has(id)) {
          seen.add(id);
          return;
        }
        tr ??= state.tr.setMeta('addToHistory', false);
        const fresh = newBlockId();
        seen.add(fresh);
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, id: fresh });
      });
      return tr;
    },
  });
}

// -------------------------------------------------------------- decorations

/** Exposes block ids in the DOM so the table of contents and citations can scroll to a block. */
function blockAttrsPlugin(): Plugin {
  return new Plugin({
    props: {
      decorations(state: EditorState) {
        const decorations: Decoration[] = [];
        state.doc.descendants((node, pos) => {
          const id = node.attrs.id as string | null | undefined;
          if (id && idTypes.has(node.type.name)) decorations.push(Decoration.node(pos, pos + node.nodeSize, { 'data-block-id': id }));
        });
        return DecorationSet.create(state.doc, decorations);
      },
    },
  });
}

/** Highlights [[Card title]] text; clicks are handled by the Editor via `data-wikilink`. */
function wikilinkPlugin(): Plugin {
  return new Plugin({
    props: {
      decorations(state: EditorState) {
        const decorations: Decoration[] = [];
        state.doc.descendants((node, pos) => {
          if (!node.isText || node.marks.some((m) => m.type.name === 'code')) return;
          for (const m of node.text!.matchAll(WIKILINK)) {
            const from = pos + m.index!;
            decorations.push(Decoration.inline(from, from + m[0].length, { class: 'wikilink', 'data-wikilink': m[1]!.trim() }));
          }
        });
        return DecorationSet.create(state.doc, decorations);
      },
    },
  });
}

/** Marks the lone empty paragraph so CSS can show placeholder text on it. */
function placeholderPlugin(text: string): Plugin {
  return new Plugin({
    props: {
      decorations({ doc }: EditorState) {
        const first = doc.firstChild;
        if (doc.childCount !== 1 || !first?.isTextblock || first.content.size > 0 || first.type.name !== 'paragraph') return null;
        return DecorationSet.create(doc, [Decoration.node(0, first.nodeSize, { class: 'is-empty', 'data-placeholder': text })]);
      },
    },
  });
}

// ------------------------------------------------------------ suggestions

export interface SuggestState {
  kind: 'slash' | 'mention';
  /** Document range to replace when an item is chosen (includes the trigger). */
  from: number;
  to: number;
  query: string;
  /** Viewport rect of the caret, for positioning the menu. */
  rect: { left: number; bottom: number; top: number };
}
export interface SuggestHandlers {
  onState(state: SuggestState | null): void;
  /** Return true when the menu consumed the key. */
  onKey(event: KeyboardEvent): boolean;
}

const TRIGGERS: { kind: SuggestState['kind']; re: RegExp }[] = [
  { kind: 'slash', re: /(?:^|\s)(\/[\p{L}\p{N}-]{0,20})$/u },
  { kind: 'mention', re: /(?:^|\s)(@[^\s@]{0,40})$/u },
  { kind: 'mention', re: /(\[\[[^\]\n]{0,60})$/ },
];

function suggestPlugin(handlers: () => SuggestHandlers): Plugin<SuggestState | null> {
  const key = new PluginKey<SuggestState | null>('suggest');
  const find = (state: EditorState): Omit<SuggestState, 'rect'> | null => {
    const { selection } = state;
    if (!selection.empty || !selection.$from.parent.isTextblock || selection.$from.parent.type.spec.code) return null;
    const before = selection.$from.parent.textBetween(0, selection.$from.parentOffset, undefined, '￼');
    for (const t of TRIGGERS) {
      const m = t.re.exec(before);
      if (!m) continue;
      const typed = m[1]!;
      const to = selection.from;
      return { kind: t.kind, from: to - typed.length, to, query: typed.replace(/^(\[\[|[/@])/, '') };
    }
    return null;
  };
  return new Plugin<SuggestState | null>({
    key,
    state: {
      init: () => null,
      apply(tr, prev, _old, state) {
        if (tr.getMeta(key) === 'dismiss') return null;
        const found = find(state);
        // After Escape the same trigger stays dismissed until the text changes.
        if (prev === null && !tr.docChanged && !tr.selectionSet) return null;
        return found ? ({ ...found, rect: { left: 0, bottom: 0, top: 0 } } as SuggestState) : null;
      },
    },
    view: () => ({
      update(view) {
        const s = key.getState(view.state);
        if (!s) return handlers().onState(null);
        const c = view.coordsAtPos(s.to);
        handlers().onState({ ...s, rect: { left: c.left, bottom: c.bottom, top: c.top } });
      },
      destroy: () => handlers().onState(null),
    }),
    props: {
      handleKeyDown(view, event) {
        if (!key.getState(view.state)) return false;
        if (event.key === 'Escape') {
          view.dispatch(view.state.tr.setMeta(key, 'dismiss'));
          return true;
        }
        return handlers().onKey(event);
      },
    },
  });
}

// ------------------------------------------------------------- input rules

function markRule(re: RegExp, mark: MarkType, attrs?: Record<string, unknown>): InputRule {
  return new InputRule(re, (state, match, start, end) => {
    const inner = match[1]!;
    const tr = state.tr;
    tr.delete(start, end);
    tr.insertText(inner, start);
    tr.addMark(start, start + inner.length, mark.create(attrs));
    tr.removeStoredMark(mark);
    return tr;
  });
}

/** Swaps the textblock that contains `pos` for whole blocks (a rule can't put a block inside a paragraph). */
function replaceBlock(state: EditorState, pos: number, blocks: PmNode[]): Transaction {
  const $pos = state.doc.resolve(pos);
  return state.tr.replaceWith($pos.before(), $pos.after(), blocks);
}

function buildRules(): InputRule[] {
  const n = schema.nodes;
  const m = schema.marks;
  return [
    new InputRule(/^(#{1,3})\s$/, (state, match, start, end) => state.tr.delete(start, end).setBlockType(start, start, n.heading!, { level: match[1]!.length })),
    wrappingInputRule(/^\s*>\s$/, n.blockquote!),
    new InputRule(/^```([\w+#-]*)\s$/, (state, match, start, end) => state.tr.delete(start, end).setBlockType(start, start, n.code_block!, { language: match[1] ?? '' })),
    wrappingInputRule(/^\s*([-+*])\s$/, n.bullet_list!),
    wrappingInputRule(/^(\d+)\.\s$/, n.ordered_list!, (mm) => ({ order: +mm[1]! }), (mm, node) => node.childCount + (node.attrs.order as number) === +mm[1]!),
    wrappingInputRule(/^\s*\[\s?\]\s$/, n.todo_list!),
    new InputRule(/^(?:---|___)\s$/, (state, _m, start) => replaceBlock(state, start, [n.horizontal_rule!.create(), n.paragraph!.create()])),
    new InputRule(/^\$\$\s$/, (state, _m, start) => replaceBlock(state, start, [n.math_block!.create({ latex: '' }), n.paragraph!.create()])),
    new InputRule(/(?<![\w$])\$([^$\s](?:[^$]*[^$\s])?)\$$/, (state, match, start, end) => state.tr.replaceWith(start, end, n.math_inline!.create({ latex: match[1]! }))),
    markRule(/(?<![*\w])\*\*([^*\s][^*]*?)\*\*$/, m.strong!),
    markRule(/(?<![*\w])\*([^*\s][^*]*?)\*$/, m.em!),
    markRule(/(?<!`)`([^`]+)`$/, m.code!),
    markRule(/~~([^~\s][^~]*?)~~$/, m.strike!),
    markRule(/==([^=\s][^=]*?)==$/, m.highlight!),
  ];
}

// ----------------------------------------------------------------- commands

function inTable(state: EditorState): boolean {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === 'table_cell' || $from.node(d).type.name === 'table_header') return true;
  return false;
}

const hardBreak = chainCommands(exitCode, (state, dispatch) => {
  dispatch?.(state.tr.replaceSelectionWith(schema.nodes.hard_break!.create()).scrollIntoView());
  return true;
});

/** Pasted plain text that looks like markdown becomes structured content instead of one long paragraph. */
const MARKDOWN_HINT = /^(\s{0,3}(#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s|```|\|.*\|)|.*\*\*[^*]+\*\*|.*\[[^\]]+\]\([^)]+\))/m;

function pasteMarkdown(view: EditorView, text: string): boolean {
  if (!MARKDOWN_HINT.test(text)) return false;
  try {
    const doc = schema.nodeFromJSON(markdownToDoc(text));
    const slice = new Slice(Fragment.from(doc.content), 0, 0);
    view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
    return true;
  } catch {
    return false;
  }
}

/** Uploads dropped or pasted files and inserts the matching block (image, audio, video or generic file). */
export async function insertFiles(view: EditorView, files: File[], at?: number): Promise<void> {
  const nodes: PmNode[] = [];
  for (const file of files) {
    try {
      const fileId = await editorEnv.upload(file);
      const type = file.type.startsWith('image/') ? 'image' : file.type.startsWith('audio/') ? 'audio' : file.type.startsWith('video/') ? 'video' : 'file_block';
      nodes.push(schema.nodes[type]!.create({ fileId, name: file.name }));
    } catch (err) {
      editorEnv.toast(err instanceof Error ? err.message : String(err));
    }
  }
  if (!nodes.length || !view.dom.isConnected) return;
  const pos = at ?? view.state.selection.to;
  const $pos = view.state.doc.resolve(Math.min(pos, view.state.doc.content.size));
  const insertAt = $pos.parent.isTextblock && $pos.parent.content.size === 0 ? $pos.before() : $pos.after($pos.depth > 0 ? 1 : 0);
  view.dispatch(view.state.tr.insert(Math.min(insertAt, view.state.doc.content.size), nodes).scrollIntoView());
}

export function buildPlugins(placeholder: string, handlers: () => SuggestHandlers): Plugin[] {
  const n = schema.nodes;
  const m = schema.marks;
  return [
    history(),
    inputRules({ rules: buildRules() }),
    keymap({
      'Mod-z': undo,
      'Mod-y': redo,
      'Shift-Mod-z': redo,
      'Mod-b': toggleMark(m.strong!),
      'Mod-i': toggleMark(m.em!),
      'Mod-u': toggleMark(m.underline!),
      'Shift-Mod-s': toggleMark(m.strike!),
      'Mod-e': toggleMark(m.code!),
      'Shift-Mod-h': toggleMark(m.highlight!, { color: 'yellow' }),
      'Mod-Alt-0': setBlockType(n.paragraph!),
      'Mod-Alt-1': setBlockType(n.heading!, { level: 1 }),
      'Mod-Alt-2': setBlockType(n.heading!, { level: 2 }),
      'Mod-Alt-3': setBlockType(n.heading!, { level: 3 }),
      'Mod-Shift-8': wrapInList(n.bullet_list!),
      'Mod-Shift-9': wrapInList(n.ordered_list!),
      'Mod-Shift-7': wrapInList(n.todo_list!),
      'Mod-Shift-.': wrapIn(n.blockquote!),
      Enter: chainCommands(splitListItem(n.list_item!), splitListItem(n.todo_item!)),
      Tab: (state, dispatch, view) =>
        inTable(state) ? goToNextCell(1)(state, dispatch, view) : chainCommands(sinkListItem(n.list_item!), sinkListItem(n.todo_item!))(state, dispatch, view),
      'Shift-Tab': (state, dispatch, view) =>
        inTable(state) ? goToNextCell(-1)(state, dispatch, view) : chainCommands(liftListItem(n.list_item!), liftListItem(n.todo_item!))(state, dispatch, view),
      'Shift-Enter': hardBreak,
    }),
    suggestPlugin(handlers),
    keymap(baseKeymap),
    columnResizing(),
    tableEditing(),
    dropCursor(),
    gapCursor(),
    blockIdPlugin(),
    blockAttrsPlugin(),
    wikilinkPlugin(),
    placeholderPlugin(placeholder),
    new Plugin({
      props: {
        handlePaste(view, event) {
          const files = [...(event.clipboardData?.files ?? [])];
          if (files.length) {
            void insertFiles(view, files);
            return true;
          }
          const html = event.clipboardData?.getData('text/html');
          const text = event.clipboardData?.getData('text/plain');
          return !html && text ? pasteMarkdown(view, text) : false;
        },
        handleDrop(view, event) {
          const files = [...(event.dataTransfer?.files ?? [])];
          if (!files.length) return false;
          event.preventDefault();
          const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
          void insertFiles(view, files, at);
          return true;
        },
      },
    }),
  ];
}

export { TextSelection };
