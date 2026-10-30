import { useCallback, useEffect, useRef, useState } from 'react';
import type { AiActionDef, ChatDetail, ContextRef, SourceRef } from '../../../core/chats.js';
import { markdownToContent } from '../../../core/markdown.js';
import { api, errorMessage, onEvent } from '../../api.js';
import { openApp, openBoard, openCard, openTag } from '../../actions.js';
import { mutate, refresh, toast } from '../../store/data.js';
import { Icon } from '../Icon.js';
import { Markdown } from './Markdown.js';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Chip } from '@/components/ui/chip';
import { AnimatedShinyText } from '@/components/ui/animated-shiny-text';

interface AiEvent {
  type: 'start' | 'delta' | 'tool' | 'done' | 'error';
  chatId: string;
  text?: string;
  label?: string;
  message?: string;
  changes?: string[];
}

const WRITES_KEY = 'loom.ai.writes';
const readWrites = (): boolean => {
  try {
    return localStorage.getItem(WRITES_KEY) === '1';
  } catch {
    return false;
  }
};

export function openSource(source: SourceRef): void {
  openCard(source.cardId);
  if (source.blockId) window.setTimeout(() => window.dispatchEvent(new CustomEvent('loom:scroll-block', { detail: source.blockId })), 350);
}

export function openContext(ref: ContextRef): void {
  if (ref.type === 'card') openCard(ref.id);
  else if (ref.type === 'whiteboard') openBoard(ref.id);
  else if (ref.type === 'section') openBoard(ref.boardId ?? '', ref.id);
  else if (ref.type === 'tag') openTag(ref.id);
}

/** A conversation: messages, tool activity, attached context and the composer. Used by the side panel and the Chat app. */
export function ChatView({
  chatId,
  initialContext = [],
  autoSend,
  onChatId,
  compact,
}: {
  chatId: string | null;
  initialContext?: ContextRef[];
  autoSend?: string | null;
  onChatId(id: string): void;
  compact?: boolean;
}) {
  const [chat, setChat] = useState<ChatDetail | null>(null);
  const [context, setContext] = useState<ContextRef[]>(initialContext);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState('');
  const [activity, setActivity] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [allowWrites, setAllowWrites] = useState(readWrites);
  const [actions, setActions] = useState<AiActionDef[]>([]);
  const [configured, setConfigured] = useState(true);
  const currentId = useRef<string | null>(chatId);
  const sending = useRef(false);
  const bottom = useRef<HTMLDivElement>(null);
  const autoSent = useRef(false);

  const load = useCallback(async (id: string): Promise<void> => {
    const detail = await api.getChat(id);
    if (!detail || currentId.current !== id) return;
    setChat(detail);
    setContext(detail.context);
  }, []);

  useEffect(() => {
    currentId.current = chatId;
    setStreaming('');
    setActivity([]);
    setError('');
    if (chatId) void load(chatId);
    else {
      setChat(null);
      setContext(initialContext);
    }
    // initialContext only seeds a brand-new chat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, load]);

  useEffect(() => {
    void api.listAiActions().then(setActions);
    void api.getAiConfig().then((c) => setConfigured(c.hasKey || c.provider === 'openai'));
  }, []);

  useEffect(() => {
    return onEvent('ai', (raw) => {
      const ev = raw as AiEvent;
      if (!sending.current && ev.chatId !== currentId.current) return;
      if (ev.chatId !== currentId.current) {
        if (ev.type !== 'start' && currentId.current !== null) return;
        currentId.current = ev.chatId;
      }
      if (ev.type === 'delta') setStreaming((s) => s + (ev.text ?? ''));
      else if (ev.type === 'tool') setActivity((a) => [...a, ev.label ?? '']);
      else if (ev.type === 'error') {
        sending.current = false;
        setBusy(false);
        setStreaming('');
        setError(ev.message ?? 'Something went wrong.');
        void load(ev.chatId);
        void refresh();
      } else if (ev.type === 'done') {
        sending.current = false;
        setBusy(false);
        setStreaming('');
        setActivity([]);
        if (ev.changes?.length) toast(ev.changes.join(' · '));
        void load(ev.chatId);
        void refresh();
      }
    });
  }, [load]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [chat?.messages.length, streaming, activity.length]);

  const send = useCallback(
    async (text: string): Promise<void> => {
      const message = text.trim();
      if (!message || sending.current) return;
      sending.current = true;
      setBusy(true);
      setError('');
      setDraft('');
      setStreaming('');
      setActivity([]);
      // Show the user's message right away; the persisted copy replaces it on the next load.
      setChat((c) => ({ id: c?.id ?? '', title: c?.title ?? '', context, messages: [...(c?.messages ?? []), { id: 'pending', role: 'user', content: message, sources: [], createdAt: Date.now() }] }));
      try {
        const r = await api.sendChat({ chatId: currentId.current ?? undefined, text: message, context, allowWrites });
        if (currentId.current !== r.chatId) {
          currentId.current = r.chatId;
          onChatId(r.chatId);
        }
      } catch (err) {
        sending.current = false;
        setBusy(false);
        setError(errorMessage(err));
        if (currentId.current) void load(currentId.current);
      }
    },
    [allowWrites, context, load, onChatId],
  );

  useEffect(() => {
    if (autoSend && !autoSent.current && configured) {
      autoSent.current = true;
      void send(autoSend);
    }
  }, [autoSend, configured, send]);

  const setCtx = (next: ContextRef[]): void => {
    setContext(next);
    if (currentId.current) void api.setChatContext(currentId.current, next);
  };

  const skills = draft.startsWith('/') ? actions.filter((a) => a.name.toLowerCase().includes(draft.slice(1).toLowerCase())) : [];
  const messages = chat?.messages ?? [];

  return (
    <div className={`chat${compact ? ' compact' : ''}`}>
      {!configured && (
        <div className="notice">
          Add an API key in <button className="link" onClick={() => openApp('settings')}>Settings → AI</button> to chat.
        </div>
      )}
      <div className="chat-scroll" role="log" aria-live="polite">
        {messages.length === 0 && !busy && (
          <div className="chat-empty">
            <Icon name="sparkle" size={22} />
            <p>Ask about your notes. Attach cards, a whiteboard or a tag below, or let the assistant search for itself.</p>
          </div>
        )}
        {messages.map((m) =>
          m.role === 'tool' ? (
            <div key={m.id} className="tool-line"><Icon name="search" size={12} /> {m.content}</div>
          ) : (
            <div key={m.id} className={`msg ${m.role}`}>
              {m.role === 'assistant' ? <Markdown text={m.content} sources={m.sources} onCite={openSource} /> : <p>{m.content}</p>}
              {m.role === 'assistant' && m.sources.length > 0 && (
                <ol className="sources" aria-label="Sources">
                  {m.sources.map((s) => (
                    <li key={s.n}><button className="link" onClick={() => openSource(s)} title={s.quote}><span className="cite">{s.n}</span> {s.title}</button></li>
                  ))}
                </ol>
              )}
              {m.role === 'assistant' && (
                <div className="msg-actions">
                  <Button variant="ghost" size="icon" aria-label="Copy" title="Copy" onClick={() => void navigator.clipboard?.writeText(m.content)}><Icon name="copy" size={13} /></Button>
                  <Button variant="ghost" size="icon" aria-label="Save as card" title="Save as card" onClick={() => void mutate(async () => openCard(await api.createCard({ title: (chat?.title ?? 'AI answer').slice(0, 60), content: markdownToContent(m.content), inbox: true })))}><Icon name="card" size={13} /></Button>
                </div>
              )}
            </div>
          ),
        )}
        {activity.map((a, i) => <div key={i} className="tool-line live"><Icon name="search" size={12} /> {a}</div>)}
        {busy && (
          <div className="msg assistant streaming">
            {streaming ? <Markdown text={streaming.replace(/\[c\d+:[\d-]+\]/g, '')} /> : <AnimatedShinyText className="thinking mx-0 text-muted-foreground via-foreground/80 dark:via-foreground/80">Thinking…</AnimatedShinyText>}
          </div>
        )}
        {error && <div className="error" role="alert">{error}</div>}
        <div ref={bottom} />
      </div>

      <div className="composer">
        {skills.length > 0 && (
          <ul className="skill-menu" role="listbox">
            {skills.map((a) => <li key={a.id}><button onClick={() => setDraft(a.prompt)}>/{a.name}</button></li>)}
          </ul>
        )}
        {context.length > 0 && (
          <div className="chips" aria-label="Attached context">
            {context.map((c) => (
              <Chip key={`${c.type}:${c.id}`} label={c.label || c.id} title={c.type} removeLabel={`Remove ${c.label || c.id}`} onOpen={() => openContext(c)} onRemove={() => setCtx(context.filter((x) => x !== c))} />
            ))}
          </div>
        )}
        <Textarea
          value={draft}
          rows={2}
          placeholder="Ask about your notes…  (/ for your saved prompts)"
          aria-label="Message"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send(draft);
            }
          }}
        />
        <div className="composer-row">
          <label className="check" title="Let the assistant create and change cards and whiteboards">
            <input type="checkbox" checked={allowWrites} onChange={(e) => { setAllowWrites(e.target.checked); try { localStorage.setItem(WRITES_KEY, e.target.checked ? '1' : '0'); } catch { /* not remembered */ } }} />
            Allow edits
          </label>
          <span className="grow" />
          {busy ? (
            <Button variant="outline" onClick={() => currentId.current && void api.stopChat(currentId.current)}><Icon name="stop" size={14} /> Stop</Button>
          ) : (
            <Button disabled={!draft.trim()} onClick={() => void send(draft)}><Icon name="send" size={14} /> Send</Button>
          )}
        </div>
      </div>
    </div>
  );
}
