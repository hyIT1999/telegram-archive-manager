import path from 'node:path';
import { SecretBox } from '@tam/crypto';
import { type GoogleClientCredentials, LocalFolderPolicy } from '@tam/storage';
import type { Env } from '../config/env.js';

export const STORAGE_SETTINGS = Symbol('STORAGE_SETTINGS');
/** Google's OAuth and REST base URLs; the e2e tests point them at a fake Google. */
export const GOOGLE_ENDPOINTS = Symbol('GOOGLE_ENDPOINTS');

export interface StorageSettings {
  /** Folder of the built-in "This computer" location; null when STORAGE_LOCAL_ROOT is not set. */
  builtInRoot: string | null;
  /** Where people may add folders on this computer. */
  policy: LocalFolderPolicy;
  /** Seals cloud credentials at rest; null without STORAGE_SECRET_KEY. */
  secretBox: SecretBox | null;
  /** The Google OAuth client; null when not configured. */
  google: GoogleClientCredentials | null;
}

export function storageSettingsFrom(
  env: Pick<
    Env,
    | 'STORAGE_LOCAL_ROOT'
    | 'STORAGE_LOCAL_ROOTS'
    | 'STORAGE_SECRET_KEY'
    | 'GOOGLE_OAUTH_CLIENT_ID'
    | 'GOOGLE_OAUTH_CLIENT_SECRET'
  >,
): StorageSettings {
  const builtInRoot = env.STORAGE_LOCAL_ROOT === undefined ? null : path.resolve(env.STORAGE_LOCAL_ROOT);
  return {
    builtInRoot,
    policy: new LocalFolderPolicy(env.STORAGE_LOCAL_ROOTS ?? (builtInRoot === null ? [] : [builtInRoot])),
    secretBox: env.STORAGE_SECRET_KEY === undefined ? null : SecretBox.fromBase64(env.STORAGE_SECRET_KEY),
    google:
      env.GOOGLE_OAUTH_CLIENT_ID !== undefined && env.GOOGLE_OAUTH_CLIENT_SECRET !== undefined
        ? { clientId: env.GOOGLE_OAUTH_CLIENT_ID, clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET }
        : null,
  };
}

/** Why Google Drive locations cannot be added, or null when they can. */
export function googleDriveUnavailableReason(settings: StorageSettings): string | null {
  if (settings.google === null) {
    return 'Google Drive is not set up on the server: add GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET to .env (README §9), then restart the api.';
  }
  if (settings.secretBox === null) {
    return 'Set STORAGE_SECRET_KEY on the server first: Google credentials are stored encrypted with it (README §9).';
  }
  return null;
}
