import { describe, expect, it } from 'vitest';
import { maskPhoneNumber } from '../src/telegram/phone.js';
import { mtcuteLogLevel, telegramSettingsFrom } from '../src/telegram/telegram-settings.js';

const complete = {
  TELEGRAM_API_ID: 12345678,
  TELEGRAM_API_HASH: '0123456789abcdef0123456789abcdef',
  TELEGRAM_SESSION_DATABASE_URL: 'postgresql://tam:pw@localhost:5432/tam_tg',
  TELEGRAM_SESSION_KEY: Buffer.alloc(32, 1).toString('base64'),
};

describe('telegramSettingsFrom', () => {
  it('is configured when every Telegram variable is set', () => {
    expect(telegramSettingsFrom(complete)).toMatchObject({ configured: true, apiId: 12345678 });
  });

  it('explains what is missing, naming variables but never values', () => {
    expect(telegramSettingsFrom({ ...complete, TELEGRAM_API_ID: undefined, TELEGRAM_API_HASH: undefined })).toEqual({
      configured: false,
      reason: 'TELEGRAM_API_ID and TELEGRAM_API_HASH are not set',
    });
    expect(telegramSettingsFrom({ ...complete, TELEGRAM_SESSION_DATABASE_URL: undefined })).toEqual({
      configured: false,
      reason: 'TELEGRAM_SESSION_DATABASE_URL is not set',
    });
    expect(telegramSettingsFrom({ ...complete, TELEGRAM_SESSION_KEY: undefined })).toEqual({
      configured: false,
      reason: 'TELEGRAM_SESSION_KEY is not set',
    });
  });

  it('maps LOG_LEVEL to mtcute log levels without the chatty info level', () => {
    expect([mtcuteLogLevel('error'), mtcuteLogLevel('warn'), mtcuteLogLevel('info'), mtcuteLogLevel('debug')]).toEqual([
      1, 2, 2, 3,
    ]);
  });
});

describe('maskPhoneNumber', () => {
  it('keeps the country prefix and the last two digits only', () => {
    expect(maskPhoneNumber('+84912345678')).toBe('+84•••••••78');
    expect(maskPhoneNumber('+1234')).toBe('•••••');
  });
});
