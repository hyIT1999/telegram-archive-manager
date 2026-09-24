import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

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
    include: ['test/**/*.spec.ts'],
    exclude: ['test/integration/**'],
  },
});
