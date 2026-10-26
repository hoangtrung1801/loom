import type { CardKind } from '../core/store.js';
import { docxToMarkdown } from '../core/docx.js';
import { markdownToContent } from '../core/markdown.js';
import { api, errorMessage, uploadFile } from './api.js';
import { todayIso } from './editor/commands.js';
import { flushAll } from './store/edits.js';
import { mutate, refresh, toast, useData } from './store/data.js';
import { useTabs, type AppId, type TabType } from './store/tabs.js';

export const DRAG_MIME = 'application/x-loom-card';

export const openApp = (app: AppId, newTab = false): void => useTabs.getState().open('app', app, { newTab });
export const openCard = (id: string, newTab = false): void => useTabs.getState().open('card', id, { newTab });
export const openBoard = (id: string, focus?: string, newTab = false): void => useTabs.getState().open('whiteboard', id, { newTab, focus });
export const openTag = (tag: string, newTab = false): void => useTabs.getState().open('tag', tag, { newTab });
export const openChatTab = (id: string): void => useTabs.getState().open('chat', id);
export const openNewTab = (): void => useTabs.getState().open('newtab', '', { newTab: true });

/** Cmd+N: a fresh card lands in the inbox and opens for writing. */
export async function newCard(options: { open?: boolean; title?: string } = {}): Promise<string | undefined> {
  const id = await mutate(() => api.createCard({ inbox: true, title: options.title ?? '' }));
  if (id && options.open !== false) openCard(id);
  return id;
}

/** A task with the Acceptance criteria / Plan / Notes headings, opened for editing. */
export async function newTask(options: { open?: boolean; title?: string; status?: string; parentId?: string } = {}): Promise<string | undefined> {
  const id = await mutate(() => api.createWorkTask({ title: options.title ?? NEW_TASK_TITLE, status: options.status, parentId: options.parentId, scaffold: options.title === undefined }));
  if (id && options.open !== false) openCard(id);
  return id;
}
export const NEW_TASK_TITLE = 'New task';

/** Quick capture: a memo is just the text, no title. */
export async function newMemo(text: string): Promise<string | undefined> {
  return mutate(() => api.addMemo(text));
}

export async function newBoard(name = 'Untitled whiteboard', parentId = ''): Promise<string | undefined> {
  const id = await mutate(() => api.createWhiteboard(name, parentId));
  if (id) openBoard(id);
  return id;
}

export async function openJournal(date = todayIso()): Promise<void> {
  const id = await mutate(() => api.ensureJournal(date));
  if (id) openCard(id);
}

/** Opens the card with this title, creating it when missing (what clicking a [[wikilink]] does). */
export async function openByTitle(title: string): Promise<void> {
  try {
    await flushAll();
    const found = await api.findCardByTitle(title);
    if (found) return openCard(found);
    const id = await api.createCard({ title });
    await refresh();
    openCard(id);
  } catch (err) {
    toast(errorMessage(err));
  }
}

export async function trashCard(id: string): Promise<void> {
  await flushAll(); // keep what was just typed, so the trash entry has its title
  await mutate(() => api.trashCard(id));
  pruneTabs();
}

export async function trashBoard(id: string): Promise<void> {
  await mutate(() => api.trashWhiteboard(id));
  pruneTabs();
}

/** Closes tabs that point at things that no longer exist. */
export function pruneTabs(): void {
  const { index, boards, chats } = useData.getState();
  const cards = new Set(index.map((c) => c.id));
  const bs = new Set(boards.map((b) => b.id));
  const cs = new Set(chats.map((c) => c.id));
  useTabs.getState().prune((type: TabType, ref: string) => {
    switch (type) {
      case 'card': return cards.has(ref);
      case 'whiteboard': return bs.has(ref);
      case 'tag': return true; // a tag with no cards is still a valid page
      case 'chat': return cs.has(ref);
      default: return true;
    }
  });
}

export function cardTitle(id: string): string {
  return useData.getState().index.find((c) => c.id === id)?.title || 'Untitled';
}

export function kindForFile(file: Pick<File, 'name' | 'type'>): CardKind | 'text' | 'docx' {
  const name = file.name.toLowerCase();
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (name.endsWith('.docx') || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  if (/\.(md|markdown|txt)$/.test(name) || file.type === 'text/markdown' || file.type === 'text/plain') return 'text';
  return 'file';
}

/**
 * Turns dropped or picked files into cards: markdown and text become editable notes, everything else is stored
 * as an attachment card. Returns the new card ids; when a board is given they are also placed on it.
 */
export async function importFiles(files: File[], target?: { boardId: string; x: number; y: number }): Promise<string[]> {
  const ids: string[] = [];
  let offset = 0;
  for (const file of files) {
    try {
      const kind = kindForFile(file);
      const title = file.name.replace(/\.[^.]+$/, '');
      let id: string;
      if (kind === 'text') {
        const text = await file.text();
        const heading = /^#\s+(.+)$/m.exec(text);
        id = await api.createCard({ title: heading ? heading[1]!.trim() : title, content: markdownToContent(heading ? text.replace(heading[0], '').trimStart() : text), inbox: true });
      } else if (kind === 'docx') {
        const text = await docxToMarkdown(new Uint8Array(await file.arrayBuffer()));
        const heading = /^#\s+(.+)$/m.exec(text);
        id = await api.createCard({ title: heading ? heading[1]!.trim() : title, content: markdownToContent(heading ? text.replace(heading[0], '').trimStart() : text), inbox: true });
      } else {
        const fileId = await uploadFile(file);
        id = await api.createCard({ title, kind, fileId, inbox: true });
      }
      ids.push(id);
      if (target) await api.addCardToWhiteboard(target.boardId, id, target.x + offset, target.y + offset);
      offset += 40;
    } catch (err) {
      toast(`${file.name}: ${errorMessage(err)}`);
    }
  }
  await refresh();
  return ids;
}
