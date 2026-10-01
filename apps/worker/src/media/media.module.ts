import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { WorkerEnv } from '../config/env.schema.js';
import { TelegramModule } from '../telegram/telegram.module.js';
import { DownloadPolicy } from './download-policy.js';
import { DownloadReconciler } from './download-reconciler.js';
import { DownloadScheduler } from './download-scheduler.js';
import { DownloadStore } from './download-store.js';
import { MediaDownloader } from './media-downloader.js';
import { MediaDownloadProcessor } from './media-download.processor.js';
import {
  LOCATION_DRIVERS,
  MEDIA_SETTINGS,
  locationDriversFrom,
  mediaSettingsFrom,
} from './media-settings.js';
import { SpaceGuard } from './space-guard.js';
import { StorageTargets } from './storage-targets.js';
import { ThumbnailFetcher } from './thumbnail-fetcher.js';

/** Media downloads (media-download queue), their scheduler and reconciler, and thumbnails. */
@Module({
  imports: [TelegramModule],
  providers: [
    {
      provide: MEDIA_SETTINGS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<WorkerEnv, true>) =>
        mediaSettingsFrom({
          STORAGE_LOCAL_ROOT: config.get('STORAGE_LOCAL_ROOT', { infer: true }),
          MIN_FREE_DISK_MB: config.get('MIN_FREE_DISK_MB', { infer: true }),
          DOWNLOAD_STAGING_DIR: config.get('DOWNLOAD_STAGING_DIR', { infer: true }),
          THUMBNAIL_DIR: config.get('THUMBNAIL_DIR', { infer: true }),
        }),
    },
    {
      provide: LOCATION_DRIVERS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<WorkerEnv, true>) =>
        locationDriversFrom({
          STORAGE_SECRET_KEY: config.get('STORAGE_SECRET_KEY', { infer: true }),
          GOOGLE_OAUTH_CLIENT_ID: config.get('GOOGLE_OAUTH_CLIENT_ID', { infer: true }),
          GOOGLE_OAUTH_CLIENT_SECRET: config.get('GOOGLE_OAUTH_CLIENT_SECRET', { infer: true }),
        }),
    },
    DownloadPolicy,
    DownloadStore,
    StorageTargets,
    SpaceGuard,
    MediaDownloader,
    DownloadScheduler,
    MediaDownloadProcessor,
    DownloadReconciler,
    ThumbnailFetcher,
  ],
  // Backups read downloaded copies through the same drivers, and the cached previews.
  exports: [LOCATION_DRIVERS, MEDIA_SETTINGS],
})
export class MediaModule {}
