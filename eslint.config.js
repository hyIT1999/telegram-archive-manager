// Root ESLint flat config for the Node side (packages/*, apps/api, apps/worker).
// ESLint 10 resolves the config per file, so apps/web uses its own apps/web/eslint.config.js.
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores([
    '**/dist/**',
    '**/node_modules/**',
    '**/coverage/**',
    '**/.angular/**',
    'packages/database/src/generated/**',
  ]),
  {
    files: ['**/*.{ts,mts,cts}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        // Explicit because `eslint .` also loads apps/web/eslint.config.js: with two config
        // directories typescript-eslint can no longer infer the root on its own.
        tsconfigRootDir: import.meta.dirname,
        // Keeps type-import rules aware that Nest DI needs runtime class imports.
        emitDecoratorMetadata: true,
        experimentalDecorators: true,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-extraneous-class': 'off',
      eqeqeq: ['error', 'always'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // CLIs and scripts talk to the terminal.
    files: ['**/src/cli/**/*.ts', 'scripts/**'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
);
