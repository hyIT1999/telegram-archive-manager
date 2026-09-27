import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { defineConfig } from '@playwright/test';
import {
  ACCOUNT_OWNER,
  BASE_URL,
  E2E_DATABASE,
  E2E_PREFIX,
  E2E_REDIS_DB,
  PORT,
  READER,
} from './tests/settings.js';

// Browser tests of the built web app, served by the built api against a seeded test database
// (support/serve.mjs). Build first: npm run build. The database and Redis credentials come from
// the environment or the root .env, like the other test suites; nothing else from it is used.
const root = path.resolve(import.meta.dirname, '..', '..');
const dotenvFile = path.join(root, '.env');
const dotenv = existsSync(dotenvFile) ? parseEnv(readFileSync(dotenvFile, 'utf8')) : {};

function setting(name: 'DATABASE_URL' | 'REDIS_URL'): URL {
  const value = process.env[name] || dotenv[name];
  if (!value) {
    throw new Error(`${name} must be set (root .env) to run the browser tests`);
  }
  return new URL(value);
}

const databaseUrl = setting('DATABASE_URL');
databaseUrl.pathname = `/${E2E_DATABASE}`;
const redisUrl = setting('REDIS_URL');
redisUrl.pathname = `/${E2E_REDIS_DB}`;
// Tests read the database too (tests/database.ts); workers inherit this process's environment.
process.env['E2E_DATABASE_URL'] = databaseUrl.toString();

/** The installed Google Chrome by default; PW_CHANNEL=bundled uses Playwright's own Chromium (CI). */
const channel =
  process.env['PW_CHANNEL'] === 'bundled' ? undefined : (process.env['PW_CHANNEL'] ?? 'chrome');

export default defineConfig({
  testDir: './tests',
  // One archive, one api: the tests run one after the other.
  fullyParallel: false,
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: BASE_URL,
    channel,
    headless: true,
    locale: 'en-US',
    timezoneId: 'UTC',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node support/serve.mjs',
    url: `${BASE_URL}/api/health/live`,
    timeout: 180_000,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      E2E_DATABASE_URL: databaseUrl.toString(),
      E2E_REDIS_URL: redisUrl.toString(),
      E2E_PREFIX,
      E2E_STORAGE_DIR: path.join(tmpdir(), 'tam-e2e-storage'),
      E2E_PORT: String(PORT),
      E2E_USERS: JSON.stringify([READER, ACCOUNT_OWNER]),
    },
  },
});
