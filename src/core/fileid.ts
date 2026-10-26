const HASH = /^[0-9a-f]{64}$/;

/** Attachment ids are SHA-256 hex digests; anything else is never turned into a URL or a path. */
export function isFileId(id: unknown): id is string {
  return typeof id === 'string' && HASH.test(id);
}
