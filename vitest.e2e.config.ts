import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { globalSetup: ['./tests/require-sqlite.ts'], include: ['e2e/**/*.e2e.ts'], environment: 'node', testTimeout: 30_000, hookTimeout: 60_000, fileParallelism: false } });
