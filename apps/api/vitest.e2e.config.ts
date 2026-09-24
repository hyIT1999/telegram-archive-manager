import { defineConfig } from 'vitest/config';
import { sharedConfig } from './vitest.shared.js';

/**
 * HTTP end-to-end tests against the real AppModule, a throwaway PostgreSQL database
 * (tam_test_api, recreated by globalSetup) and Redis database 15.
 */
export default defineConfig({
  ...sharedConfig,
  test: {
    include: ['test/e2e/**/*.e2e-spec.ts'],
    globalSetup: ['test/e2e/global-setup.ts'],
    setupFiles: ['test/e2e/setup-env.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 180_000,
  },
});
