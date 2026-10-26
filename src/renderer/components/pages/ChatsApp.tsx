import { useState } from 'react';
import { api } from '../../api.js';
import { mutate, useData } from '../../store/data.js';
import { ChatView } from '../chat/ChatView.js';
import { Icon } from '../Icon.js';
import { Empty, timeAgo } from '../ui/bits.js';
import { pruneTabs } from '../../actions.js';

/** All conversations on the left, the selected one on the right. */
export function ChatsApp({ openId }: { openId?: string }) {
  const chats = useData((s) => s.chats);
  const [selected, setSelected] = useState<string | null>(openId || chats[0]?.id || null);
  const [nonce, setNonce] = useState(0);

  const remove = async (id: string): Promise<void> => {
    await mutate(() => api.deleteChat(id));
    pruneTabs();
    if (selected === id) setSelected(null);
  };

  return (
    <div className="chats-app">
      <aside className="chat-list" aria-label="Conversations">
        <button className="btn primary" onClick={() => { setSelected(null); setNonce((n) => n + 1); }}><Icon name="plus" size={14} /> New chat</button>
        {chats.length === 0 && <Empty title="No chats yet" />}
        <ul>
          {chats.map((c) => (
            <li key={c.id}>
              <button className={`card-row${selected === c.id ? ' selected' : ''}`} onClick={() => setSelected(c.id)}>
                <span className="title ellipsis">{c.title || 'Untitled chat'}</span>
                <span className="snippet ellipsis">{c.preview}</span>
                <span className="meta">{timeAgo(c.updatedAt)}</span>
              </button>
              <button className="icon-btn" aria-label={`Delete ${c.title || 'chat'}`} onClick={() => void remove(c.id)}><Icon name="trash" size={13} /></button>
            </li>
          ))}
        </ul>
      </aside>
      <div className="chat-main">
        <ChatView key={`${nonce}:${selected ?? 'new'}`} chatId={selected} onChatId={setSelected} />
      </div>
    </div>
  );
}
