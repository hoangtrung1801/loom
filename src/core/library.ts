import { existsSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from './store.js';

/** Folder, inside the app's data directory, that holds the JSON library. */
export const LIBRARY_DIR = 'library';
/** The SQLite file earlier versions of Loom kept their data in. */
export const LEGACY_DB = 'loom.db';

/**
 * Opens the library in `dataDir`. The first time a newer Loom starts on data from a version that kept
 * everything in SQLite, that database is converted to JSON files and set aside as `loom.db.imported`.
 */
export function openLibrary(dataDir: string): Store {
  const dir = join(dataDir, LIBRARY_DIR);
  const legacy = join(dataDir, LEGACY_DB);
  if (!existsSync(join(dir, 'loom.json')) && existsSync(legacy)) importLegacy(legacy, dir);
  return Store.open(dir);
}

function importLegacy(dbPath: string, dir: string): void {
  // Build the library next door and move it into place at the end, so an interrupted import starts over.
  const staging = `${dir}.importing`;
  rmSync(staging, { recursive: true, force: true });
  const old = new Store(dbPath);
  try {
    old.writeLibrary(staging);
  } finally {
    old.close();
  }
  rmSync(dir, { recursive: true, force: true });
  renameSync(staging, dir);
  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(dbPath + suffix)) renameSync(dbPath + suffix, `${dbPath}${suffix}.imported`);
  }
}
