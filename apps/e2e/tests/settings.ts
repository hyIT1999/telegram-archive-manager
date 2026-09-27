/** Where the tests' api listens (support/serve.mjs), apart from the dev (3100) and prod (8080) ones. */
export const PORT = 3190;
export const BASE_URL = `http://127.0.0.1:${PORT}`;

/** Test-only accounts of the throwaway e2e database. */
export const READER = { email: 'reader@example.test', password: 'correct horse battery staple' };
/** Changes its password in account.spec.ts, so no other test signs in with it. */
export const ACCOUNT_OWNER = { email: 'owner@example.test', password: 'another long passphrase' };

export const E2E_DATABASE = 'tam_test_e2e';
export const E2E_REDIS_DB = 13;
export const E2E_PREFIX = 'tame2e';
