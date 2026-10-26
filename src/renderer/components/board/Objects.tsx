import { memo, useEffect, useRef, useState } from 'react';
import { docToMarkdown } from '../../../core/doc.js';
import type { PlacementView } from '../../../core/store.js';
import { fileUrl } from '../../api.js';
import { openByTitle } from '../../actions.js';
import { Editor } from '../../editor/Editor.js';
import { editCard } from '../../store/edits.js';
import { isFileId } from '../../../core/fileid.js';
import { Markdown } from '../chat/Markdown.js';
import { Icon, KIND_ICON } from '../Icon.js';

export interface ObjectHandlers {
  down(e: React.PointerEvent, p: PlacementView): void;
  doubleClick(p: PlacementView): void;
  contextMenu(e: React.MouseEvent, p: PlacementView): void;
  resize(e: React.PointerEvent, p: PlacementView): void;
  connect(e: React.PointerEvent, p: PlacementView): void;
  commitText(p: PlacementView, text: string): void;
  stopEditing(): void;
  open(p: PlacementView): void;
}

interface Props {
  p: PlacementView;
  selected: boolean;
  editing: boolean;
  dim: boolean;
  match: boolean;
  isMind: boolean;
  handlers: ObjectHandlers;
}

const previewCache = new Map<string, string>();
function preview(content: string): string {
  let cached = previewCache.get(content);
  if (cached === undefined) {
    cached = docToMarkdown(content).lines.slice(0, 40).map((l) => l.text).join('\n').slice(0, 1200);
    if (previewCache.size > 500) previewCache.clear();
    previewCache.set(content, cached);
  }
  return cached;
}

function Frame({ p, selected, editing, dim, match, isMind, handlers, className, children }: Props & { className: string; children: React.ReactNode }) {
  return (
    <div
      className={`obj ${className}${selected ? ' selected' : ''}${editing ? ' editing' : ''}${dim ? ' dim' : ''}${match ? ' match' : ''}${p.color ? ` c-${p.color}` : ''}${isMind ? ' mind' : ''}`}
      data-pid={p.id}
      style={{ left: p.x, top: p.y, width: p.w, height: p.h }}
      onPointerDown={(e) => handlers.down(e, p)}
      onDoubleClick={(e) => { e.stopPropagation(); handlers.doubleClick(p); }}
      onContextMenu={(e) => handlers.contextMenu(e, p)}
    >
      {children}
      {selected && !editing && (
        <>
          <span className="handle resize" onPointerDown={(e) => handlers.resize(e, p)} aria-label="Resize" />
          <span className="handle link" onPointerDown={(e) => handlers.connect(e, p)} aria-label="Connect" title="Drag to connect" />
        </>
      )}
    </div>
  );
}

function CardObject(props: Props) {
  const { p, editing, handlers } = props;
  const media = isFileId(p.fileId);
  return (
    <Frame {...props} className={`card-obj kind-${p.cardKind}`}>
      <header>
        <Icon name={KIND_ICON[p.cardKind] ?? 'card'} size={13} />
        {editing ? (
          <input className="obj-title" defaultValue={p.title} aria-label="Card title" autoFocus onPointerDown={(e) => e.stopPropagation()} onChange={(e) => editCard(p.cardId, { title: e.target.value })} />
        ) : (
          <strong className="ellipsis">{p.title || 'Untitled'}</strong>
        )}
        <button className="icon-btn" aria-label="Open card" title="Open card" onPointerDown={(e) => e.stopPropagation()} onClick={() => handlers.open(p)}><Icon name="export" size={12} /></button>
      </header>
      <div className="obj-body" onPointerDown={(e) => editing && e.stopPropagation()}>
        {media && p.cardKind === 'image' && <img src={fileUrl(p.fileId)} alt={p.title} draggable={false} />}
        {media && p.cardKind === 'video' && <video src={fileUrl(p.fileId)} preload="metadata" muted />}
        {media && p.cardKind === 'audio' && <audio src={fileUrl(p.fileId)} controls preload="none" onPointerDown={(e) => e.stopPropagation()} />}
        {editing ? (
          <Editor value={p.content} onChange={(json) => editCard(p.cardId, { content: json })} onOpenLink={(t) => void openByTitle(t)} autoFocus className="obj-editor" placeholder="Write…" />
        ) : (
          <Markdown text={preview(p.content)} />
        )}
      </div>
    </Frame>
  );
}

function TextObject(props: Props) {
  const { p, editing, handlers } = props;
  const [draft, setDraft] = useState(p.text);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setDraft(p.text), [p.text]);
  useEffect(() => {
    if (editing) {
      area.current?.focus();
      area.current?.select();
    }
  }, [editing]);
  const finish = (): void => {
    handlers.stopEditing();
    if (draft !== p.text) handlers.commitText(p, draft);
  };
  return (
    <Frame {...props} className="text-obj">
      {editing ? (
        <textarea
          ref={area}
          value={draft}
          style={{ fontSize: p.size }}
          aria-label="Text"
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={finish}
          onKeyDown={(e) => {
            if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
              e.preventDefault();
              e.currentTarget.blur();
            }
            e.stopPropagation();
          }}
        />
      ) : (
        <div className="text-body" style={{ fontSize: p.size }}>{p.text || <em>Empty</em>}</div>
      )}
    </Frame>
  );
}

function SectionObject(props: Props) {
  const { p, editing, handlers } = props;
  const [draft, setDraft] = useState(p.text);
  useEffect(() => setDraft(p.text), [p.text]);
  const finish = (): void => {
    handlers.stopEditing();
    if (draft !== p.text) handlers.commitText(p, draft);
  };
  return (
    <Frame {...props} className="section-obj">
      <header>
        {editing ? (
          <input
            autoFocus
            value={draft}
            aria-label="Section title"
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={finish}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
              e.stopPropagation();
            }}
          />
        ) : (
          <strong className="ellipsis">{p.text || 'Untitled section'}</strong>
        )}
      </header>
    </Frame>
  );
}

function BoardObject(props: Props) {
  const { p } = props;
  return (
    <Frame {...props} className="board-obj">
      <Icon name="board" size={22} />
      <strong className="ellipsis">{p.title || 'Untitled whiteboard'}</strong>
      <span className="hint">Double-click to open</span>
    </Frame>
  );
}

export const BoardObjectView = memo(function BoardObjectView(props: Props) {
  switch (props.p.kind) {
    case 'card': return <CardObject {...props} />;
    case 'section': return <SectionObject {...props} />;
    case 'board': return <BoardObject {...props} />;
    default: return <TextObject {...props} />;
  }
});
