import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { configModuleOptions } from '../../src/config/config-module.js';
import { type Env, readEnv } from '../../src/config/env.js';
import { storageSettingsFrom } from '../../src/storage/storage.settings.js';

const VARIABLES = {
  DATABASE_URL: 'postgresql://tam:secret@localhost:5432/tam',
  REDIS_URL: 'redis://:secret@127.0.0.1:6380/0',
  API_PORT: '4000',
  // Blank, as copied from .env.example.
  STORAGE_LOCAL_ROOTS: '',
  STORAGE_SECRET_KEY: '',
  GOOGLE_OAUTH_CLIENT_ID: '',
  GOOGLE_OAUTH_CLIENT_SECRET: '',
};

describe('configModuleOptions', () => {
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

  it('keeps blank optional settings unset instead of reading "" back from process.env', async () => {
    Object.assign(process.env, VARIABLES);
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ ...configModuleOptions(), ignoreEnvFile: true })],
    }).compile();

    const env = readEnv(moduleRef.get<ConfigService<Env, true>>(ConfigService));
    expect(env.API_PORT).toBe(4000);
    expect(env.STORAGE_LOCAL_ROOTS).toBeUndefined();
    expect(env.STORAGE_SECRET_KEY).toBeUndefined();
    expect(env.GOOGLE_OAUTH_CLIENT_ID).toBeUndefined();

    const settings = storageSettingsFrom(env);
    expect(settings.google).toBeNull();
    expect(settings.secretBox).toBeNull();
    await moduleRef.close();
  });

  it('refuses to start with an invalid variable, naming it without its value', async () => {
    Object.assign(process.env, VARIABLES, { STORAGE_SECRET_KEY: 'short-secret-value' });
    await expect(
      Test.createTestingModule({
        imports: [ConfigModule.forRoot({ ...configModuleOptions(), ignoreEnvFile: true })],
      }).compile(),
    ).rejects.toThrow(/Invalid api environment:\nSTORAGE_SECRET_KEY: must be 32 random bytes/);
  });
});
