import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

export interface PrismaClientOptions {
  /** postgresql:// connection string. */
  url: string;
  /** Maximum pool size (default 10). */
  max?: number;
  /** Shown in pg_stat_activity. */
  applicationName?: string;
}

/** Creates a Prisma client backed by the node-postgres driver adapter (required by Prisma 7). */
export function createPrismaClient(options: PrismaClientOptions): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: options.url,
    max: options.max ?? 10,
    // node-postgres waits forever by default; fail fast instead.
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 300_000,
    application_name: options.applicationName,
  });
  return new PrismaClient({ adapter });
}
