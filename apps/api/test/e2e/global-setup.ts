import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { migrateDeploy, recreateDatabase, withDatabaseName } from '@tam/database';
import type { TestProject } from 'vitest/node';
import { envFileParser, envFilePaths } from '../../src/config/env-files.js';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
    redisUrl: string;
  }
}

/** Owned by this suite only, so it never races other test projects on DROP/CREATE. */
const E2E_DATABASE = 'tam_test_api';
/** Separate logical Redis database; the suite never flushes it (other suites may share it). */
const E2E_REDIS_DB = 15;

const apiRoot = fileURLToPath(new URL('../../', import.meta.url));

type BaseSetting = 'DATABASE_URL' | 'REDIS_URL';

/** Real environment variables first, then the root .env — read without touching process.env. */
function baseSetting(name: BaseSetting): string {
  const fromEnvironment = process.env[name];
  if (fromEnvironment) {
    return fromEnvironment;
  }
  const parse = envFileParser([name]);
  for (const file of envFilePaths(apiRoot)) {
    const value: unknown = existsSync(file) ? parse(readFileSync(file))[name] : undefined;
    if (typeof value === 'string' && value !== '') {
      return value;
    }
  }
  throw new Error(`${name} must be set (root .env) to run the api e2e tests`);
}

function withRedisDatabase(redisUrl: string, db: number): string {
  const url = new URL(redisUrl);
  url.pathname = `/${db}`;
  return url.toString();
}

export default async function setup(project: TestProject): Promise<void> {
  const databaseUrl = withDatabaseName(baseSetting('DATABASE_URL'), E2E_DATABASE);
  await recreateDatabase(databaseUrl);
  await migrateDeploy(databaseUrl);
  project.provide('databaseUrl', databaseUrl);
  project.provide('redisUrl', withRedisDatabase(baseSetting('REDIS_URL'), E2E_REDIS_DB));
}
