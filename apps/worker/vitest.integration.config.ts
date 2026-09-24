import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Runs against real services: PostgreSQL database `tam_test_worker` (re-created and migrated by
 * globalSetup) and Redis database 14 with BullMQ prefix `tamtestw`.
 */
export default defineConfig({
  // SWC instead of Vite's default transform: Nest dependency injection needs decorator metadata.
  plugins: [
    swc.vite({
      tsconfigFile: false,
      include: /\.ts$/,
      module: { type: 'es6' },
      jsc: {
        target: 'es2024',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        keepClassNames: true,
      },
    }),
  ],
  test: {
    include: ['test/integration/**/*.int.spec.ts'],
    globalSetup: ['test/integration/global-setup.ts'],
    setupFiles: ['test/integration/setup-env.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 180_000,
  },
});
