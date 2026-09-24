export * from './generated/prisma/client.js';
export { createPrismaClient, type PrismaClientOptions } from './client.js';
export {
  DATABASE_PACKAGE_ROOT,
  databaseNameOf,
  migrateDeploy,
  recreateDatabase,
  withDatabaseName,
} from './admin.js';
