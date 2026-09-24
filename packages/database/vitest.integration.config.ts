import { defineConfig } from 'vitest/config';

/** Runs against a real PostgreSQL database (tam_test_db) that globalSetup recreates and migrates. */
export default defineConfig({
  test: {
    include: ['test/integration/**/*.int.spec.ts'],
    globalSetup: ['test/integration/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 180_000,
  },
});
