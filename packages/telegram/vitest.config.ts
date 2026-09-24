import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@mtcute/web': fileURLToPath(new URL('./test/support/mtcute-web-shim.ts', import.meta.url)),
    },
  },
  test: {
    include: ['test/**/*.spec.ts'],
    // Every worker loads mtcute's full TL schema; keep memory bounded on shared dev machines.
    maxWorkers: 2,
    // Processed by Vitest (not loaded by Node directly) so the alias above applies to it.
    server: { deps: { inline: ['@mtcute/test'] } },
  },
});
