import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GOOGLE_ENDPOINTS as GOOGLE_API_ENDPOINTS } from '@tam/storage';
import { readEnv, type Env } from '../config/env.js';
import { GoogleDriveConnectService } from './google-drive-connect.service.js';
import { StorageDrivers } from './storage-drivers.js';
import { StorageLocationsService } from './storage-locations.service.js';
import { StorageController } from './storage.controller.js';
import { GOOGLE_ENDPOINTS, STORAGE_SETTINGS, storageSettingsFrom } from './storage.settings.js';

@Module({
  controllers: [StorageController],
  providers: [
    {
      provide: STORAGE_SETTINGS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => storageSettingsFrom(readEnv(config)),
    },
    { provide: GOOGLE_ENDPOINTS, useValue: GOOGLE_API_ENDPOINTS },
    StorageDrivers,
    StorageLocationsService,
    GoogleDriveConnectService,
  ],
})
export class StorageModule {}
