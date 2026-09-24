import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

/** Root of the @tam/database package (holds prisma.config.ts and prisma/migrations). */
export const DATABASE_PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Returns the same connection string pointing at another database name. */
export function withDatabaseName(databaseUrl: string, databaseName: string): string {
  const url = new URL(databaseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

export function databaseNameOf(databaseUrl: string): string {
  const name = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ''));
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(name)) {
    throw new Error(`Refusing to operate on unusual database name "${name}"`);
  }
  return name;
}

/**
 * Drops (WITH FORCE) and re-creates the database named in `databaseUrl`, connecting through the
 * `postgres` maintenance database with the same credentials. The role must own the database or
 * have CREATEDB. Used by tests and by `npm run db:recreate` (Prisma blocks `migrate reset` when
 * it is driven by an AI agent).
 */
export async function recreateDatabase(databaseUrl: string): Promise<void> {
  const name = databaseNameOf(databaseUrl);
  const admin = new pg.Client({ connectionString: withDatabaseName(databaseUrl, 'postgres') });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
}

/** Runs `prisma migrate deploy` against `databaseUrl` using this package's migrations. */
export async function migrateDeploy(databaseUrl: string): Promise<void> {
  const require = createRequire(import.meta.url);
  const prismaCli = require.resolve('prisma/build/index.js');
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [prismaCli, 'migrate', 'deploy'], {
      cwd: DATABASE_PACKAGE_ROOT,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`prisma migrate deploy failed (${code}):\n${output}`)),
    );
  });
}
