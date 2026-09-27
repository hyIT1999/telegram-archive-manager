import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it } from 'vitest';
import { envFileParser, envFilePaths, loadEnvFiles } from '../../src/config/env-files.js';
import {
  cliEnvSchema,
  envSchema,
  formatEnvIssues,
  readEnv,
  type Env,
} from '../../src/config/env.js';

const REQUIRED = {
  DATABASE_URL: 'postgresql://tam:secret-db-password@localhost:5432/tam',
  REDIS_URL: 'redis://:secret-redis-password@127.0.0.1:6380/0',
};

function parse(overrides: Record<string, string | undefined> = {}) {
  return envSchema.safeParse({ ...REQUIRED, ...overrides });
}

function errorsOf(overrides: Record<string, string | undefined>): string {
  const result = parse(overrides);
  if (result.success) {
    throw new Error('expected validation to fail');
  }
  return formatEnvIssues(result.error);
}

describe('envSchema', () => {
  it('applies the documented defaults', () => {
    const result = parse();
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      ...REQUIRED,
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
      API_HOST: '127.0.0.1',
      API_PORT: 3100,
      BULLMQ_PREFIX: 'tam',
      COOKIE_SECURE: false,
      SESSION_TTL_HOURS: 168,
      SESSION_ABSOLUTE_TTL_DAYS: 30,
      CSRF_TRUSTED_ORIGINS: [],
      ALLOWED_HOSTS: [],
      TELEGRAM_RPC_TIMEOUT_MS: 30_000,
      MIN_FREE_DISK_MB: 2048,
      TRUST_PROXY: ['loopback'],
    });
  });

  it('coerces strings from the environment into typed values', () => {
    const result = parse({
      NODE_ENV: 'production',
      API_PORT: '8080',
      COOKIE_SECURE: 'true',
      SESSION_TTL_HOURS: '12',
      SESSION_ABSOLUTE_TTL_DAYS: '7',
      CSRF_TRUSTED_ORIGINS: ' http://localhost:4300 , https://archive.example.com ',
    });
    expect(result.data).toMatchObject({
      NODE_ENV: 'production',
      API_PORT: 8080,
      COOKIE_SECURE: true,
      SESSION_TTL_HOURS: 12,
      SESSION_ABSOLUTE_TTL_DAYS: 7,
      CSRF_TRUSTED_ORIGINS: ['http://localhost:4300', 'https://archive.example.com'],
    });
  });

  it('treats empty values as unset so defaults apply', () => {
    expect(parse({ API_PORT: '', COOKIE_SECURE: ' ', TRUST_PROXY: '' }).data).toMatchObject({
      API_PORT: 3100,
      COOKIE_SECURE: false,
      TRUST_PROXY: ['loopback'],
    });
  });

  it.each([
    ['true', true],
    ['false', false],
    ['2', 2],
    ['loopback, uniquelocal', ['loopback', 'uniquelocal']],
    ['10.0.0.0/8,::1', ['10.0.0.0/8', '::1']],
    ['172.16.0.0/255.240.0.0', ['172.16.0.0/255.240.0.0']],
  ])('parses TRUST_PROXY=%j', (value, expected) => {
    expect(parse({ TRUST_PROXY: value }).data?.TRUST_PROXY).toEqual(expected);
  });

  it.each(['bogus', '10.0.0.0/33', '300.1.1.1', 'loopback,,nope'])(
    'rejects TRUST_PROXY=%j',
    (value) => {
      expect(errorsOf({ TRUST_PROXY: value })).toMatch(
        /^TRUST_PROXY: must be true, false, a hop count/,
      );
    },
  );

  it('reports every problem with the variable name and without echoing secrets', () => {
    const message = errorsOf({
      DATABASE_URL: 'mysql://root:hunter2@db/tam',
      REDIS_URL: undefined,
      API_PORT: '70000',
      LOG_LEVEL: 'chatty',
      CSRF_TRUSTED_ORIGINS: 'http://localhost:4300/app',
    });
    expect(message).toContain('DATABASE_URL: must be a postgresql:// connection string');
    expect(message).toContain('REDIS_URL: is required');
    expect(message).toMatch(/API_PORT: .*65535/);
    expect(message).toMatch(/LOG_LEVEL: /);
    expect(message).toContain('"http://localhost:4300/app" is not an origin');
    expect(message).not.toContain('hunter2');
  });

  it('reads storage folders, the storage key and the Google OAuth client', () => {
    const root = path.resolve('archive');
    const other = path.resolve('more folders');
    const key = randomBytes(32).toString('base64');
    expect(
      parse({
        STORAGE_LOCAL_ROOT: root,
        STORAGE_LOCAL_ROOTS: ` ${root} ; ${other} ;`,
        STORAGE_SECRET_KEY: key,
        GOOGLE_OAUTH_CLIENT_ID: '1234-abc.apps.googleusercontent.com',
        GOOGLE_OAUTH_CLIENT_SECRET: 'GOCSPX-secret-value',
      }).data,
    ).toMatchObject({
      STORAGE_LOCAL_ROOT: root,
      STORAGE_LOCAL_ROOTS: [root, other],
      STORAGE_SECRET_KEY: key,
      GOOGLE_OAUTH_CLIENT_ID: '1234-abc.apps.googleusercontent.com',
      GOOGLE_OAUTH_CLIENT_SECRET: 'GOCSPX-secret-value',
    });
  });

  it('rejects relative storage folders and a malformed storage key, without echoing it', () => {
    const message = errorsOf({
      STORAGE_LOCAL_ROOT: 'relative/archive',
      STORAGE_LOCAL_ROOTS: 'also/relative',
      STORAGE_SECRET_KEY: 'not-a-key-hunter2',
      GOOGLE_OAUTH_CLIENT_ID: 'not-a-client-id',
    });
    expect(message).toContain('STORAGE_LOCAL_ROOT: must be an absolute path');
    expect(message).toContain('STORAGE_LOCAL_ROOTS.0: must be an absolute path');
    expect(message).toContain('STORAGE_SECRET_KEY: must be 32 random bytes');
    expect(message).toContain(
      'GOOGLE_OAUTH_CLIENT_ID: must be the client ID of a Google OAuth client',
    );
    expect(message).not.toContain('hunter2');
  });

  it('requires the Google client ID and secret together', () => {
    expect(errorsOf({ GOOGLE_OAUTH_CLIENT_ID: '1234-abc.apps.googleusercontent.com' })).toBe(
      'GOOGLE_OAUTH_CLIENT_ID: GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET must be set together',
    );
  });

  it('reads the allowed host names and the folder of the web app', () => {
    const webDir = path.resolve('/srv/tam/web');
    expect(
      parse({ ALLOWED_HOSTS: ' Archive.LAN , *.example.com ', WEB_DIST_DIR: webDir }).data,
    ).toMatchObject({ ALLOWED_HOSTS: ['archive.lan', '*.example.com'], WEB_DIST_DIR: webDir });
  });

  it.each(['http://archive.lan', 'archive.lan:8080', 'two words', '*.', 'bad_name'])(
    'rejects the host name %j',
    (host) => {
      expect(errorsOf({ ALLOWED_HOSTS: host })).toMatch(/^ALLOWED_HOSTS\.0: .* is not a host name/);
    },
  );

  it('rejects a relative web app folder', () => {
    expect(errorsOf({ WEB_DIST_DIR: 'apps/web/dist' })).toBe(
      'WEB_DIST_DIR: must be an absolute path',
    );
  });

  it('refuses the .env.example placeholder in production only', () => {
    const placeholder = {
      DATABASE_URL: 'postgresql://tam:CHANGE_ME@localhost:5432/tam',
      REDIS_URL: 'redis://:CHANGE_ME@127.0.0.1:6380/0',
    };
    expect(parse(placeholder).success).toBe(true);
    const errors = errorsOf({ ...placeholder, NODE_ENV: 'production' });
    expect(errors).toBe(
      [
        'DATABASE_URL: still holds the CHANGE_ME placeholder from .env.example',
        'REDIS_URL: still holds the CHANGE_ME placeholder from .env.example',
      ].join('\n'),
    );
  });

  it('validates only DATABASE_URL for the CLI', () => {
    expect(cliEnvSchema.safeParse({ DATABASE_URL: REQUIRED.DATABASE_URL }).success).toBe(true);
    expect(cliEnvSchema.safeParse({ REDIS_URL: REQUIRED.REDIS_URL }).success).toBe(false);
  });
});

describe('readEnv', () => {
  it('reads every variable through ConfigService', () => {
    const parsed = parse().data as Env;
    const config = { get: (key: keyof Env) => parsed[key] } as unknown as ConfigService<Env, true>;
    expect(readEnv(config)).toEqual(parsed);
  });
});

describe('env files', () => {
  const tempDirs: string[] = [];
  const keys = ['TAM_ENV_SPEC_A', 'TAM_ENV_SPEC_B', 'TAM_ENV_SPEC_C'];

  afterEach(() => {
    for (const key of [...keys, 'TAM_ENV_SPEC_SECRET']) {
      delete process.env[key];
    }
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('looks in the working directory, then at the repository root', () => {
    const cwd = path.resolve('/repo/apps/api');
    expect(envFilePaths(cwd)).toEqual([path.join(cwd, '.env'), path.resolve(cwd, '../../.env')]);
  });

  it('parses only the variables this process reads', () => {
    const parse = envFileParser(['DATABASE_URL']);
    const content = 'DATABASE_URL="postgresql://x@h/db"\nTELEGRAM_API_HASH=worker-only # comment\n';
    expect(parse(Buffer.from(content))).toEqual({ DATABASE_URL: 'postgresql://x@h/db' });
  });

  it('never overrides real variables, lets earlier files win and skips unlisted keys', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tam-env-'));
    tempDirs.push(dir);
    const first = path.join(dir, 'first.env');
    const second = path.join(dir, 'second.env');
    writeFileSync(first, 'TAM_ENV_SPEC_A=from-first\nTAM_ENV_SPEC_B=from-first\n');
    writeFileSync(
      second,
      'TAM_ENV_SPEC_B=from-second\r\nTAM_ENV_SPEC_C=from-second\r\nTAM_ENV_SPEC_SECRET=x\r\n',
    );
    process.env['TAM_ENV_SPEC_A'] = 'from-environment';

    loadEnvFiles(keys, [first, path.join(dir, 'missing.env'), second]);

    expect(process.env['TAM_ENV_SPEC_A']).toBe('from-environment');
    expect(process.env['TAM_ENV_SPEC_B']).toBe('from-first');
    expect(process.env['TAM_ENV_SPEC_C']).toBe('from-second');
    expect(process.env['TAM_ENV_SPEC_SECRET']).toBeUndefined();
  });
});
