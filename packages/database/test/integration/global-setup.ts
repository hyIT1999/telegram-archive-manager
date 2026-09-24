import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import type { TestProject } from 'vitest/node';
import { migrateDeploy, recreateDatabase, withDatabaseName } from '../../src/admin.js';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

/** Each test project owns its database, so projects never race on DROP/CREATE. */
const TEST_DATABASE = 'tam_test_db';

export default async function setup(project: TestProject): Promise<void> {
  loadEnv({ path: path.resolve(import.meta.dirname, '../../../../.env'), quiet: true });
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) {
    throw new Error('DATABASE_URL must be set (root .env) to run integration tests');
  }
  const databaseUrl = withDatabaseName(baseUrl, TEST_DATABASE);
  await recreateDatabase(databaseUrl);
  await migrateDeploy(databaseUrl);
  project.provide('databaseUrl', databaseUrl);
}
