import { build } from 'esbuild';
import { copyFileSync } from 'node:fs';

const shared = { bundle: true, platform: 'node', target: 'node24', format: 'cjs', external: ['electron'], sourcemap: true, logLevel: 'info' };
await build({ ...shared, entryPoints: ['src/main/main.ts'], outfile: 'dist/electron/main.cjs' });
await build({ ...shared, entryPoints: ['src/main/preload.ts'], outfile: 'dist/electron/preload.cjs' });
await build({ ...shared, entryPoints: ['src/main/core-worker.ts'], outfile: 'dist/electron/core-worker.cjs' });
// The `loom` command-line client: plain Node, no dependencies.
await build({ ...shared, entryPoints: ['src/cli/loom.ts'], outfile: 'dist/cli/loom.cjs', banner: { js: '#!/usr/bin/env node' } });
// The window icon (Linux and Windows take it from the BrowserWindow; macOS uses the bundle icon).
copyFileSync('build/icon.png', 'dist/electron/icon.png');
