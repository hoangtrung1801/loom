/** Vitest global setup: fail with a clear message instead of "ResolveMessage {}" on runtimes without node:sqlite. */
export default async function requireSqlite(): Promise<void> {
  try {
    await import('node:sqlite');
  } catch {
    throw new Error('Loom needs the built-in node:sqlite module. Use Bun >= 1.4 (run `bun upgrade`) or Node >= 22.13.');
  }
}
