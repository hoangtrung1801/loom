import { useEffect, useRef, useState } from 'react';
import { docToText } from '../../../core/doc.js';
import type { CardSummary } from '../../../core/store.js';
import { api } from '../../api.js';
import { newMemo, openCard, trashCard } from '../../actions.js';
import { mutate, useData } from '../../store/data.js';
import { Empty, timeAgo, useDebounced } from '../ui/bits.js';

/** Quick capture: type, press Enter, and it is saved. Memos stay light until you turn one into a note or a task. */
export function MemosApp() {
  const version = useData((s) => s.version);
  const [memos, setMemos] = useState<CardSummary[]>([]);
  const [draft, setDraft] = useState('');
  const [text, setText] = useState('');
  const q = useDebounced(text);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => box.current?.focus(), []);
  useEffect(() => {
    let live = true;
    void api.listCards({ kinds: ['memo'], sort: 'created', limit: 1000 }).then((m) => live && setMemos(m));
    return () => {
      live = false;
    };
  }, [version]);

  const shown = q.trim() ? memos.filter((m) => `${m.title} ${m.preview}`.toLowerCase().includes(q.trim().toLowerCase())) : memos;
  const capture = async (): Promise<void> => {
    const body = draft.trim();
    if (!body) return;
    setDraft('');
    await newMemo(body);
    box.current?.focus();
  };

  return (
    <div className="page memos-app">
      <div className="page-head"><h2 className="grow">Memos</h2></div>
      <form className="memo-composer" onSubmit={(e) => { e.preventDefault(); void capture(); }}>
        <textarea
          ref={box}
          value={draft}
          rows={3}
          placeholder="Capture a thought… Enter to save, Shift+Enter for a new line"
          aria-label="New memo"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void capture();
            }
          }}
        />
        <button className="btn primary" type="submit" disabled={!draft.trim()}>Save memo</button>
      </form>
      <div className="filters"><input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search memos…" aria-label="Search memos" /></div>
      {shown.length === 0 ? (
        <Empty title={q.trim() ? 'No memos match' : 'No memos yet'}>{q.trim() ? 'Try different words.' : 'Memos are for things you want to get down before they slip away.'}</Empty>
      ) : (
        <ul className="memo-list">
          {shown.map((m) => <MemoItem key={m.id} memo={m} />)}
        </ul>
      )}
    </div>
  );
}

function MemoItem({ memo }: { memo: CardSummary }) {
  // The summary preview is cut short; a memo is small enough to show whole.
  const [full, setFull] = useState(memo.preview);
  useEffect(() => {
    let live = true;
    void api.getCard(memo.id).then((c) => live && c && setFull(docToText(c.content)));
    return () => {
      live = false;
    };
  }, [memo.id, memo.updatedAt]);
  return (
    <li className="memo-item">
      <button className="memo-text" onClick={() => openCard(memo.id)} aria-label="Open memo">{full || 'Empty memo'}</button>
      <div className="memo-foot">
        <span className="muted">{timeAgo(memo.updatedAt)}</span>
        {memo.tags.map((t) => <em key={t} className="label">#{t}</em>)}
        <span className="grow" />
        <button className="link" onClick={() => void mutate(() => api.convertCard(memo.id, 'note')).then(() => openCard(memo.id))}>To note</button>
        <button className="link" onClick={() => void mutate(() => api.convertCard(memo.id, 'task')).then(() => openCard(memo.id))}>To task</button>
        <button className="link danger-link" onClick={() => void trashCard(memo.id)}>Delete</button>
      </div>
    </li>
  );
}
