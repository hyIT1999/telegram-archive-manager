import type { ITelegramStorageProvider } from '@mtcute/core';
import { PostgresStorage } from '@mtcute/postgres';
import pg from 'pg';
import type { SecretBox } from '../crypto/secret-box.js';
import { EncryptedAuthKeysRepository } from './encrypted-auth-keys.js';

export interface SessionStorageOptions {
  /** A dedicated database (TELEGRAM_SESSION_DATABASE_URL) that Prisma and tests never touch. */
  connectionString: string;
  box: SecretBox;
  /** @default 'mtcute' */
  schema?: string;
  /** @default 'default' (single-tenant) */
  account?: string;
}

export interface SessionStorage {
  storage: ITelegramStorageProvider;
  /** Closes the connection pool; call after the Telegram client was destroyed. */
  close(): Promise<void>;
}

/**
 * mtcute session storage in PostgreSQL (mtcute creates and migrates its own schema) with the auth
 * keys encrypted by TELEGRAM_SESSION_KEY.
 */
export function createSessionStorage(options: SessionStorageOptions): SessionStorage {
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: 4,
    connectionTimeoutMillis: 5_000,
    application_name: 'tam-worker-telegram-session',
  });
  const inner = new PostgresStorage(pool, {
    schema: options.schema ?? 'mtcute',
    account: options.account ?? 'default',
  });
  const storage: ITelegramStorageProvider = {
    driver: inner.driver,
    kv: inner.kv,
    peers: inner.peers,
    refMessages: inner.refMessages,
    authKeys: new EncryptedAuthKeysRepository(inner.authKeys, options.box),
  };
  return { storage, close: () => pool.end() };
}
