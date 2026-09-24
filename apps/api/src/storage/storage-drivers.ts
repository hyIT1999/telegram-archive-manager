import { Inject, Injectable } from '@nestjs/common';
import { SecretBoxError } from '@tam/crypto';
import type { StorageLocation } from '@tam/database';
import {
  GoogleAccessTokens,
  GoogleDriveApi,
  GoogleDriveStorageDriver,
  type GoogleEndpoints,
  GoogleOAuthClient,
  LocalStorageDriver,
  type StorageDriver,
} from '@tam/storage';
import { StorageUnavailableError } from './storage-errors.js';
import { locationConfig, secretContext } from './storage-location.mapper.js';
import {
  GOOGLE_ENDPOINTS,
  type StorageSettings,
  STORAGE_SETTINGS,
  googleDriveUnavailableReason,
} from './storage.settings.js';

/**
 * Drivers for storage locations, kept per location while its settings and credentials stay the
 * same (so Drive folder ids and access tokens are reused between requests).
 */
@Injectable()
export class StorageDrivers {
  private readonly cache = new Map<string, { version: string; driver: StorageDriver }>();

  constructor(
    @Inject(STORAGE_SETTINGS) private readonly settings: StorageSettings,
    @Inject(GOOGLE_ENDPOINTS) private readonly endpoints: GoogleEndpoints,
  ) {}

  /** The Google OAuth client, when the server is set up for Google Drive. */
  oauth(): GoogleOAuthClient {
    const reason = googleDriveUnavailableReason(this.settings);
    if (reason !== null || this.settings.google === null) {
      throw new StorageUnavailableError(reason ?? 'Google Drive is not set up on the server.');
    }
    return new GoogleOAuthClient(this.settings.google, this.endpoints);
  }

  driveApi(tokens: ConstructorParameters<typeof GoogleDriveApi>[0]): GoogleDriveApi {
    return new GoogleDriveApi(tokens, { endpoints: this.endpoints });
  }

  forLocation(location: StorageLocation): StorageDriver {
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
    return this.box().sealString(secret, secretContext(locationId));
  }

  /** The refresh token of a Google Drive location. */
  refreshToken(location: StorageLocation): string {
    if (location.secretEnc === null) {
      throw new StorageUnavailableError('This Google Drive location has no stored credentials. Reconnect it.');
    }
    try {
      return this.box().openString(location.secretEnc, secretContext(location.id));
    } catch (error) {
      if (error instanceof SecretBoxError) {
        throw new StorageUnavailableError(
          'The stored Google credentials cannot be decrypted (STORAGE_SECRET_KEY changed?). Reconnect the account.',
          { cause: error },
        );
      }
      throw error;
    }
  }

  private box() {
    if (this.settings.secretBox === null) {
      throw new StorageUnavailableError(
        googleDriveUnavailableReason(this.settings) ?? 'STORAGE_SECRET_KEY is not set.',
      );
    }
    return this.settings.secretBox;
  }

  private create(location: StorageLocation): StorageDriver {
    const config = locationConfig(location);
    if (config.kind === 'LOCAL') {
      return new LocalStorageDriver(config.path);
    }
    const tokens = new GoogleAccessTokens(this.oauth(), this.refreshToken(location));
    return new GoogleDriveStorageDriver(this.driveApi(tokens), config.folderId);
  }
}
