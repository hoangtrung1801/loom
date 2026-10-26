import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SlashMenu, MentionMenu, type MenuHandle } from './menus.js';
import { Toolbar } from './Toolbar.js';
import { filterSlash, insertMention, runSlash } from './commands.js';
import { editorEnv } from './env.js';
import { nodeViews } from './nodeviews.js';
import { buildPlugins, type SuggestState } from './plugins.js';
import { emptyDoc, parseDoc } from './schema.js';

interface Props {
  value: string;
  onChange(json: string): void;
  onOpenLink(title: string): void;
  autoFocus?: boolean;
  placeholder?: string;
  readOnly?: boolean;
  className?: string;
}

/**
 * ProseMirror owns the document while you type. `value` is only applied when it
 * differs from what this editor last produced, i.e. when another view of the same
 * card (or a sync) changed it.
 */
export function Editor({ value, onChange, onOpenLink, autoFocus, placeholder = 'Write something… type / for blocks, @ to link a card', readOnly = false, className }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const last = useRef(value);
  const locked = useRef(false);
  const callbacks = useRef({ onChange, onOpenLink });
  callbacks.current = { onChange, onOpenLink };

  const [suggest, setSuggest] = useState<SuggestState | null>(null);
  const [, setTick] = useState(0);
  const menu = useRef<MenuHandle | null>(null);
  const handlers = useRef({
    onState: (s: SuggestState | null) => setSuggest((prev) => (sameSuggest(prev, s) ? prev : s)),
    onKey: (e: KeyboardEvent) => menu.current?.key(e) ?? false,
  });

  useEffect(() => {
    const parsed = parseDoc(value);
    locked.current = parsed === null || readOnly;
    const v = new EditorView(host.current!, {
      state: EditorState.create({ doc: parsed ?? emptyDoc(), plugins: buildPlugins(placeholder, () => handlers.current) }),
      nodeViews,
      editable: () => !locked.current,
      attributes: { spellcheck: 'true' },
      dispatchTransaction(tr) {
        const next = v.state.apply(tr);
        v.updateState(next);
        if (tr.docChanged && !locked.current) {
          last.current = JSON.stringify(next.doc.toJSON());
          callbacks.current.onChange(last.current);
        }
        if (tr.selectionSet || tr.docChanged) setTick((t) => t + 1);
      },
      handleDOMEvents: {
        click(_view, event) {
          const el = (event.target as HTMLElement).closest<HTMLElement>('[data-wikilink], a[href]');
          if (!el) return false;
          if (el.dataset.wikilink) {
            callbacks.current.onOpenLink(el.dataset.wikilink);
            return true;
          }
          return false; // real links open through the window-open handler (external browser in Electron)
        },
        focus: () => (setTick((t) => t + 1), false),
        blur: () => (setTick((t) => t + 1), false),
      },
    });
    view.current = v;
    host.current!.dataset.unsupported = parsed === null ? '1' : '';
    if (autoFocus) v.focus();
    setTick((t) => t + 1); // re-render now that the view exists, so menus and the toolbar can mount
    return () => {
      v.destroy();
      view.current = null;
    };
    // The view is created once per mounted editor; later `value` changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    locked.current = readOnly || host.current!.dataset.unsupported === '1';
    v.setProps({ editable: () => !locked.current });
  }, [readOnly]);

  useEffect(() => {
    const v = view.current;
    if (!v || value === last.current) return;
    const parsed = parseDoc(value);
    locked.current = parsed === null || readOnly;
    host.current!.dataset.unsupported = parsed === null ? '1' : '';
    last.current = value;
    v.updateState(EditorState.create({ doc: parsed ?? emptyDoc(), plugins: v.state.plugins }));
  }, [value, readOnly]);

  const v = view.current;
  return (
    <>
      <div className={`editor${className ? ` ${className}` : ''}`} ref={host} />
      {v && suggest?.kind === 'slash' && (
        <SlashMenu ref={menu} state={suggest} items={filterSlash(suggest.query)} onPick={(item) => runSlash(v, item, suggest.from, suggest.to)} />
      )}
      {v && suggest?.kind === 'mention' && (
        <MentionMenu
          ref={menu}
          state={suggest}
          onPick={(id, title) => insertMention(v, suggest.from, suggest.to, id, title)}
          onCreate={async (title) => {
            const id = await editorEnv.createCard(title);
            if (id) insertMention(v, suggest.from, suggest.to, id, title);
          }}
        />
      )}
      {v && !locked.current && !suggest && <ToolbarPortal view={v} />}
    </>
  );
}

function ToolbarPortal({ view }: { view: EditorView }) {
  return createPortal(<Toolbar view={view} />, document.body);
}

function sameSuggest(a: SuggestState | null, b: SuggestState | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.kind === b.kind && a.from === b.from && a.to === b.to && a.query === b.query && a.rect.left === b.rect.left && a.rect.bottom === b.rect.bottom;
}
