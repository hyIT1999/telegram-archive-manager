// ESLint flat config for the Angular app. ESLint 10 resolves the closest config per file,
// so this file (not the Node-oriented root config) applies to everything under apps/web.
import js from '@eslint/js';
import angular from 'angular-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['dist/**', '.angular/**', 'coverage/**', 'out-tsc/**']),
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended, angular.configs.tsRecommended],
    processor: angular.processInlineTemplates,
    languageOptions: {
      globals: globals.browser,
      // Explicit: the root config is loaded in the same run, so the root cannot be inferred.
      parserOptions: { tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: 'app', style: 'kebab-case' },
      ],
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'app', style: 'camelCase' },
      ],
      '@angular-eslint/prefer-output-readonly': 'error',
      '@angular-eslint/no-duplicates-in-metadata-arrays': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'always'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['**/*.html'],
    extends: [angular.configs.templateRecommended, angular.configs.templateAccessibility],
    rules: {
      '@angular-eslint/template/prefer-self-closing-tags': 'error',
      '@angular-eslint/template/no-duplicate-attributes': 'error',
      '@angular-eslint/template/button-has-type': 'error',
    },
  },
  {
    files: ['**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
  {
    // Static scripts served to the browser as-is (e.g. theme-init.js).
    files: ['public/**/*.js'],
    languageOptions: { globals: globals.browser, sourceType: 'script' },
  },
);
