// Started by Playwright (webServer): a fresh test database holding a small archive, then the built
// api in this process, serving the built web app on one port like production (pm2) does.
// No worker runs: nothing reaches Telegram.
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createPrismaClient, migrateDeploy, recreateDatabase } from '@tam/database';
import { Redis } from 'ioredis';
import { seedArchive } from './seed.mjs';

const root = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const {
  E2E_DATABASE_URL: databaseUrl,
  E2E_REDIS_URL: redisUrl,
  E2E_PREFIX: prefix,
  E2E_STORAGE_DIR: storageDir,
  E2E_PORT: port,
  E2E_USERS: usersJson,
} = process.env;
const webDist = path.join(root, 'apps', 'web', 'dist', 'web', 'browser');
const apiMain = path.join(root, 'apps', 'api', 'dist', 'main.js');

for (const built of [path.join(webDist, 'index.html'), apiMain]) {
  if (!existsSync(built)) {
    console.error(`${built} is missing: run npm run build first (or npm run test:e2e:full).`);
    process.exit(1);
  }
}

rmSync(storageDir, { recursive: true, force: true });
mkdirSync(storageDir, { recursive: true });
await recreateDatabase(databaseUrl);
await migrateDeploy(databaseUrl);

// Sign-in lockouts and queues of an earlier run.
const redis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
await redis.connect();
const stale = await redis.keys(`${prefix}:*`);
if (stale.length > 0) {
  await redis.del(...stale);
}
redis.disconnect();

const { hashPassword } = await import(
  pathToFileURL(path.join(root, 'apps', 'api', 'dist', 'auth', 'password.js')).href
);
const prisma = createPrismaClient({ url: databaseUrl, max: 2, applicationName: 'tam-e2e-seed' });
try {
  await seedArchive(prisma, { storageDir, users: JSON.parse(usersJson), hashPassword });
} finally {
  await prisma.$disconnect();
}

// Real variables win over the developer's .env, and an empty one counts as unset: no Google
// Drive, no storage key, nothing but what the tests need.
Object.assign(process.env, {
  NODE_ENV: 'production',
  LOG_LEVEL: 'warn',
  DATABASE_URL: databaseUrl,
  REDIS_URL: redisUrl,
  BULLMQ_PREFIX: prefix,
  API_HOST: '127.0.0.1',
  API_PORT: port,
  COOKIE_SECURE: 'false',
  // Each test is a client of its own (tests/fixtures.ts): loopback is the "proxy".
  TRUST_PROXY: 'loopback',
  CSRF_TRUSTED_ORIGINS: `http://127.0.0.1:${port},http://localhost:${port}`,
  ALLOWED_HOSTS: '',
  WEB_DIST_DIR: webDist,
  STORAGE_LOCAL_ROOT: storageDir,
  STORAGE_LOCAL_ROOTS: storageDir,
  THUMBNAIL_DIR: '',
  MIN_FREE_DISK_MB: '0',
  STORAGE_SECRET_KEY: '',
  GOOGLE_OAUTH_CLIENT_ID: '',
  GOOGLE_OAUTH_CLIENT_SECRET: '',
  TELEGRAM_RPC_TIMEOUT_MS: '1500',
});
await import(pathToFileURL(apiMain).href);
