import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '@tam/database/nest';
import { DOWNLOAD_SETTINGS_KEY, type DownloadSettings, readDownloadSettings } from '@tam/shared';
import { MEDIA_SETTINGS, type MediaSettings } from './media-settings.js';

/**
 * The download settings people chose (Settings page, app_settings "downloads"), read again every
 * few seconds so a change applies without restarting the worker.
 */
@Injectable()
export class DownloadPolicy {
  private cached: { settings: DownloadSettings; readAt: number } | undefined;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MEDIA_SETTINGS) private readonly settings: MediaSettings,
  ) {}

  async current(): Promise<DownloadSettings> {
    const now = Date.now();
    if (this.cached && now - this.cached.readAt < this.settings.settingsCacheMs) {
      return this.cached.settings;
    }
    const row = await this.prisma.appSetting.findUnique({ where: { key: DOWNLOAD_SETTINGS_KEY } });
    const settings = readDownloadSettings(row?.value);
    this.cached = { settings, readAt: now };
    return settings;
  }
}
