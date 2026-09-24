import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { EnvValidationError, validateWorkerEnv } from '../src/config/env.schema.js';

const required = {
  DATABASE_URL: 'postgresql://tam:db-secret@localhost:5432/tam',
  REDIS_URL: 'redis://:redis-secret@127.0.0.1:6380/0',
};

const telegram = {
  TELEGRAM_API_ID: '1234567',
  TELEGRAM_API_HASH: '0123456789abcdef0123456789abcdef',
  TELEGRAM_SESSION_DATABASE_URL: 'postgresql://tam:db-secret@localhost:5432/tam_tg',
  TELEGRAM_SESSION_KEY: randomBytes(32).toString('base64'),
};

/** Runs the validation and returns the reported problems (fails the test if there are none). */
function problemsOf(raw: Record<string, string>): readonly string[] {
  try {
    validateWorkerEnv(raw);
  } catch (error) {
    if (error instanceof EnvValidationError) {
      return error.problems;
    }
    throw error;
  }
  throw new Error('Expected the environment to be rejected');
}

describe('validateWorkerEnv', () => {
  it('applies the documented defaults', () => {
    expect(validateWorkerEnv(required)).toEqual({
      ...required,
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
      BULLMQ_PREFIX: 'tam',
      WORKER_HEARTBEAT_INTERVAL_MS: 5000,
      STORAGE_LOCAL_ROOT: './data/storage',
      MIN_FREE_DISK_MB: 2048,
    });
  });

  it('parses numbers and enums, and drops unrelated variables', () => {
    const env = validateWorkerEnv({
      ...required,
      PATH: '/usr/bin',
      NODE_ENV: 'production',
      LOG_LEVEL: 'debug',
      BULLMQ_PREFIX: 'tam-prod',
      WORKER_HEARTBEAT_INTERVAL_MS: '2500',
      STORAGE_LOCAL_ROOT: '/data/media',
      MIN_FREE_DISK_MB: '0',
    });
    expect(env).toMatchObject({
      NODE_ENV: 'production',
      LOG_LEVEL: 'debug',
      BULLMQ_PREFIX: 'tam-prod',
      WORKER_HEARTBEAT_INTERVAL_MS: 2500,
      STORAGE_LOCAL_ROOT: '/data/media',
      MIN_FREE_DISK_MB: 0,
    });
    expect(env).not.toHaveProperty('PATH');
  });

  it('treats empty values as unset, like the blanks in .env.example', () => {
    const env = validateWorkerEnv({
      ...required,
      BULLMQ_PREFIX: '',
      TELEGRAM_API_ID: '',
      TELEGRAM_API_HASH: '',
      TELEGRAM_SESSION_KEY: '',
    });
    expect(env.BULLMQ_PREFIX).toBe('tam');
    expect(env.TELEGRAM_API_ID).toBeUndefined();
    expect(env.TELEGRAM_API_HASH).toBeUndefined();
    expect(env.TELEGRAM_SESSION_KEY).toBeUndefined();
  });

  it('names every missing required variable', () => {
    expect(problemsOf({})).toEqual(['DATABASE_URL: is not set', 'REDIS_URL: is not set']);
    expect(problemsOf({ ...required, DATABASE_URL: '' })).toEqual(['DATABASE_URL: is not set']);
  });

  it.each([
    ['DATABASE_URL', 'mysql://tam:db-secret@localhost:3306/tam'],
    ['DATABASE_URL', 'postgresql://tam:db-secret@localhost:5432'],
    ['DATABASE_URL', 'not a url'],
    ['REDIS_URL', 'http://127.0.0.1:6380'],
    ['REDIS_URL', 'redis://127.0.0.1:6380/queue'],
    ['NODE_ENV', 'staging'],
    ['LOG_LEVEL', 'verbose'],
    ['BULLMQ_PREFIX', 'tam prod'],
    ['WORKER_HEARTBEAT_INTERVAL_MS', '999'],
    ['WORKER_HEARTBEAT_INTERVAL_MS', '60001'],
    ['WORKER_HEARTBEAT_INTERVAL_MS', '5s'],
    ['WORKER_HEARTBEAT_INTERVAL_MS', '1500.5'],
    ['MIN_FREE_DISK_MB', '-1'],
  ])('rejects %s=%s', (key, value) => {
    const problems = problemsOf({ ...required, [key]: value });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(new RegExp(`^${key}: `));
  });

  it('never echoes values into the error message', () => {
    const error = (() => {
      try {
        validateWorkerEnv({
          DATABASE_URL: 'mysql://tam:hunter2@localhost/tam',
          REDIS_URL: 'redis://:hunter2@127.0.0.1:6380/x',
          TELEGRAM_SESSION_KEY: 'hunter2',
        });
      } catch (caught) {
        return caught as Error;
      }
      throw new Error('Expected the environment to be rejected');
    })();
    expect(error).toBeInstanceOf(EnvValidationError);
    expect(error.message).toContain('DATABASE_URL');
    expect(error.message).toContain('TELEGRAM_SESSION_KEY');
    expect(error.message).not.toContain('hunter2');
  });

  describe('Telegram settings (optional until Phase 2)', () => {
    it('accepts a complete, well-formed set', () => {
      const env = validateWorkerEnv({ ...required, ...telegram });
      expect(env).toMatchObject({ ...telegram, TELEGRAM_API_ID: 1234567 });
    });

    it.each(['abc', '0', '-5', '12.5', '2147483648'])('rejects TELEGRAM_API_ID=%s', (value) => {
      expect(problemsOf({ ...required, ...telegram, TELEGRAM_API_ID: value })).toEqual([
        'TELEGRAM_API_ID: must be the numeric api_id from my.telegram.org',
      ]);
    });

    it('rejects an api_hash that is not 32 hex characters', () => {
      const problems = problemsOf({ ...required, ...telegram, TELEGRAM_API_HASH: 'xyz' });
      expect(problems).toEqual([
        'TELEGRAM_API_HASH: must be the 32-character api_hash from my.telegram.org',
      ]);
    });

    it('requires TELEGRAM_API_ID and TELEGRAM_API_HASH together', () => {
      const expected = [
        'TELEGRAM_API_ID: TELEGRAM_API_ID and TELEGRAM_API_HASH must be set together',
      ];
      expect(problemsOf({ ...required, TELEGRAM_API_ID: '1234567' })).toEqual(expected);
      expect(problemsOf({ ...required, TELEGRAM_API_HASH: telegram.TELEGRAM_API_HASH })).toEqual(
        expected,
      );
    });

    it.each([
      ['16 bytes', randomBytes(16).toString('base64')],
      ['33 bytes', randomBytes(33).toString('base64')],
      ['base64url without padding', randomBytes(32).toString('base64url')],
      ['a passphrase', 'correct horse battery staple'],
    ])('rejects a TELEGRAM_SESSION_KEY made of %s', (_label, value) => {
      const problems = problemsOf({ ...required, TELEGRAM_SESSION_KEY: value });
      expect(problems).toEqual([
        'TELEGRAM_SESSION_KEY: must be 32 random bytes encoded as base64 (see .env.example)',
      ]);
    });

    it('requires TELEGRAM_SESSION_DATABASE_URL to be a PostgreSQL URL', () => {
      const problems = problemsOf({
        ...required,
        TELEGRAM_SESSION_DATABASE_URL: 'redis://127.0.0.1:6380/1',
      });
      expect(problems).toEqual([
        'TELEGRAM_SESSION_DATABASE_URL: must be a postgresql://user:password@host:port/database URL',
      ]);
    });
  });
});
