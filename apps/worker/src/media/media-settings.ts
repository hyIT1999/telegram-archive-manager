import path from 'node:path';
import { SecretBox } from '@tam/crypto';
import { LocationDriverFactory, STAGING_FOLDER, THUMBNAIL_FOLDER } from '@tam/storage';
import type { WorkerEnv } from '../config/env.schema.js';

/** MediaSettings, derived from the environment (tests pass their own). */
export const MEDIA_SETTINGS = Symbol('MEDIA_SETTINGS');
/** The LocationDriverFactory the worker reaches storage locations with (tests point it at a fake Google). */
export const LOCATION_DRIVERS = Symbol('LOCATION_DRIVERS');

export interface MediaSettings {
  /** How often waiting downloads are handed to the queue (and after every finished try). */
  schedulerIntervalMs: number;
  /** How often download_jobs are compared with the queue and staging folders are cleaned. */
  reconcileIntervalMs: number;
  /** A try gives up when Telegram sends no data for this long. */
  stallTimeoutMs: number;
  /** Failed tries of a file before it is FAILED; waiting for Telegram or for space never counts. */
  maxAttempts: number;
  /** Delay after the first failed try; it doubles with every further one, up to retryMaxMs. */
  retryBaseMs: number;
  retryMaxMs: number;
  /** Delay while Telegram is not connected or the account is logged out. */
  unavailableRetryMs: number;
  /** Progress is written to the database at most this often. */
  progressIntervalMs: number;
  /** Folders on this server always keep this much free space (MIN_FREE_DISK_MB). */
  minFreeBytes: number;
  /** Where files for Google Drive wait before the upload; null when not configured. */
  stagingDir: string | null;
  /** Cache of Telegram's previews; null turns thumbnails off. */
  thumbnailDir: string | null;
  /** Pause between two batches of thumbnails. */
  thumbnailIntervalMs: number;
  /** One thumbnail that takes longer is given up on (the file then shows no preview). */
  thumbnailTimeoutMs: number;
  /** Download settings are read from the database at most this often. */
  settingsCacheMs: number;
  /** Unfinished downloads nobody touched for this long are deleted. */
  partRetentionMs: number;
  /** An ACTIVE try without news for this long is checked against the queue. */
  lostAfterMs: number;
}

export function mediaSettingsFrom(
  env: Pick<
    WorkerEnv,
    'STORAGE_LOCAL_ROOT' | 'MIN_FREE_DISK_MB' | 'DOWNLOAD_STAGING_DIR' | 'THUMBNAIL_DIR'
  >,
): MediaSettings {
  const root = env.STORAGE_LOCAL_ROOT;
  return {
    schedulerIntervalMs: 3_000,
    reconcileIntervalMs: 60_000,
    stallTimeoutMs: 120_000,
    maxAttempts: 8,
    retryBaseMs: 30_000,
    retryMaxMs: 60 * 60_000,
    unavailableRetryMs: 30_000,
    progressIntervalMs: 1_000,
    minFreeBytes: env.MIN_FREE_DISK_MB * 1024 * 1024,
    stagingDir:
      env.DOWNLOAD_STAGING_DIR ?? (root === undefined ? null : path.join(root, STAGING_FOLDER)),
    thumbnailDir:
      env.THUMBNAIL_DIR ?? (root === undefined ? null : path.join(root, THUMBNAIL_FOLDER)),
    thumbnailIntervalMs: 2_000,
    thumbnailTimeoutMs: 30_000,
    settingsCacheMs: 5_000,
    partRetentionMs: 14 * 24 * 60 * 60_000,
    lostAfterMs: 2 * 60_000,
  };
}

/** Why the worker cannot reach Google Drive locations, or null when it can. */
export function googleDriveUnavailableReason(
  env: Pick<
    WorkerEnv,
    'STORAGE_SECRET_KEY' | 'GOOGLE_OAUTH_CLIENT_ID' | 'GOOGLE_OAUTH_CLIENT_SECRET'
  >,
): string | null {
  if (env.GOOGLE_OAUTH_CLIENT_ID === undefined || env.GOOGLE_OAUTH_CLIENT_SECRET === undefined) {
    return 'The worker is not set up for Google Drive: add GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET to its .env (README §9), then restart it.';
  }
  if (env.STORAGE_SECRET_KEY === undefined) {
    return 'The worker needs STORAGE_SECRET_KEY (the same key as the api) to use the stored Google credentials (README §9).';
  }
  return null;
}

export function locationDriversFrom(
  env: Pick<
    WorkerEnv,
    'STORAGE_SECRET_KEY' | 'GOOGLE_OAUTH_CLIENT_ID' | 'GOOGLE_OAUTH_CLIENT_SECRET'
  >,
): LocationDriverFactory {
  return new LocationDriverFactory({
    secrets:
      env.STORAGE_SECRET_KEY === undefined ? null : SecretBox.fromBase64(env.STORAGE_SECRET_KEY),
    google:
      env.GOOGLE_OAUTH_CLIENT_ID !== undefined && env.GOOGLE_OAUTH_CLIENT_SECRET !== undefined
        ? { clientId: env.GOOGLE_OAUTH_CLIENT_ID, clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET }
        : null,
    googleUnavailableReason: googleDriveUnavailableReason(env),
  });
}
