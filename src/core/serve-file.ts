import { closeSync, openSync, readSync } from 'node:fs';
import { isFileId } from './fileid.js';
import type { Files } from './files.js';

export interface FileResponse {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array | null;
}

/**
 * Builds the response for one attachment, honouring a single byte range so audio and video can seek.
 * Shared by the Electron protocol handler and the dev server.
 */
export function serveFile(files: Files, id: string, range: string | null): FileResponse {
  const info = isFileId(id) ? files.info(id) : null;
  if (!info || !files.has(id)) return { status: 404, headers: {}, body: null };
  const size = files.size(id);
  const headers: Record<string, string> = {
    'content-type': info.mime,
    'x-content-type-options': 'nosniff',
    'accept-ranges': 'bytes',
    'cache-control': 'private, max-age=31536000, immutable',
    // A file opened on its own can never run script or reach the app.
    'content-security-policy': "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox",
  };
  if (info.mime === 'application/octet-stream') headers['content-disposition'] = `attachment; filename="${encodeURIComponent(info.name)}"`;
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (!m || (!m[1] && !m[2])) {
    return { status: 200, headers: { ...headers, 'content-length': String(size) }, body: files.read(id) };
  }
  let start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  let end = m[1] && m[2] ? Number(m[2]) : size - 1;
  end = Math.min(end, size - 1);
  if (start > end || start >= size) return { status: 416, headers: { ...headers, 'content-range': `bytes */${size}` }, body: null };
  start = Math.max(0, start);
  const body = new Uint8Array(end - start + 1);
  const fd = openSync(files.pathFor(id), 'r');
  try {
    readSync(fd, body, 0, body.length, start);
  } finally {
    closeSync(fd);
  }
  return { status: 206, headers: { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': String(body.length) }, body };
}
