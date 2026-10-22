import type { Api } from '../core/rpc.js';

declare global {
  interface Window {
    /** Present in Electron (via preload); absent when the UI runs in a plain browser during development. */
    loom?: { rpc(request: unknown): Promise<unknown> };
  }
}

async function httpCall(request: unknown): Promise<unknown> {
  const res = await fetch('/rpc', { method: 'POST', headers: { 'content-type': 'application/json', 'x-loom': '1' }, body: JSON.stringify(request) });
  const body = (await res.json()) as unknown;
  if (!res.ok) throw new Error((body as { error?: string } | null)?.error ?? `Request failed (${res.status})`);
  return body;
}

const call = (request: unknown): Promise<unknown> => (window.loom ? window.loom.rpc(request) : httpCall(request));

/** `api.createCard(...)` becomes `rpc({ method: 'createCard', args })`; types come from the Store itself. */
export const api = new Proxy({} as Api, {
  get: (_t, method: string) => (...args: unknown[]) => call({ method, args }),
});

export function errorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/^Error invoking remote method 'rpc': (Error: )?/, '');
}
