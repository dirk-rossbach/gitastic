import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['apps/server/test/**/*.test.ts', 'packages/**/*.test.ts'],
    setupFiles: ['apps/server/test/setup.ts'],
    testTimeout: 45_000,
    hookTimeout: 45_000,
    pool: 'forks',
  },
});
