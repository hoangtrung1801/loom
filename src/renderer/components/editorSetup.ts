import { baseKeymap, chainCommands, exitCode, setBlockType, toggleMark, wrapIn } from 'prosemirror-commands';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { history, redo, undo } from 'prosemirror-history';
import { InputRule, inputRules, textblockTypeInputRule, wrappingInputRule } from 'prosemirror-inputrules';
import { keymap } from 'prosemirror-keymap';
import { Schema, type DOMOutputSpec, type Node as PmNode } from 'prosemirror-model';
import { schema as basic } from 'prosemirror-schema-basic';
import { addListNodes, liftListItem, sinkListItem, splitListItem, wrapInList } from 'prosemirror-schema-list';
import { Plugin, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

/** Only these schemes may appear in rendered links; card content can arrive from other devices. */
export function safeHref(href: unknown): string | null {
  if (typeof href !== 'string') return null;
  try {
    const url = new URL(href);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

const marks = basic.spec.marks.update('link', {
  attrs: { href: {}, title: { default: null } },
  inclusive: false,
  parseDOM: [
    {
      tag: 'a[href]',
      getAttrs: (dom) => {
        const href = safeHref((dom as HTMLElement).getAttribute('href'));
        return href ? { href } : false;
      },
    },
  ],
  toDOM(mark): DOMOutputSpec {
    const href = safeHref(mark.attrs.href);
    return href ? ['a', { href, rel: 'noopener noreferrer', target: '_blank' }, 0] : ['span', 0];
  },
});

// No image node: remote images would let synced content ping arbitrary servers.
const nodes = addListNodes(basic.spec.nodes.remove('image'), 'paragraph block*', 'block');

export const schema = new Schema({ nodes, marks });

const WIKILINK = /\[\[([^\[\]\n]{1,200})\]\]/g;

/** Highlights [[Card title]] mentions; clicking one is handled by the Editor via `data-wikilink`. */
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

export function buildPlugins(placeholder: string): Plugin[] {
  const { heading, blockquote, code_block, bullet_list, ordered_list, list_item, hard_break, paragraph } = schema.nodes;
  const { strong, em, code } = schema.marks;
  const hardBreak = chainCommands(exitCode, (state, dispatch) => {
    dispatch?.(state.tr.replaceSelectionWith(hard_break!.create()).scrollIntoView());
    return true;
  });

  const rules = [
    new InputRule(/^(#{1,3})\s$/, (state, match, start, end) =>
      state.tr.delete(start, end).setBlockType(start, start, heading!, { level: match[1]!.length })),
    wrappingInputRule(/^\s*>\s$/, blockquote!),
    textblockTypeInputRule(/^```$/, code_block!),
    wrappingInputRule(/^\s*([-+*])\s$/, bullet_list!),
    wrappingInputRule(/^(\d+)\.\s$/, ordered_list!, (m) => ({ order: +m[1]! }), (m, node) => node.childCount + (node.attrs.order as number) === +m[1]!),
  ];

  return [
    history(),
    inputRules({ rules }),
    keymap({
      'Mod-z': undo,
      'Mod-y': redo,
      'Shift-Mod-z': redo,
      'Mod-b': toggleMark(strong!),
      'Mod-i': toggleMark(em!),
      'Mod-e': toggleMark(code!),
      'Mod-Alt-0': setBlockType(paragraph!),
      'Mod-Alt-1': setBlockType(heading!, { level: 1 }),
      'Mod-Alt-2': setBlockType(heading!, { level: 2 }),
      'Mod-Shift-8': wrapInList(bullet_list!),
      'Mod-Shift-9': wrapInList(ordered_list!),
      'Mod-Shift-.': wrapIn(blockquote!),
      Enter: splitListItem(list_item!),
      Tab: sinkListItem(list_item!),
      'Shift-Tab': liftListItem(list_item!),
      'Shift-Enter': hardBreak,
    }),
    keymap(baseKeymap),
    dropCursor(),
    gapCursor(),
    wikilinkPlugin(),
    placeholderPlugin(placeholder),
  ];
}

export function emptyDoc(): PmNode {
  return schema.topNodeType.createAndFill()!;
}

/** Parses stored JSON; returns null when the content can't be represented (so we never overwrite it). */
export function parseDoc(json: string): PmNode | null {
  if (!json) return emptyDoc();
  try {
    return schema.nodeFromJSON(JSON.parse(json));
  } catch {
    return null;
  }
}
