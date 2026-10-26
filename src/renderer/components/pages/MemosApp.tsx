import { useEffect, useRef, useState } from 'react';
import { docToText } from '../../../core/doc.js';
import type { CardSummary } from '../../../core/store.js';
import { api } from '../../api.js';
import { newMemo, openCard, trashCard } from '../../actions.js';
import { mutate, useData } from '../../store/data.js';
import { Icon } from '../Icon.js';
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
      <div className="page-head memos-head"><h2>Memos</h2><p className="hint">Catch the thought now. Sort it into a note or a task later.</p></div>
      <form className="memo-composer" onSubmit={(e) => { e.preventDefault(); void capture(); }}>
        <textarea
          ref={box}
          value={draft}
          rows={3}
          placeholder="What's on your mind?"
          aria-label="New memo"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void capture();
            }
          }}
        />
        <div className="memo-composer-foot">
          <span className="hint"><kbd>Enter</kbd> to save · <kbd>Shift</kbd> + <kbd>Enter</kbd> for a new line</span>
          <button className="btn primary" type="submit" disabled={!draft.trim()}>Save memo</button>
        </div>
      </form>
      <div className="filters"><input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search memos…" aria-label="Search memos" /></div>
      {shown.length === 0 ? (
        <Empty title={q.trim() ? 'No memos match' : 'No memos yet'}>{q.trim() ? 'Try different words.' : 'Memos are for things you want to get down before they slip away.'}</Empty>
      ) : (
        byDay(shown).map(([day, items]) => (
          <section key={day} className="memo-day" aria-label={day}>
            <h3 className="day-label">{day}</h3>
            <ul className="memo-list">
              {items.map((m) => <MemoItem key={m.id} memo={m} />)}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

const clock = (ms: number): string => new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/** Groups newest-first memos under Today, Yesterday or their date. */
function byDay(memos: CardSummary[]): [string, CardSummary[]][] {
  const key = (ms: number): string => new Date(ms).toDateString();
  const today = key(Date.now());
  const yesterday = key(Date.now() - 86400_000);
  const groups = new Map<string, CardSummary[]>();
  for (const m of memos) {
    const k = key(m.createdAt);
    const label = k === today ? 'Today' : k === yesterday ? 'Yesterday' : new Date(m.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: new Date(m.createdAt).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
    groups.set(label, [...(groups.get(label) ?? []), m]);
  }
  return [...groups];
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
      <time className="memo-time" dateTime={new Date(memo.createdAt).toISOString()} title={timeAgo(memo.updatedAt)}>{clock(memo.createdAt)}</time>
      <button className="memo-text" onClick={() => openCard(memo.id)} aria-label="Open memo">{full || 'Empty memo'}</button>
      <div className="memo-foot">
        {memo.tags.map((t) => <em key={t} className="label">#{t}</em>)}
        <span className="grow" />
        <button className="act" onClick={() => void mutate(() => api.convertCard(memo.id, 'note')).then(() => openCard(memo.id))}>To note</button>
        <button className="act" onClick={() => void mutate(() => api.convertCard(memo.id, 'task')).then(() => openCard(memo.id))}>To task</button>
        <button className="icon-btn" title="Delete memo" aria-label="Delete memo" onClick={() => void trashCard(memo.id)}><Icon name="trash" size={14} /></button>
      </div>
    </li>
  );
}
