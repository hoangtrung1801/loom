// Imports a Know-Me workspace into a Loom library.
// Usage: bun scripts/import-knowme.ts <path to .knowns or a Know-Me repo> [--data-dir DIR] [--dry-run]
// Close Loom first: the import writes straight into the library folder.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { importKnowMe } from '../src/core/import-knowme.js';
import { openLibrary } from '../src/core/library.js';
import { Store } from '../src/core/store.js';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? undefined : args[i + 1];
};
const dryRun = args.includes('--dry-run');
const source = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--data-dir');

const defaultDataDir = (): string => {
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Loom');
  if (process.platform === 'win32') return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Loom');
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'Loom');
};

if (!source || args.includes('--help')) {
  console.log('Usage: bun scripts/import-knowme.ts <know-me folder> [--data-dir DIR] [--dry-run]\n\nThe folder holds tasks/, links/, memos/ and docs/ (a Know-Me repository, or its .knowns folder).\nDefault data dir: $LOOM_DATA_DIR, else Loom\'s app data folder. Quit Loom before importing.');
  process.exit(source ? 0 : 2);
}

let root = resolve(source);
if (!existsSync(join(root, 'tasks')) && existsSync(join(root, '.knowns'))) root = join(root, '.knowns');
if (!['tasks', 'links', 'memos', 'docs'].some((d) => existsSync(join(root, d)))) {
  console.error(`${root} does not look like a Know-Me workspace (no tasks/, links/, memos/ or docs/).`);
  process.exit(2);
}

const dataDir = resolve(flag('data-dir') ?? process.env.LOOM_DATA_DIR ?? defaultDataDir());
const store = dryRun ? new Store(':memory:') : openLibrary(dataDir);
try {
  const report = importKnowMe(store, root);
  console.log(`${dryRun ? 'Dry run (nothing written)' : `Imported into ${dataDir}`}\n  tasks ${report.tasks}\n  links ${report.links}\n  memos ${report.memos}\n  docs  ${report.docs}\n  already there ${report.skipped}`);
  if (report.problems.length) console.log(`\n${report.problems.length} skipped:\n${report.problems.map((p) => `  ${p}`).join('\n')}`);
} finally {
  store.close();
}
