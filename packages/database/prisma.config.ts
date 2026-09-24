import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';

// The monorepo keeps a single .env at the repository root. Existing environment variables win
// (dotenv never overrides), so tests and Docker can inject their own DATABASE_URL.
const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: [path.join(here, '.env'), path.join(here, '../../.env')], quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // `prisma generate` does not need a database, so an empty URL is allowed at build time.
    url: process.env.DATABASE_URL ?? '',
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
