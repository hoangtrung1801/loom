import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { globalSetup: ['./tests/require-sqlite.ts'], include: ['e2e/**/*.electron.ts'], environment: 'node', testTimeout: 60_000, hookTimeout: 60_000, fileParallelism: false } });
