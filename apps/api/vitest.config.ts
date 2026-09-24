import { defineConfig } from 'vitest/config';
import { sharedConfig } from './vitest.shared.js';

/** Unit tests: no database, no Redis. */
export default defineConfig({
  ...sharedConfig,
  test: {
    include: ['test/**/*.spec.ts'],
    exclude: ['test/e2e/**'],
  },
});
