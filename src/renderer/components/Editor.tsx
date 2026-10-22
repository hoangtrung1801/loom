import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { useEffect, useRef } from 'react';
import { buildPlugins, emptyDoc, parseDoc } from './editorSetup.js';

interface Props {
  value: string;
  onChange(json: string): void;
  onOpenLink(title: string): void;
  autoFocus?: boolean;
  placeholder?: string;
}

/**
 * ProseMirror owns the document while you type. `value` is only applied when it
 * differs from what this editor last produced, i.e. when another view of the same
 * card (or a sync) changed it.
 */
export function Editor({ value, onChange, onOpenLink, autoFocus, placeholder = 'Write something…' }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const last = useRef(value);
  const readOnly = useRef(false);
  const callbacks = useRef({ onChange, onOpenLink });
  callbacks.current = { onChange, onOpenLink };

  useEffect(() => {
    const parsed = parseDoc(value);
    readOnly.current = parsed === null;
    const v = new EditorView(host.current!, {
      state: EditorState.create({ doc: parsed ?? emptyDoc(), plugins: buildPlugins(placeholder) }),
      editable: () => !readOnly.current,
      attributes: { spellcheck: 'true' },
      dispatchTransaction(tr) {
        const next = v.state.apply(tr);
        v.updateState(next);
        if (tr.docChanged && !readOnly.current) {
          last.current = JSON.stringify(next.doc.toJSON());
          callbacks.current.onChange(last.current);
        }
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
      },
    });
    view.current = v;
    host.current!.dataset.unsupported = parsed === null ? '1' : '';
    if (autoFocus) v.focus();
    return () => {
      v.destroy();
      view.current = null;
    };
    // The view is created once per mounted editor; later `value` changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const v = view.current;
    if (!v || value === last.current) return;
    const parsed = parseDoc(value);
    readOnly.current = parsed === null;
    host.current!.dataset.unsupported = parsed === null ? '1' : '';
    last.current = value;
    v.updateState(EditorState.create({ doc: parsed ?? emptyDoc(), plugins: v.state.plugins }));
  }, [value]);

  return <div className="editor" ref={host} />;
}
