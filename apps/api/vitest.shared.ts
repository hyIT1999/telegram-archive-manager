import { fileURLToPath } from 'node:url';
import swc from 'unplugin-swc';
import type { ViteUserConfig } from 'vitest/config';

const packagesDir = new URL('../../packages/', import.meta.url);
const packageSource = (relativePath: string): string =>
  fileURLToPath(new URL(relativePath, packagesDir));

/**
 * Shared by the unit and e2e configs:
 * - SWC instead of Vite's TypeScript transform, because Nest dependency injection needs the
 *   decorator metadata (`design:paramtypes`) that only SWC/tsc emit;
 * - workspace packages resolve to their TypeScript sources, so tests never run stale builds.
 */
export const sharedConfig = {
  plugins: [
    swc.vite({
      include: /\.[cm]?ts$/,
      tsconfigFile: false,
      module: { type: 'es6' },
      jsc: {
        target: 'es2024',
        keepClassNames: true,
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  resolve: {
    alias: [
      { find: /^@tam\/database\/nest$/, replacement: packageSource('database/src/nest.ts') },
      { find: /^@tam\/database$/, replacement: packageSource('database/src/index.ts') },
      { find: /^@tam\/shared$/, replacement: packageSource('shared/src/index.ts') },
      { find: /^@tam\/crypto$/, replacement: packageSource('crypto/src/index.ts') },
      { find: /^@tam\/storage\/testing$/, replacement: packageSource('storage/src/testing/index.ts') },
      { find: /^@tam\/storage$/, replacement: packageSource('storage/src/index.ts') },
    ],
  },
} satisfies ViteUserConfig;
