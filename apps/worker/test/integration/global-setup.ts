import path from 'node:path';
import { migrateDeploy, recreateDatabase, withDatabaseName } from '@tam/database';
import type { TestProject } from 'vitest/node';
import { loadEnvFiles } from '../../src/config/env-files.js';
import { clearTestKeys, TEST_DATABASE, TEST_REDIS_DB, withRedisDb } from './test-env.js';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
    redisUrl: string;
  }
}

/**
 * Derives the test URLs from the root .env (the real environment wins), re-creates and migrates
 * the test database, and clears the test Redis database. process.env stays untouched, so the
 * development URLs never reach the tests.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const env: Record<string, string | undefined> = { ...process.env };
  loadEnvFiles([path.resolve(import.meta.dirname, '../../../../.env')], env);
  if (!env.DATABASE_URL || !env.REDIS_URL) {
    throw new Error('DATABASE_URL and REDIS_URL must be set (root .env) to run integration tests');
  }

  const databaseUrl = withDatabaseName(env.DATABASE_URL, TEST_DATABASE);
  const redisUrl = withRedisDb(env.REDIS_URL, TEST_REDIS_DB);
  await recreateDatabase(databaseUrl);
  await migrateDeploy(databaseUrl);
  await clearTestKeys(redisUrl);

  project.provide('databaseUrl', databaseUrl);
  project.provide('redisUrl', redisUrl);
  return () => clearTestKeys(redisUrl);
}
