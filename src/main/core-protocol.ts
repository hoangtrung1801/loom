import type { FileResponse } from '../core/serve-file.js';

/** Messages from the main process to the core worker. Every request carries an id its reply echoes. */
export type CoreRequest =
  | { id: number; op: 'rpc'; request: unknown }
  | { id: number; op: 'upload'; name: string; mime: string; bytes: Uint8Array }
  | { id: number; op: 'file'; fileId: string; range: string | null }
  | { id: number; op: 'local'; operation: string; input: unknown }
  | { id: number; op: 'close' };

/** Messages from the core worker: a reply, a pushed event, or the one-time ready signal. */
export type CoreReply =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string }
  | { event: { channel: string; payload: unknown } }
  | { ready: true };

export type { FileResponse };
