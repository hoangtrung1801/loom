import { useEffect, useRef, useState } from 'react';
import type { CardDetail } from '../../core/store.js';
import { api, errorMessage } from '../api.js';
import { refresh, toast, useData } from './data.js';

const SAVE_DELAY_MS = 500;

export interface CardPatch {
  title?: string;
  content?: string;
}

/** Debounced per-card saves: views update instantly and the write follows. */
const pending = new Map<string, CardPatch & { timer: number }>();
const listeners = new Set<(cardId: string, patch: CardPatch) => void>();

/** Called synchronously on every edit so other views of the same card (board node, tab, panel) can follow along. */
export function subscribeEdits(fn: (cardId: string, patch: CardPatch) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function editCard(cardId: string, patch: CardPatch): void {
  listeners.forEach((fn) => fn(cardId, patch));
  const entry = pending.get(cardId) ?? { timer: 0 };
  Object.assign(entry, patch);
  window.clearTimeout(entry.timer);
  entry.timer = window.setTimeout(() => {
    void flushCard(cardId).then(refresh).catch((err) => {
      toast(errorMessage(err));
      void refresh();
    });
  }, SAVE_DELAY_MS);
  pending.set(cardId, entry);
}

async function flushCard(cardId: string): Promise<void> {
  const entry = pending.get(cardId);
  if (!entry) return;
  window.clearTimeout(entry.timer);
  pending.delete(cardId);
  await api.updateCard(cardId, { title: entry.title, content: entry.content });
}

export async function flushAll(): Promise<void> {
  await Promise.all([...pending.keys()].map(flushCard));
}

export function hasPendingSaves(): boolean {
  return pending.size > 0;
}
export function pendingPatch(cardId: string): CardPatch | undefined {
  return pending.get(cardId);
}
export function discardPending(cardId: string): void {
  const entry = pending.get(cardId);
  if (entry) window.clearTimeout(entry.timer);
  pending.delete(cardId);
}

/**
 * Loads a card and keeps it current: refetches when shared data changes, and applies this window's own
 * unsaved edits on top so typing is never overwritten by a stale read.
 */
export function useCardDetail(id: string | null): { card: CardDetail | null; loading: boolean } {
  const version = useData((s) => s.version);
  const [card, setCard] = useState<CardDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const current = useRef(id);
  current.current = id;

  useEffect(() => {
    if (!id) {
      setCard(null);
      setLoading(false);
      return;
    }
    let live = true;
    void api.getCard(id).then((fresh) => {
      if (!live || current.current !== id) return;
      const p = pendingPatch(id);
      setCard(fresh && p ? { ...fresh, ...(p.title !== undefined ? { title: p.title } : {}), ...(p.content !== undefined ? { content: p.content } : {}) } : fresh);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [id, version]);

  useEffect(() => {
    if (!id) return;
    return subscribeEdits((cardId, patch) => {
      if (cardId === id) setCard((c) => (c ? { ...c, ...patch } : c));
    });
  }, [id]);

  return { card: card && card.id === id ? card : null, loading };
}
