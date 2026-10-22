import { useState } from 'react';
import { useApp } from '../state.js';
import { Editor } from './Editor.js';

export function CardPanel() {
  const panel = useApp((s) => s.panel);
  const board = useApp((s) => s.board);
  const [tag, setTag] = useState('');
  const [confirm, setConfirm] = useState(false);
  const { editCard, closePanel, openCard, openByTitle, addTag, removeTag, trashCard, addExistingCard, selectBoard } = useApp.getState();
  if (!panel) return null;

  const onThisBoard = board?.placements.some((p) => p.cardId === panel.id);

  return (
    <aside className="panel" aria-label="Card details">
      <div className="panel-head">
        <input
          className="panel-title"
          value={panel.title}
          placeholder="Untitled"
          aria-label="Card title"
          onChange={(e) => editCard(panel.id, { title: e.target.value })}
        />
        <button className="icon-btn" onClick={closePanel} aria-label="Close panel" title="Close">×</button>
      </div>

      <div className="panel-body">
        <Editor key={panel.id} value={panel.content} onChange={(json) => editCard(panel.id, { content: json })} onOpenLink={(t) => void openByTitle(t)} placeholder="Write something… try [[linking]] to another card" />

        <h3>Tags</h3>
        <div className="chips">
          {panel.tags.map((t) => (
            <span className="chip" key={t}>#{t}<button aria-label={`Remove tag ${t}`} onClick={() => void removeTag(panel.id, t)}>×</button></span>
          ))}
          <form onSubmit={(e) => { e.preventDefault(); if (tag.trim()) void addTag(panel.id, tag); setTag(''); }}>
            <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Add tag" aria-label="Add tag" />
          </form>
        </div>

        <h3>Whiteboards</h3>
        <ul className="plain">
          {panel.boards.map((b) => (
            <li key={b.id}><button className="link" onClick={() => void selectBoard(b.id)}>{b.name || 'Untitled'}</button></li>
          ))}
          {!panel.boards.length && <li className="none">Not on any whiteboard.</li>}
        </ul>
        {board && !onThisBoard && (
          <button onClick={() => void addExistingCard(panel.id, 80, 80)}>Add to “{board.whiteboard.name}”</button>
        )}

        <h3>Backlinks</h3>
        <ul className="plain">
          {panel.backlinks.map((b) => (
            <li key={b.id}><button className="link" onClick={() => void openCard(b.id)}>{b.title || 'Untitled'}</button></li>
          ))}
          {!panel.backlinks.length && <li className="none">No cards link here yet. Mention it as [[{panel.title || 'Title'}]].</li>}
        </ul>

        <div className="danger">
          <button
            className={confirm ? 'danger-btn' : ''}
            onBlur={() => setConfirm(false)}
            onClick={() => (confirm ? void trashCard(panel.id) : setConfirm(true))}
          >
            {confirm ? 'Click again to delete card' : 'Delete card'}
          </button>
        </div>
      </div>
    </aside>
  );
}
