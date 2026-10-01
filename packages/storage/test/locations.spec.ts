import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  GoogleDriveStorageDriver,
  LocalStorageDriver,
  LocationDriverFactory,
  type SecretSealer,
  StorageUnavailableError,
  isDriverLocation,
  locationConfig,
  secretContext,
} from '../src/index.js';

/** Reversible stand-in for SecretBox that still checks the context. */
const sealer: SecretSealer = {
  sealString: (value, context) => new Uint8Array(Buffer.from(JSON.stringify({ value, context }))),
  openString: (sealed, context) => {
    const parsed = JSON.parse(Buffer.from(sealed).toString()) as { value: string; context: string };
    if (parsed.context !== context) {
      throw new Error('wrong context');
    }
    return parsed.value;
  },
};

const google = { clientId: 'client', clientSecret: 'secret' };

describe('storage location settings', () => {
  it('reads the settings of each kind', () => {
    expect(locationConfig({ kind: 'LOCAL', config: { path: 'D:\\Telegram' } })).toEqual({
      kind: 'LOCAL',
      path: 'D:\\Telegram',
    });
    expect(
      locationConfig({
        kind: 'GOOGLE_DRIVE',
        config: { folderId: 'f1', folderName: 'Archive', accountEmail: null },
      }),
    ).toEqual({ kind: 'GOOGLE_DRIVE', folderId: 'f1', folderName: 'Archive', accountEmail: null });
    expect(
      locationConfig({
        kind: 'TELEGRAM',
        config: { chatId: '-1001234567890', title: 'Backups', type: 'SUPERGROUP', isForum: true },
      }),
    ).toEqual({
      kind: 'TELEGRAM',
      chatId: '-1001234567890',
      title: 'Backups',
      username: null,
      type: 'SUPERGROUP',
      isForum: true,
    });
  });

  it('refuses settings that do not fit the kind', () => {
    expect(() => locationConfig({ kind: 'LOCAL', config: {} })).toThrow(/lack "path"/);
    expect(() => locationConfig({ kind: 'GOOGLE_DRIVE', config: { folderName: 'x' } })).toThrow(
      /folderId/,
    );
    expect(() => locationConfig({ kind: 'LOCAL', config: null })).toThrow();
    expect(() => locationConfig({ kind: 'TELEGRAM', config: { title: 'x' } })).toThrow(/chatId/);
  });

  it('tells download locations from Telegram backup chats', () => {
    expect(isDriverLocation({ kind: 'LOCAL' })).toBe(true);
    expect(isDriverLocation({ kind: 'GOOGLE_DRIVE' })).toBe(true);
    expect(isDriverLocation({ kind: 'TELEGRAM' })).toBe(false);
  });
});

describe('LocationDriverFactory', () => {
  let base: string;

  beforeEach(async () => {
    base = await mkdtemp(path.join(tmpdir(), 'tam-factory-'));
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('keeps one driver per location until its settings change', () => {
    const factory = new LocationDriverFactory({
      secrets: null,
      google: null,
      googleUnavailableReason: 'no',
    });
    const location = { id: 'a', kind: 'LOCAL' as const, config: { path: base }, secretEnc: null };

    const driver = factory.forLocation(location);
    expect(driver).toBeInstanceOf(LocalStorageDriver);
    expect(factory.forLocation({ ...location })).toBe(driver);
    expect(
      factory.forLocation({ ...location, config: { path: path.join(base, 'other') } }),
    ).not.toBe(driver);

    const current = factory.forLocation(location);
    factory.forget('a');
    expect(factory.forLocation(location)).not.toBe(current);
  });

  it('opens the sealed Google credentials of a Drive location', () => {
    const factory = new LocationDriverFactory({
      secrets: sealer,
      google,
      googleUnavailableReason: null,
    });
    const location = {
      id: 'drive',
      kind: 'GOOGLE_DRIVE' as const,
      config: { folderId: 'f1', folderName: 'Archive', accountEmail: 'me@example.com' },
      secretEnc: factory.seal('drive', 'refresh-token'),
    };
    expect(factory.refreshToken(location)).toBe('refresh-token');
    expect(factory.forLocation(location)).toBeInstanceOf(GoogleDriveStorageDriver);
    expect(secretContext('drive')).toBe('storage_locations.secret:drive');

    // A sealed secret copied to another location does not open there.
    expect(() => factory.refreshToken({ ...location, id: 'other' })).toThrow(
      StorageUnavailableError,
    );
    expect(() => factory.refreshToken({ ...location, secretEnc: null })).toThrow(/Reconnect/);
  });

  it('explains why Google Drive cannot be used on this server', () => {
    const factory = new LocationDriverFactory({
      secrets: null,
      google: null,
      googleUnavailableReason: 'Set GOOGLE_OAUTH_CLIENT_ID first.',
    });
    expect(() => factory.oauth()).toThrow('Set GOOGLE_OAUTH_CLIENT_ID first.');
    expect(() =>
      factory.forLocation({
        id: 'drive',
        kind: 'GOOGLE_DRIVE',
        config: { folderId: 'f1', folderName: 'Archive', accountEmail: null },
        secretEnc: new Uint8Array([1]),
      }),
    ).toThrow(StorageUnavailableError);
    expect(() => factory.seal('x', 'secret')).toThrow(StorageUnavailableError);
  });

  it('never builds a driver for a Telegram backup chat, even from an untyped row', () => {
    const factory = new LocationDriverFactory({
      secrets: null,
      google: null,
      googleUnavailableReason: 'no',
    });
    const row = {
      id: 'chat',
      kind: 'TELEGRAM',
      config: { chatId: '-1001', title: 'Backups', type: 'CHANNEL', isForum: false },
      secretEnc: null,
    } as unknown as Parameters<LocationDriverFactory['forLocation']>[0];
    expect(() => factory.forLocation(row)).toThrow(/Telegram backup chat/);
  });
});
