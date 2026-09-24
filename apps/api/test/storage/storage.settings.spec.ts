import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { googleDriveUnavailableReason, storageSettingsFrom } from '../../src/storage/storage.settings.js';

const google = {
  GOOGLE_OAUTH_CLIENT_ID: '1234-abc.apps.googleusercontent.com',
  GOOGLE_OAUTH_CLIENT_SECRET: 'GOCSPX-secret',
};

describe('storageSettingsFrom', () => {
  it('allows the built-in folder when no other roots are listed', () => {
    const root = path.resolve('archive');
    const settings = storageSettingsFrom({ STORAGE_LOCAL_ROOT: root });
    expect(settings.builtInRoot).toBe(root);
    expect(settings.policy.roots).toEqual([root]);
    expect(settings.secretBox).toBeNull();
    expect(settings.google).toBeNull();
  });

  it('uses the listed roots, and allows nothing without any folder setting', () => {
    const roots = [path.resolve('a'), path.resolve('b')];
    expect(storageSettingsFrom({ STORAGE_LOCAL_ROOT: path.resolve('x'), STORAGE_LOCAL_ROOTS: roots }).policy.roots).toEqual(roots);
    const none = storageSettingsFrom({});
    expect(none.builtInRoot).toBeNull();
    expect(none.policy.roots).toEqual([]);
  });

  it('explains what Google Drive still needs', () => {
    expect(googleDriveUnavailableReason(storageSettingsFrom({}))).toMatch(/GOOGLE_OAUTH_CLIENT_ID/);
    expect(googleDriveUnavailableReason(storageSettingsFrom(google))).toMatch(/STORAGE_SECRET_KEY/);
    expect(
      googleDriveUnavailableReason(
        storageSettingsFrom({ ...google, STORAGE_SECRET_KEY: randomBytes(32).toString('base64') }),
      ),
    ).toBeNull();
  });
});
