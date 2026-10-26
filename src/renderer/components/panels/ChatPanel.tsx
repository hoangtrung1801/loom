import { useEffect, useState } from 'react';
import type { ContextRef } from '../../../core/chats.js';
import { openChatTab } from '../../actions.js';
import { cardTitle } from '../../actions.js';
import { useData } from '../../store/data.js';
import type { Tab } from '../../store/tabs.js';
import { useUi } from '../../store/ui.js';
import { ChatView } from '../chat/ChatView.js';
import { Icon } from '../Icon.js';

/** The context a new chat starts with: whatever the active tab is about. */
function defaultContext(tab: Tab, boardName: (id: string) => string): ContextRef[] {
  switch (tab.type) {
    case 'card': return [{ type: 'card', id: tab.ref, label: cardTitle(tab.ref) }];
    case 'whiteboard': return [{ type: 'whiteboard', id: tab.ref, label: boardName(tab.ref) }];
    case 'tag': return [{ type: 'tag', id: tab.ref, label: `#${tab.ref}` }];
    default: return [];
  }
}

export function ChatPanel({ tab }: { tab: Tab }) {
  const chats = useData((s) => s.chats);
  const boards = useData((s) => s.boards);
  const uiChatId = useUi((s) => s.chatId);
  const seed = useUi((s) => s.chatSeed);
  const auto = useUi((s) => s.chatAuto);
  const clearAuto = useUi((s) => s.clearChatAuto);
  const [chatId, setChatId] = useState<string | null>(uiChatId);
  const [fresh, setFresh] = useState(0);

  useEffect(() => setChatId(uiChatId), [uiChatId]);
  useEffect(() => {
    if (auto) {
      // The research flow always starts a new chat.
      setChatId(null);
      setFresh((n) => n + 1);
    }
  }, [auto]);

  const boardName = (id: string): string => boards.find((b) => b.id === id)?.name || 'Whiteboard';
  const initial = seed ?? defaultContext(tab, boardName);

  return (
    <div className="chat-panel">
      <div className="chat-bar">
        <select value={chatId ?? ''} onChange={(e) => { setChatId(e.target.value || null); setFresh((n) => n + 1); }} aria-label="Conversation">
          <option value="">New chat</option>
          {chats.map((c) => <option key={c.id} value={c.id}>{c.title || 'Untitled chat'}</option>)}
        </select>
        <button className="icon-btn" aria-label="New chat" title="New chat" onClick={() => { setChatId(null); setFresh((n) => n + 1); }}><Icon name="plus" /></button>
        {chatId && <button className="icon-btn" aria-label="Open in a tab" title="Open in a tab" onClick={() => openChatTab(chatId)}><Icon name="export" /></button>}
      </div>
      <ChatView
        key={`${fresh}:${chatId ?? 'new'}`}
        chatId={chatId}
        initialContext={initial}
        autoSend={auto}
        onChatId={(id) => {
          setChatId(id);
          clearAuto();
        }}
        compact
      />
    </div>
  );
}
