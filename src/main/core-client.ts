import { Worker } from 'node:worker_threads';
import type { CoreReply, CoreRequest, FileResponse } from './core-protocol.js';

type Pending = { resolve(value: unknown): void; reject(err: Error): void };
type Body = CoreRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;

/**
 * The main process's handle on the core worker. Requests are matched to replies by id. If the worker
 * dies, pending calls fail with a clear message and a fresh worker is started, so one bad request
 * (or a native crash in SQLite) costs an error toast rather than the app.
 */
export class CoreClient {
  private worker!: Worker;
  private ready!: Promise<void>;
  private next = 1;
  private readonly pending = new Map<number, Pending>();
  private closing = false;
  private restarts = 0;

  constructor(
    private readonly script: string,
    private readonly dataDir: string,
    private readonly onEvent: (channel: string, payload: unknown) => void,
  ) {
    this.start();
  }

  private start(): void {
    const worker = new Worker(this.script, { workerData: { dataDir: this.dataDir } });
    this.worker = worker;
    this.ready = new Promise((resolve, reject) => {
      const onReady = (msg: CoreReply): void => {
        if ('ready' in msg) {
          worker.off('message', onReady);
          resolve();
        }
      };
      worker.on('message', onReady);
      worker.once('error', reject);
      worker.once('exit', () => reject(new Error('The data core exited before it was ready.')));
    });
    // Unhandled until someone awaits it; a failed start is reported through call() instead.
    this.ready.catch(() => undefined);
    worker.on('message', (msg: CoreReply) => {
      if ('event' in msg) return this.onEvent(msg.event.channel, msg.event.payload);
      if (!('id' in msg)) return;
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new Error(msg.error));
    });
    worker.on('error', (err: Error) => this.fail(`The data core stopped: ${err.message}`));
    worker.on('exit', (code) => {
      this.fail('The data core stopped unexpectedly. Try again.');
      if (this.closing || this.worker !== worker) return;
      // Restart, but give up if it keeps dying on startup (a corrupt database, say) rather than spin.
      if (++this.restarts > 3) return this.onEvent('core-error', `The data core exited (code ${code}) and could not be restarted.`);
      this.onEvent('core-error', 'The data core restarted after a crash.');
      this.start();
    });
  }

  private fail(message: string): void {
    for (const p of this.pending.values()) p.reject(new Error(message));
    this.pending.clear();
  }

  private async call<T>(body: Body, transfer: ArrayBuffer[] = []): Promise<T> {
    if (this.closing) throw new Error('Loom is quitting.');
    await this.ready;
    const id = this.next++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker.postMessage({ ...body, id } as CoreRequest, transfer);
    });
  }

  rpc(request: unknown): Promise<unknown> {
    return this.call({ op: 'rpc', request });
  }

  upload(name: string, mime: string, bytes: Uint8Array): Promise<string> {
    return this.call({ op: 'upload', name, mime, bytes });
  }

  file(fileId: string, range: string | null): Promise<FileResponse> {
    return this.call({ op: 'file', fileId, range });
  }

  local(operation: string, input: unknown): Promise<{ status: number; body: unknown }> {
    return this.call({ op: 'local', operation, input });
  }

  /** Closes the database cleanly, then stops the thread. */
  async close(): Promise<void> {
    if (this.closing) return;
    await this.call({ op: 'close' }).catch(() => undefined);
    this.closing = true;
    await this.worker.terminate();
  }
}
