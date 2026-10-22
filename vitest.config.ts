import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { globalSetup: ['./tests/require-sqlite.ts'], include: ['tests/**/*.test.ts'], environment: 'node' } });
