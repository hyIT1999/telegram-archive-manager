import { isIP } from 'node:net';
import path from 'node:path';
import type { ConfigService } from '@nestjs/config';
import { isSecretKey } from '@tam/crypto';
import { z } from 'zod';

/** Values accepted by LOG_LEVEL (see .env.example). */
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevelName = (typeof LOG_LEVELS)[number];

/** Express "trust proxy" setting: all, none, a hop count, or a list of addresses/subnets. */
export type TrustProxySetting = boolean | number | string[];

/** What browsers send in the Origin header: scheme://host[:port], without a path. */
const ORIGIN_PATTERN = /^https?:\/\/[^/?#\s\\]+$/i;
/** A host name without port, optionally with a leading "*." for every subdomain. */
const HOST_NAME_PATTERN =
  /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;
/** The placeholder of .env.example; a production server must never run with it. */
const PLACEHOLDER = /CHANGE_ME/i;
const PROXY_KEYWORDS = new Set(['loopback', 'linklocal', 'uniquelocal']);
const HOP_COUNT_PATTERN = /^\d+$/;

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** A trust proxy entry: a proxy-addr keyword, an IP, or a subnet (IP/prefix or IPv4/netmask). */
function isTrustProxyEntry(entry: string): boolean {
  if (PROXY_KEYWORDS.has(entry)) {
    return true;
  }
  const [address, subnet, ...rest] = entry.split('/');
  const version = isIP(address ?? '');
  if (rest.length > 0 || version === 0) {
    return false;
  }
  if (subnet === undefined) {
    return true;
  }
  if (/^\d{1,3}$/.test(subnet)) {
    return Number(subnet) <= (version === 4 ? 32 : 128);
  }
  return version === 4 && isIP(subnet) === 4;
}

function isTrustProxyValue(value: string): boolean {
  if (value === 'true' || value === 'false' || HOP_COUNT_PATTERN.test(value)) {
    return true;
  }
  const entries = splitList(value);
  return entries.length > 0 && entries.every(isTrustProxyEntry);
}

function toTrustProxySetting(value: string): TrustProxySetting {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return HOP_COUNT_PATTERN.test(value) ? Number(value) : splitList(value);
}

const absolutePath = z
  .string()
  .trim()
  .refine((value) => path.isAbsolute(value), 'must be an absolute path');

/** Folder lists are separated by ";" (Windows paths contain ":" and may contain ","). */
function splitPaths(value: string): string[] {
  return value
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function requiredUrl(description: string) {
  return (issue: { input?: unknown }) =>
    issue.input === undefined ? 'is required' : `must be a ${description}`;
}

const envObjectSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  API_HOST: z.string().trim().min(1).default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3100),
  DATABASE_URL: z.url({
    protocol: /^postgres(ql)?$/,
    error: requiredUrl('postgresql:// connection string'),
  }),
  REDIS_URL: z.url({ protocol: /^rediss?$/, error: requiredUrl('redis:// or rediss:// URL') }),
  BULLMQ_PREFIX: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]+$/, 'may only contain letters, digits, "_" and "-"')
    .default('tam'),
  COOKIE_SECURE: z.stringbool().default(false),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(8_760).default(168),
  SESSION_ABSOLUTE_TTL_DAYS: z.coerce.number().int().min(1).max(3_650).default(30),
  CSRF_TRUSTED_ORIGINS: z
    .string()
    .transform(splitList)
    .pipe(
      z.array(
        z.string().regex(ORIGIN_PATTERN, {
          error: (issue) =>
            `"${String(issue.input)}" is not an origin such as http://localhost:4300 (scheme://host[:port], no path)`,
        }),
      ),
    )
    .default([]),
  /**
   * Host names the api answers for, besides IP addresses, localhost and the hosts of
   * CSRF_TRUSTED_ORIGINS. Any other Host header is refused (protects against DNS rebinding).
   */
  ALLOWED_HOSTS: z
    .string()
    .transform((value) => splitList(value).map((host) => host.toLowerCase()))
    .pipe(
      z.array(
        z.string().regex(HOST_NAME_PATTERN, {
          error: (issue) =>
            `"${String(issue.input)}" is not a host name such as archive.lan or *.example.com (no scheme, no port)`,
        }),
      ),
    )
    .default([]),
  /** The built web app (apps/web/dist/web/browser), served by the api itself when set. */
  WEB_DIST_DIR: absolutePath.optional(),
  /** How long a Telegram request (login step, chat list refresh) waits for the worker. */
  TELEGRAM_RPC_TIMEOUT_MS: z.coerce.number().int().min(500).max(120_000).default(30_000),
  /** Folder of the built-in "This computer" storage location. */
  STORAGE_LOCAL_ROOT: absolutePath.optional(),
  /** Folders under which people may add storage locations; defaults to STORAGE_LOCAL_ROOT. */
  STORAGE_LOCAL_ROOTS: z
    .string()
    .transform(splitPaths)
    .pipe(z.array(absolutePath).min(1, 'must list at least one folder'))
    .optional(),
  /** Downloads to folders on the server keep this much disk space free (the worker enforces it). */
  MIN_FREE_DISK_MB: z.coerce.number().int().min(0).max(10_000_000).default(2_048),
  /** Telegram previews the worker keeps (default: <STORAGE_LOCAL_ROOT>/.tam-thumbnails). */
  THUMBNAIL_DIR: absolutePath.optional(),
  /** Encrypts cloud storage credentials (Google refresh tokens) at rest. */
  STORAGE_SECRET_KEY: z
    .string()
    .trim()
    .refine(isSecretKey, 'must be 32 random bytes encoded as base64 (see .env.example)')
    .optional(),
  /** OAuth client of type "TVs and Limited Input devices", for Google Drive locations. */
  GOOGLE_OAUTH_CLIENT_ID: z
    .string()
    .trim()
    .regex(
      /^[\w.-]+\.apps\.googleusercontent\.com$/,
      'must be the client ID of a Google OAuth client (…apps.googleusercontent.com)',
    )
    .optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().trim().min(8, 'is too short').optional(),
  TRUST_PROXY: z
    .string()
    .trim()
    .refine(isTrustProxyValue, {
      error:
        'must be true, false, a hop count, or a comma-separated list of loopback, linklocal, uniquelocal, IP addresses or subnets',
    })
    .transform(toTrustProxySetting)
    .default(['loopback']),
});

export type Env = z.output<typeof envObjectSchema>;

/** Secrets that production refuses to start with while they hold the .env.example placeholder. */
const PLACEHOLDER_CHECKED_KEYS = [
  'DATABASE_URL',
  'REDIS_URL',
  'GOOGLE_OAUTH_CLIENT_SECRET',
] as const satisfies readonly (keyof Env)[];

/** Treats `KEY=` like an unset variable, so the default applies instead of a validation error. */
function withoutEmptyValues(input: unknown): unknown {
  if (typeof input !== 'object' || input === null) {
    return input;
  }
  return Object.fromEntries(
    Object.entries(input).filter(
      ([, value]) => !(typeof value === 'string' && value.trim() === ''),
    ),
  );
}

/** Validates the api environment (process.env merged with the .env files) at startup. */
export const envSchema = z.preprocess(
  withoutEmptyValues,
  envObjectSchema
    .refine(
      (env) =>
        (env.GOOGLE_OAUTH_CLIENT_ID === undefined) ===
        (env.GOOGLE_OAUTH_CLIENT_SECRET === undefined),
      {
        path: ['GOOGLE_OAUTH_CLIENT_ID'],
        message: 'GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET must be set together',
      },
    )
    .superRefine((env, context) => {
      if (env.NODE_ENV !== 'production') {
        return;
      }
      for (const key of PLACEHOLDER_CHECKED_KEYS) {
        if (PLACEHOLDER.test(env[key] ?? '')) {
          context.addIssue({
            code: 'custom',
            path: [key],
            message: 'still holds the CHANGE_ME placeholder from .env.example',
          });
        }
      }
    }),
);

/** Variables the api reads; nothing else is taken from the .env files. */
export const ENV_KEYS = Object.keys(envObjectSchema.shape) as (keyof Env)[];

const cliEnvObjectSchema = envObjectSchema
  .pick({ DATABASE_URL: true, BULLMQ_PREFIX: true })
  .extend({
    /** Optional: reset-password clears the sign-in lock kept in Redis. */
    REDIS_URL: envObjectSchema.shape.REDIS_URL.optional(),
  });

/** The subset of the environment the user CLIs (create-user, reset-password) need. */
export const cliEnvSchema = z.preprocess(withoutEmptyValues, cliEnvObjectSchema);
export const CLI_ENV_KEYS = Object.keys(cliEnvObjectSchema.shape);

/** The validated environment, as ConfigModule parsed it at startup. */
export function readEnv(config: ConfigService<Env, true>): Env {
  return Object.fromEntries(ENV_KEYS.map((key) => [key, config.get(key, { infer: true })])) as Env;
}

/**
 * ConfigModule's `validate` hook: the parsed environment is used as-is (a validation schema
 * would get the raw values merged back in, turning a blank `KEY=` into "" instead of unset).
 */
export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    throw new Error(`Invalid api environment:\n${formatEnvIssues(result.error)}`);
  }
  return result.data;
}

/** One line per problem, e.g. `API_PORT: Too big: expected number to be <=65535`. Never echoes secrets. */
export function formatEnvIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.map(String).join('.');
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join('\n');
}
