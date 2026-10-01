import { StorageError } from './errors.js';
import { GoogleDriveApi, type GoogleDriveApiOptions } from './google/google-drive-api.js';
import { GoogleDriveStorageDriver } from './google/google-drive-driver.js';
import {
  type AccessTokenSource,
  GOOGLE_ENDPOINTS,
  GoogleAccessTokens,
  type GoogleClientCredentials,
  type GoogleEndpoints,
  GoogleOAuthClient,
} from './google/google-oauth.js';
import { LocalStorageDriver } from './local/local-storage-driver.js';
import type { LocationKind, StorageDriver, StorageKind } from './storage-driver.js';

/** The server lacks what a storage location needs (Google client, STORAGE_SECRET_KEY, …). */
export class StorageUnavailableError extends StorageError {}

export interface LocalLocationConfig {
  path: string;
}

export interface GoogleDriveLocationConfig {
  folderId: string;
  folderName: string;
  accountEmail: string | null;
}

/** A Telegram backup chat: the worker sends copies of messages there, never through a driver. */
export interface TelegramLocationConfig {
  /** Marked chat id (-100…), as a decimal string. */
  chatId: string;
  title: string;
  username: string | null;
  type: 'CHANNEL' | 'SUPERGROUP';
  /** Topics of an archived forum are recreated in it. */
  isForum: boolean;
}

export type LocationConfig =
  | ({ kind: 'LOCAL' } & LocalLocationConfig)
  | ({ kind: 'GOOGLE_DRIVE' } & GoogleDriveLocationConfig)
  | ({ kind: 'TELEGRAM' } & TelegramLocationConfig);

/** The columns of a storage_locations row that decide how to reach it. */
export interface StorageLocationRecord {
  id: string;
  kind: LocationKind;
  /** Non-secret settings: { path }, { folderId, folderName, accountEmail } or a Telegram chat. */
  config: unknown;
  /** Sealed credentials (a Google refresh token); null for folders on the server. */
  secretEnc: Uint8Array | null;
}

/** A storage location files are written to (it has a driver). */
export type DriverLocationRecord = StorageLocationRecord & { kind: StorageKind };

/** True for the locations files are written to; false for Telegram backup chats. */
export function isDriverLocation<T extends { kind: LocationKind }>(
  location: T,
): location is T & { kind: StorageKind } {
  return location.kind === 'LOCAL' || location.kind === 'GOOGLE_DRIVE';
}

function text(config: Record<string, unknown>, name: string): string {
  const value = config[name];
  if (typeof value !== 'string' || value === '') {
    throw new StorageError(`The settings of this storage location lack "${name}".`);
  }
  return value;
}

/** The non-secret settings stored in storage_locations.config, checked against the kind. */
export function locationConfig(
  location: Pick<StorageLocationRecord, 'kind' | 'config'>,
): LocationConfig {
  const config =
    typeof location.config === 'object' && location.config !== null
      ? (location.config as Record<string, unknown>)
      : {};
  if (location.kind === 'LOCAL') {
    return { kind: 'LOCAL', path: text(config, 'path') };
  }
  if (location.kind === 'TELEGRAM') {
    const username = config['username'];
    return {
      kind: 'TELEGRAM',
      chatId: text(config, 'chatId'),
      title: text(config, 'title'),
      username: typeof username === 'string' && username !== '' ? username : null,
      type: config['type'] === 'CHANNEL' ? 'CHANNEL' : 'SUPERGROUP',
      isForum: config['isForum'] === true,
    };
  }
  const email = config['accountEmail'];
  return {
    kind: 'GOOGLE_DRIVE',
    folderId: text(config, 'folderId'),
    folderName: text(config, 'folderName'),
    accountEmail: typeof email === 'string' ? email : null,
  };
}

/** AAD of the sealed credentials: a ciphertext copied into another row does not decrypt. */
export function secretContext(locationId: string): string {
  return `storage_locations.secret:${locationId}`;
}

/** Seals credentials at rest (a SecretBox of @tam/crypto); opening a damaged one throws. */
export interface SecretSealer {
  sealString(value: string, context: string): Uint8Array<ArrayBuffer>;
  openString(sealed: Uint8Array, context: string): string;
}

export interface LocationDriverFactoryOptions {
  /** Null without STORAGE_SECRET_KEY: Google Drive locations cannot be reached. */
  secrets: SecretSealer | null;
  /** Null when the server has no Google OAuth client. */
  google: GoogleClientCredentials | null;
  /** Why Google Drive cannot be used on this server (said to people), or null when it can. */
  googleUnavailableReason: string | null;
  endpoints?: GoogleEndpoints;
  /** Retries, chunk size… of the Drive client (tests make them fast). */
  driveOptions?: Omit<GoogleDriveApiOptions, 'endpoints'>;
}

/**
 * Drivers of storage locations, kept per location while its settings and credentials stay the
 * same (so Drive folder ids and access tokens are reused). Shared by the api and the worker.
 */
export class LocationDriverFactory {
  private readonly cache = new Map<string, { version: string; driver: StorageDriver }>();
  private readonly endpoints: GoogleEndpoints;

  constructor(private readonly options: LocationDriverFactoryOptions) {
    this.endpoints = options.endpoints ?? GOOGLE_ENDPOINTS;
  }

  /** The Google OAuth client, when the server is set up for Google Drive. */
  oauth(): GoogleOAuthClient {
    const { google, googleUnavailableReason } = this.options;
    if (googleUnavailableReason !== null || google === null) {
      throw new StorageUnavailableError(
        googleUnavailableReason ?? 'Google Drive is not set up on the server.',
      );
    }
    return new GoogleOAuthClient(google, this.endpoints);
  }

  driveApi(tokens: AccessTokenSource): GoogleDriveApi {
    return new GoogleDriveApi(tokens, { ...this.options.driveOptions, endpoints: this.endpoints });
  }

  forLocation(location: DriverLocationRecord): StorageDriver {
    const version = `${JSON.stringify(location.config)}|${Buffer.from(location.secretEnc ?? new Uint8Array()).toString('base64')}`;
    const cached = this.cache.get(location.id);
    if (cached?.version === version) {
      return cached.driver;
    }
    const driver = this.create(location);
    this.cache.set(location.id, { version, driver });
    return driver;
  }

  forget(locationId: string): void {
    this.cache.delete(locationId);
  }

  seal(locationId: string, secret: string): Uint8Array<ArrayBuffer> {
    return this.sealer().sealString(secret, secretContext(locationId));
  }

  /** The refresh token of a Google Drive location. */
  refreshToken(location: StorageLocationRecord): string {
    if (location.secretEnc === null) {
      throw new StorageUnavailableError(
        'This Google Drive location has no stored credentials. Reconnect it.',
      );
    }
    const sealer = this.sealer();
    try {
      return sealer.openString(location.secretEnc, secretContext(location.id));
    } catch (error) {
      throw new StorageUnavailableError(
        'The stored Google credentials cannot be decrypted (STORAGE_SECRET_KEY changed?). Reconnect the account.',
        { cause: error },
      );
    }
  }

  private sealer(): SecretSealer {
    if (this.options.secrets === null) {
      throw new StorageUnavailableError(
        this.options.googleUnavailableReason ?? 'STORAGE_SECRET_KEY is not set.',
      );
    }
    return this.options.secrets;
  }

  private create(location: DriverLocationRecord): StorageDriver {
    const config = locationConfig(location);
    if (config.kind === 'LOCAL') {
      return new LocalStorageDriver(config.path);
    }
    if (config.kind === 'TELEGRAM') {
      // The types keep backup chats out; this guards rows read without them.
      throw new StorageUnavailableError('A Telegram backup chat holds no downloaded files.');
    }
    const tokens = new GoogleAccessTokens(this.oauth(), this.refreshToken(location));
    return new GoogleDriveStorageDriver(this.driveApi(tokens), config.folderId);
  }
}
