/**
 * Destructive dev recovery: drops and re-creates the database from DATABASE_URL, then applies all
 * migrations. Usage: npm run db:recreate -- --yes
 */
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { DATABASE_PACKAGE_ROOT, databaseNameOf, migrateDeploy, recreateDatabase } from '../admin.js';

loadEnv({ path: path.join(DATABASE_PACKAGE_ROOT, '../../.env'), quiet: true });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to recreate a database with NODE_ENV=production.');
  process.exit(1);
}
const name = databaseNameOf(databaseUrl);
if (!process.argv.includes('--yes')) {
  console.error(`This DROPS database "${name}" and all its data. Re-run with --yes to confirm.`);
  process.exit(1);
}

await recreateDatabase(databaseUrl);
console.log(`Re-created database "${name}". Applying migrations…`);
await migrateDeploy(databaseUrl);
console.log('Done.');
