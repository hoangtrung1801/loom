import { build } from 'esbuild';

const shared = { bundle: true, platform: 'node', target: 'node22', format: 'cjs', external: ['electron'], sourcemap: true, logLevel: 'info' };
await build({ ...shared, entryPoints: ['src/main/main.ts'], outfile: 'dist/electron/main.cjs' });
await build({ ...shared, entryPoints: ['src/main/preload.ts'], outfile: 'dist/electron/preload.cjs' });
await build({ ...shared, entryPoints: ['server/main.ts'], outfile: 'dist/server/main.cjs' });
