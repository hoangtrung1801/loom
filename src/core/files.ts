import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Store } from './store.js';

export const MAX_FILE_BYTES = 512 * 1024 * 1024;
const HASH = /^[0-9a-f]{64}$/;

/** Types served with their own content type. Anything else is sent as an opaque download so a hostile file can't run as a page. */
const SAFE_MIME = new Set([
  'application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp', 'image/svg+xml',
  'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/flac', 'audio/aac', 'audio/x-m4a',
  'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'text/plain', 'text/markdown', 'text/csv',
]);

export interface FileInfo {
  id: string;
  name: string;
  mime: string;
  size: number;
  local: boolean;
}

export function isFileId(id: unknown): id is string {
  return typeof id === 'string' && HASH.test(id);
}

export function safeMime(mime: string): string {
  const m = mime.toLowerCase().split(';')[0]!.trim();
  return SAFE_MIME.has(m) ? m : 'application/octet-stream';
}

/**
 * Attachments live on disk under their SHA-256, so identical files are stored once and every device agrees
 * on a file's id without coordination. Metadata (name, type, size) syncs through the op log; bytes sync separately.
 */
export class Files {
  constructor(
    private readonly store: Store,
    private readonly dir: string | null,
  ) {
    if (dir) mkdirSync(dir, { recursive: true });
  }

  private pathOf(id: string): string {
    if (!this.dir) throw new Error('File storage is not available.');
    if (!isFileId(id)) throw new Error('Invalid file id.');
    return join(this.dir, id.slice(0, 2), id);
  }

  pathFor(id: string): string {
    return this.pathOf(id);
  }

  has(id: string): boolean {
    return !!this.dir && isFileId(id) && existsSync(this.pathOf(id));
  }

  /** Stores bytes and registers them; returns the file id. */
  put(bytes: Uint8Array, meta: { name: string; mime: string }): string {
    if (bytes.byteLength > MAX_FILE_BYTES) throw new Error('That file is too large (limit 512 MB).');
    const id = createHash('sha256').update(bytes).digest('hex');
    this.writeBytes(id, bytes);
    const existing = this.store.get('SELECT 1 AS x FROM files WHERE id = ? AND deleted_at IS NULL', id);
    if (!existing) {
      this.store.commit([
        { entity: 'file', id, fields: { name: meta.name.slice(0, 255), mime: safeMime(meta.mime), size: bytes.byteLength, created_at: Date.now(), deleted_at: null } },
      ]);
    }
    return id;
  }

  /** Stores bytes fetched from another device; the hash must match the id. */
  putVerified(id: string, bytes: Uint8Array): void {
    if (!isFileId(id) || createHash('sha256').update(bytes).digest('hex') !== id) throw new Error('File does not match its id.');
    this.writeBytes(id, bytes);
  }

  private writeBytes(id: string, bytes: Uint8Array): void {
    const target = this.pathOf(id);
    if (existsSync(target)) return;
    mkdirSync(join(target, '..'), { recursive: true });
    const tmp = `${target}.${process.pid}.tmp`;
    writeFileSync(tmp, bytes);
    renameSync(tmp, target);
  }

  read(id: string): Buffer {
    return readFileSync(this.pathOf(id));
  }

  size(id: string): number {
    return statSync(this.pathOf(id)).size;
  }

  info(id: string): FileInfo | null {
    const r = this.store.get('SELECT id, name, mime, size FROM files WHERE id = ? AND deleted_at IS NULL', id);
    return r ? { id: r.id, name: r.name, mime: r.mime, size: r.size, local: this.has(id) } : null;
  }

  /** Files whose metadata arrived by sync but whose bytes are not on this device yet. */
  missing(): string[] {
    return this.store
      .all('SELECT id FROM files WHERE deleted_at IS NULL')
      .map((r) => r.id as string)
      .filter((id) => isFileId(id) && !this.has(id));
  }

  /** Files this device has bytes for; the sync layer uploads any the server lacks. */
  local(): string[] {
    return this.store
      .all('SELECT id FROM files WHERE deleted_at IS NULL')
      .map((r) => r.id as string)
      .filter((id) => this.has(id));
  }
}
