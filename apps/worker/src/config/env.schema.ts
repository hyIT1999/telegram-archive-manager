import { z } from 'zod';

/** Accepted LOG_LEVEL values (see .env.example). */
export const LOG_LEVELS = ['error', 'warn', 'info', 'debug'] as const;
export type LogLevelName = (typeof LOG_LEVELS)[number];

/** Byte length of TELEGRAM_SESSION_KEY once base64-decoded (an AES-256 key). */
export const TELEGRAM_SESSION_KEY_BYTES = 32;

const INT32_MAX = 2_147_483_647;

function parseConnectionUrl(value: string, protocols: readonly string[]): URL | null {
  const url = URL.parse(value);
  return url !== null && protocols.includes(url.protocol) && url.hostname !== '' ? url : null;
}

const postgresUrl = z
  .string()
  .refine(
    (value) => (parseConnectionUrl(value, ['postgresql:', 'postgres:'])?.pathname.length ?? 0) > 1,
    'must be a postgresql://user:password@host:port/database URL',
  );

const redisUrl = z
  .string()
  .refine(
    (value) => /^(\/\d*)?$/.test(parseConnectionUrl(value, ['redis:', 'rediss:'])?.pathname ?? 'x'),
    'must be a redis://[:password@]host:port[/db] URL',
  );

function wholeNumber(min: number, max: number) {
  return z
    .string()
    .regex(/^\d+$/, 'must be a whole number')
    .transform(Number)
    .pipe(z.number().min(min, `must be at least ${min}`).max(max, `must be at most ${max}`));
}

/** Canonical (padded, standard alphabet) base64 of exactly `bytes` bytes. */
function isBase64Key(value: string, bytes: number): boolean {
  const decoded = Buffer.from(value, 'base64');
  return decoded.length === bytes && decoded.toString('base64') === value;
}

/**
 * Worker environment. Telegram settings are optional until Phase 2 wires the MTProto client,
 * but a value that is present must already be well-formed.
 */
export const workerEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),

    DATABASE_URL: postgresUrl,
    REDIS_URL: redisUrl,
    BULLMQ_PREFIX: z.string().regex(/^\S+$/, 'must not contain whitespace').default('tam'),
    WORKER_HEARTBEAT_INTERVAL_MS: wholeNumber(1_000, 60_000).default(5_000),

    STORAGE_LOCAL_ROOT: z.string().default('./data/storage'),
    MIN_FREE_DISK_MB: wholeNumber(0, 10_000_000).default(2_048),

    TELEGRAM_API_ID: z
      .string()
      .regex(/^[1-9]\d{0,9}$/, 'must be the numeric api_id from my.telegram.org')
      .transform(Number)
      .pipe(z.number().max(INT32_MAX, 'must be the numeric api_id from my.telegram.org'))
      .optional(),
    TELEGRAM_API_HASH: z
      .string()
      .regex(/^[0-9a-f]{32}$/i, 'must be the 32-character api_hash from my.telegram.org')
      .optional(),
    TELEGRAM_SESSION_DATABASE_URL: postgresUrl.optional(),
    TELEGRAM_SESSION_KEY: z
      .string()
      .refine(
        (value) => isBase64Key(value, TELEGRAM_SESSION_KEY_BYTES),
        `must be ${TELEGRAM_SESSION_KEY_BYTES} random bytes encoded as base64 (see .env.example)`,
      )
      .optional(),
  })
  .refine((env) => (env.TELEGRAM_API_ID === undefined) === (env.TELEGRAM_API_HASH === undefined), {
    path: ['TELEGRAM_API_ID'],
    message: 'TELEGRAM_API_ID and TELEGRAM_API_HASH must be set together',
  });

export type WorkerEnv = z.output<typeof workerEnvSchema>;

/** Thrown when the environment is invalid. Lists variable names and problems, never values. */
export class EnvValidationError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Invalid worker environment:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
    this.name = 'EnvValidationError';
  }
}

/**
 * Validates raw variables (process.env or a parsed .env) and applies defaults. An empty value
 * (`KEY=`) counts as unset, so optional variables may stay blank as in .env.example.
 * Used by main.ts before boot and by ConfigModule's `validate` hook.
 */
export function validateWorkerEnv(raw: Record<string, unknown>): WorkerEnv {
  const input = Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== ''));
  const result = workerEnvSchema.safeParse(input);
  if (result.success) {
    return result.data;
  }
  throw new EnvValidationError(
    result.error.issues.map((issue) => {
      const key = issue.path.map(String).join('.') || 'environment';
      const missing = issue.code === 'invalid_type' && input[key] === undefined;
      return `${key}: ${missing ? 'is not set' : issue.message}`;
    }),
  );
}
