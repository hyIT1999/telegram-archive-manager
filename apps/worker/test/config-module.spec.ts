import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { workerConfigOptions } from '../src/config/config-module.js';
import type { WorkerEnv } from '../src/config/env.schema.js';
import { telegramSettingsFrom } from '../src/telegram/telegram-settings.js';

const VARIABLES = {
  DATABASE_URL: 'postgresql://tam:secret@localhost:5432/tam',
  REDIS_URL: 'redis://:secret@127.0.0.1:6380/0',
  WORKER_HEARTBEAT_INTERVAL_MS: '2500',
  // Blank, as copied from .env.example (main.ts loads the .env file into process.env).
  TELEGRAM_API_ID: '',
  TELEGRAM_API_HASH: '',
  TELEGRAM_SESSION_KEY: '',
};

describe('workerConfigOptions', () => {
  const saved = new Map(Object.keys(VARIABLES).map((key) => [key, process.env[key]]));

  afterEach(() => {
    for (const [key, value] of saved) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('keeps blank optional settings unset, so Telegram reports itself as not configured', async () => {
    Object.assign(process.env, VARIABLES);
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot(workerConfigOptions())],
    }).compile();
    const config = moduleRef.get<ConfigService<WorkerEnv, true>>(ConfigService);

    expect(config.get('WORKER_HEARTBEAT_INTERVAL_MS', { infer: true })).toBe(2500);
    expect(config.get('TELEGRAM_API_ID', { infer: true })).toBeUndefined();
    expect(
      telegramSettingsFrom({
        TELEGRAM_API_ID: config.get('TELEGRAM_API_ID', { infer: true }),
        TELEGRAM_API_HASH: config.get('TELEGRAM_API_HASH', { infer: true }),
        TELEGRAM_SESSION_DATABASE_URL: config.get('TELEGRAM_SESSION_DATABASE_URL', { infer: true }),
        TELEGRAM_SESSION_KEY: config.get('TELEGRAM_SESSION_KEY', { infer: true }),
      }),
    ).toEqual({ configured: false, reason: 'TELEGRAM_API_ID and TELEGRAM_API_HASH are not set' });
    await moduleRef.close();
  });
});
