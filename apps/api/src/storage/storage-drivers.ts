import { Inject, Injectable } from '@nestjs/common';
import { type GoogleEndpoints, LocationDriverFactory } from '@tam/storage';
import {
  GOOGLE_ENDPOINTS,
  type StorageSettings,
  STORAGE_SETTINGS,
  googleDriveUnavailableReason,
} from './storage.settings.js';

/**
 * Drivers for storage locations, kept per location while its settings and credentials stay the
 * same (so Drive folder ids and access tokens are reused between requests). The worker builds
 * the same factory from its own settings.
 */
@Injectable()
export class StorageDrivers extends LocationDriverFactory {
  constructor(
    @Inject(STORAGE_SETTINGS) settings: StorageSettings,
    @Inject(GOOGLE_ENDPOINTS) endpoints: GoogleEndpoints,
  ) {
    super({
      secrets: settings.secretBox,
      google: settings.google,
      googleUnavailableReason: googleDriveUnavailableReason(settings),
      endpoints,
    });
  }
}
