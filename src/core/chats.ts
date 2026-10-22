import { randomUUID } from 'node:crypto';
import { snippet } from './text.js';
import type { Store } from './store.js';

/** A thing the user attached to a chat as context. */
export interface ContextRef {
  type: 'card' | 'whiteboard' | 'section' | 'tag' | 'search';
  id: string;
  /** Section refs carry their whiteboard; search refs carry the query. */
  boardId?: string;
  label?: string;
}
export interface SourceRef {
  /** Citation number the model used, e.g. 1 for "[1]". */
  n: number;
  cardId: string;
  title: string;
  blockId: string;
  startLine: number;
  endLine: number;
  quote: string;
}
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  sources: SourceRef[];
  createdAt: number;
}
export interface ChatSummary {
  id: string;
  title: string;
  preview: string;
  updatedAt: number;
  messageCount: number;
}
export interface ChatDetail {
  id: string;
  title: string;
  context: ContextRef[];
  messages: ChatMessage[];
}
export interface AiActionDef {
  id: string;
  name: string;
  prompt: string;
  kind: 'action' | 'skill';
}

const ROLES = ['user', 'assistant', 'tool', 'system'];

export class Chats {
  constructor(private readonly store: Store) {}

  createChat(input: { title?: string; context?: ContextRef[] } = {}): string {
    const id = randomUUID();
    const now = Date.now();
    this.store.commit([
      { entity: 'chat', id, fields: { title: (input.title ?? '').slice(0, 200), context: JSON.stringify(cleanContext(input.context)), created_at: now, updated_at: now, deleted_at: null } },
    ]);
    return id;
  }

  listChats(limit = 200): ChatSummary[] {
    return this.store
      .all(
        `SELECT c.id, c.title, c.updated_at,
                (SELECT COUNT(*) FROM chat_messages m WHERE m.chat_id = c.id AND m.deleted_at IS NULL AND m.role IN ('user','assistant')) AS n,
                (SELECT content FROM chat_messages m WHERE m.chat_id = c.id AND m.deleted_at IS NULL AND m.role IN ('user','assistant') ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) AS last
         FROM chats c WHERE c.deleted_at IS NULL ORDER BY c.updated_at DESC LIMIT ?`,
        Math.min(limit, 1000),
      )
      .map((r) => ({ id: r.id, title: r.title, preview: snippet(r.last ?? '', 120), updatedAt: r.updated_at, messageCount: r.n }));
  }

  getChat(id: string): ChatDetail | null {
    const c = this.store.get('SELECT id, title, context FROM chats WHERE id = ? AND deleted_at IS NULL', id);
    if (!c) return null;
    const messages = this.store
      .all('SELECT id, role, content, sources, created_at FROM chat_messages WHERE chat_id = ? AND deleted_at IS NULL ORDER BY created_at, rowid', id)
      .map((m): ChatMessage => ({ id: m.id, role: m.role, content: m.content, sources: parseJson<SourceRef[]>(m.sources, []), createdAt: m.created_at }));
    return { id: c.id, title: c.title, context: parseJson<ContextRef[]>(c.context, []), messages };
  }

  renameChat(id: string, title: string): void {
    this.require(id);
    this.store.commit([{ entity: 'chat', id, fields: { title: title.slice(0, 200), updated_at: Date.now() } }]);
  }

  setChatContext(id: string, context: ContextRef[]): void {
    this.require(id);
    this.store.commit([{ entity: 'chat', id, fields: { context: JSON.stringify(cleanContext(context)), updated_at: Date.now() } }]);
  }

  deleteChat(id: string): void {
    this.require(id);
    this.store.commit([{ entity: 'chat', id, fields: { deleted_at: Date.now() } }]);
  }

  /** Used by the AI layer; not part of the renderer-facing API. */
  addMessage(chatId: string, role: ChatMessage['role'], content: string, sources: SourceRef[] = []): string {
    this.require(chatId);
    if (!ROLES.includes(role)) throw new Error('Unknown role.');
    const id = randomUUID();
    const now = Date.now();
    this.store.commit([
      { entity: 'chatMessage', id, fields: { chat_id: chatId, role, content, sources: JSON.stringify(sources), created_at: now, deleted_at: null } },
      { entity: 'chat', id: chatId, fields: { updated_at: now } },
    ]);
    return id;
  }

  updateMessage(id: string, content: string, sources?: SourceRef[]): void {
    const fields: Record<string, string> = { content };
    if (sources) fields.sources = JSON.stringify(sources);
    this.store.commit([{ entity: 'chatMessage', id, fields }]);
  }

  deleteMessage(id: string): void {
    this.store.commit([{ entity: 'chatMessage', id, fields: { deleted_at: Date.now() } }]);
  }

  // ---------------------------------------------------------------- actions

  listAiActions(): AiActionDef[] {
    return this.store
      .all('SELECT id, name, prompt, kind FROM ai_actions WHERE deleted_at IS NULL ORDER BY lower(name)')
      .map((r) => ({ id: r.id, name: r.name, prompt: r.prompt, kind: r.kind === 'skill' ? 'skill' : 'action' }));
  }

  saveAiAction(input: { id?: string; name: string; prompt: string; kind?: 'action' | 'skill' }): string {
    const name = input.name.trim().slice(0, 80);
    if (!name || !input.prompt.trim()) throw new Error('An action needs a name and a prompt.');
    const id = input.id ?? randomUUID();
    this.store.commit([{ entity: 'aiAction', id, fields: { name, prompt: input.prompt.slice(0, 20_000), kind: input.kind ?? 'action', deleted_at: null } }]);
    return id;
  }

  deleteAiAction(id: string): void {
    this.store.commit([{ entity: 'aiAction', id, fields: { deleted_at: Date.now() } }]);
  }

  private require(id: string): void {
    if (!this.store.get('SELECT 1 AS x FROM chats WHERE id = ? AND deleted_at IS NULL', id)) throw new Error('Chat not found.');
  }
}

function cleanContext(context: ContextRef[] | undefined): ContextRef[] {
  const seen = new Set<string>();
  const out: ContextRef[] = [];
  for (const c of context ?? []) {
    if (!['card', 'whiteboard', 'section', 'tag', 'search'].includes(c.type) || typeof c.id !== 'string') continue;
    const key = `${c.type}:${c.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type: c.type, id: c.id.slice(0, 200), ...(c.boardId ? { boardId: c.boardId } : {}), ...(c.label ? { label: c.label.slice(0, 200) } : {}) });
  }
  return out.slice(0, 50);
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
