import { useEffect } from 'react';
import { CardPanel } from './components/CardPanel.js';
import { Sidebar } from './components/Sidebar.js';
import { Whiteboard } from './components/Whiteboard.js';
import { flushAll, useApp } from './state.js';

export function App() {
  const ready = useApp((s) => s.ready);
  const board = useApp((s) => s.board);
  const error = useApp((s) => s.error);
  const hasPanel = useApp((s) => s.panel !== null);

  useEffect(() => {
    void useApp.getState().init();
    const flush = (): void => void flushAll();
    window.addEventListener('pagehide', flush);
    window.addEventListener('blur', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('blur', flush);
    };
  }, []);

  useEffect(() => {
    if (!error) return;
    const t = window.setTimeout(() => useApp.getState().setError(null), 7000);
    return () => window.clearTimeout(t);
  }, [error]);

  return (
    <div className={`app${hasPanel ? ' with-panel' : ''}`}>
      <Sidebar />
      <main className="main">
        {board && <div className="board-title" aria-live="polite">{board.whiteboard.name || 'Untitled whiteboard'}</div>}
        {ready && !board && (
          <div className="blank">
            <h1>No whiteboard selected</h1>
            <button className="primary" onClick={() => void useApp.getState().createBoard()}>Create a whiteboard</button>
          </div>
        )}
        <Whiteboard />
      </main>
      <CardPanel />
      {error && (
        <div className="toast" role="alert">
          {error}
          <button className="icon-btn" aria-label="Dismiss" onClick={() => useApp.getState().setError(null)}>×</button>
        </div>
      )}
    </div>
  );
}
