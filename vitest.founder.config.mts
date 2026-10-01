import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Live, read-only checks of what the founder console depends on. Not part of `npm test`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['e2e/**/*.live.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
});
