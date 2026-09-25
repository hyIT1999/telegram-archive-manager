import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@tam/database/nest';
import {
  DOWNLOAD_SETTINGS_KEY,
  type DownloadSettings,
  type SettingsDto,
  type UpdateSettingsRequest,
  downloadSettingsSchema,
  readDownloadSettings,
} from '@tam/shared';
import type { Env } from '../config/env.js';
import {
  applyDownloadPolicy,
  loadDownloadSettings,
  stopRunningDownloads,
} from '../downloads/download-rules.js';

/** Settings changes touch many download rows at once. */
const TRANSACTION_OPTIONS = { timeout: 60_000, maxWait: 5_000 } as const;

/** Archive settings people change in the web (for now: how media files are downloaded). */
@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async get(): Promise<SettingsDto> {
    return this.toDto(await loadDownloadSettings(this.prisma));
  }

  /**
   * Saves the given download settings (the others keep their value) and applies them at once:
   * files the new types and size allow go back in line, waiting files they no longer allow are
   * skipped, and pausing stops running downloads (they resume from their partial files later).
   */
  async update(request: UpdateSettingsRequest): Promise<SettingsDto> {
    const saved = await this.prisma.$transaction(async (tx) => {
      // One change at a time: the row is locked from reading to writing.
      await tx.$executeRaw`
        INSERT INTO app_settings (key, value, updated_at) VALUES (${DOWNLOAD_SETTINGS_KEY}, '{}'::jsonb, now())
        ON CONFLICT (key) DO NOTHING`;
      const [row] = await tx.$queryRaw<{ value: unknown }[]>`
        SELECT value FROM app_settings WHERE key = ${DOWNLOAD_SETTINGS_KEY} FOR UPDATE`;
      const current = readDownloadSettings(row?.value);
      const next: DownloadSettings = downloadSettingsSchema.parse({
        ...current,
        ...request.downloads,
      });
      await tx.appSetting.update({ where: { key: DOWNLOAD_SETTINGS_KEY }, data: { value: next } });
      if (
        request.downloads.mediaTypes !== undefined ||
        request.downloads.maxFileSizeMb !== undefined
      ) {
        await applyDownloadPolicy(tx, next);
      }
      if (next.paused && !current.paused) {
        await stopRunningDownloads(tx);
      }
      return next;
    }, TRANSACTION_OPTIONS);
    return this.toDto(saved);
  }

  private toDto(downloads: DownloadSettings): SettingsDto {
    return {
      downloads,
      disk: { minFreeDiskMb: this.config.get('MIN_FREE_DISK_MB', { infer: true }) },
    };
  }
}
