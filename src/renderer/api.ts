import type { Api } from '../core/rpc.js';

declare global {
  interface Window {
    /** Present in Electron (via preload); absent when the UI runs in a plain browser during development. */
    loom?: {
      rpc(request: unknown): Promise<unknown>;
      upload(name: string, mime: string, bytes: Uint8Array): Promise<string>;
      onEvent(listener: (event: { channel: string; payload: unknown }) => void): () => void;
    };
  }
}

async function httpCall(request: unknown): Promise<unknown> {
  const res = await fetch('/rpc', { method: 'POST', headers: { 'content-type': 'application/json', 'x-loom': '1' }, body: JSON.stringify(request) });
  const body = (await res.json()) as unknown;
  if (!res.ok) throw new Error((body as { error?: string } | null)?.error ?? `Request failed (${res.status})`);
  return body;
}

const call = (request: unknown): Promise<unknown> => (window.loom ? window.loom.rpc(request) : httpCall(request));

/** `api.createCard(...)` becomes `rpc({ method: 'createCard', args })`; types come from the core itself. */
export const api = new Proxy({} as Api, {
  get: (_t, method: string) => (...args: unknown[]) => call({ method, args }),
});

export function errorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/^Error invoking remote method '[a-z-]+': (Error: )?/, '');
}

// ------------------------------------------------------------------ files

/** URL the page can load an attachment from. */
export const fileUrl = (id: string): string => (window.loom ? `loom-file://${id}` : `/file/${id}`);

export async function uploadFile(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (window.loom) return window.loom.upload(file.name, file.type || 'application/octet-stream', bytes);
  const res = await fetch('/upload', {
    method: 'POST',
    headers: { 'x-loom': '1', 'x-name': encodeURIComponent(file.name), 'content-type': file.type || 'application/octet-stream' },
    body: bytes,
  });
  const body = (await res.json()) as unknown;
  if (!res.ok) throw new Error((body as { error?: string } | null)?.error ?? 'Upload failed');
  return body as string;
}

// ----------------------------------------------------------------- events

type Listener = (payload: unknown) => void;
const listeners = new Map<string, Set<Listener>>();
let started = false;

function dispatch(channel: string, payload: unknown): void {
  listeners.get(channel)?.forEach((fn) => fn(payload));
}

/** Subscribes to events pushed by the core (streamed AI output). Returns an unsubscribe function. */
export function onEvent(channel: string, fn: Listener): () => void {
  if (!started) {
    started = true;
    if (window.loom) window.loom.onEvent((e) => dispatch(e.channel, e.payload));
    else {
      const source = new EventSource('/events');
      source.onmessage = (m) => {
        try {
          const e = JSON.parse(m.data) as { channel: string; payload: unknown };
          dispatch(e.channel, e.payload);
        } catch {
          /* ignore malformed frames */
        }
      };
    }
  }
  const set = listeners.get(channel) ?? new Set();
  set.add(fn);
  listeners.set(channel, set);
  return () => set.delete(fn);
}
