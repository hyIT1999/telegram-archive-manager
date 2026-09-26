import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@tam/database';
import { PrismaService } from '@tam/database/nest';
import {
  DOWNLOAD_SETTINGS_KEY,
  type DownloadSettings,
  SYNC_SETTINGS_KEY,
  type SettingsDto,
  type SyncSettings,
  type UpdateSettingsRequest,
  downloadSettingsSchema,
  readDownloadSettings,
  readSyncSettings,
  syncSettingsSchema,
} from '@tam/shared';
import type { Env } from '../config/env.js';
import {
  applyDownloadPolicy,
  loadDownloadSettings,
  stopRunningDownloads,
} from '../downloads/download-rules.js';

/** Settings changes touch many download rows at once. */
const TRANSACTION_OPTIONS = { timeout: 60_000, maxWait: 5_000 } as const;

type Tx = Prisma.TransactionClient;

/** Archive settings people change in the web: how media files download, and how often to sync. */
@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async get(): Promise<SettingsDto> {
    const [downloads, sync] = await Promise.all([
      loadDownloadSettings(this.prisma),
      loadSyncSettings(this.prisma),
    ]);
    return this.toDto(downloads, sync);
  }

  /**
   * Saves the given settings (the others keep their value). Download settings apply at once:
   * files the new types and size allow go back in line, waiting files they no longer allow are
   * skipped, and pausing stops running downloads (they resume from their partial files later).
   * The sync interval applies from the worker's next round.
   */
  async update(request: UpdateSettingsRequest): Promise<SettingsDto> {
    const saved = await this.prisma.$transaction(async (tx) => {
      const downloads = request.downloads
        ? await saveDownloadSettings(tx, request.downloads)
        : await loadDownloadSettings(tx);
      const sync = request.sync
        ? await saveSyncSettings(tx, request.sync)
        : await loadSyncSettings(tx);
      return { downloads, sync };
    }, TRANSACTION_OPTIONS);
    return this.toDto(saved.downloads, saved.sync);
  }

  private toDto(downloads: DownloadSettings, sync: SyncSettings): SettingsDto {
    return {
      downloads,
      sync,
      disk: { minFreeDiskMb: this.config.get('MIN_FREE_DISK_MB', { infer: true }) },
    };
  }
}

async function loadSyncSettings(prisma: PrismaService | Tx): Promise<SyncSettings> {
  const row = await prisma.appSetting.findUnique({ where: { key: SYNC_SETTINGS_KEY } });
  return readSyncSettings(row?.value);
}

/** The stored value of `key`, locked from reading to writing: one change at a time. */
async function lockedSetting(tx: Tx, key: string): Promise<unknown> {
  await tx.$executeRaw`
    INSERT INTO app_settings (key, value, updated_at) VALUES (${key}, '{}'::jsonb, now())
    ON CONFLICT (key) DO NOTHING`;
  const [row] = await tx.$queryRaw<{ value: unknown }[]>`
    SELECT value FROM app_settings WHERE key = ${key} FOR UPDATE`;
  return row?.value;
}

async function saveDownloadSettings(
  tx: Tx,
  changes: NonNullable<UpdateSettingsRequest['downloads']>,
): Promise<DownloadSettings> {
  const current = readDownloadSettings(await lockedSetting(tx, DOWNLOAD_SETTINGS_KEY));
  const next: DownloadSettings = downloadSettingsSchema.parse({ ...current, ...changes });
  await tx.appSetting.update({ where: { key: DOWNLOAD_SETTINGS_KEY }, data: { value: next } });
  if (changes.mediaTypes !== undefined || changes.maxFileSizeMb !== undefined) {
    await applyDownloadPolicy(tx, next);
  }
  if (next.paused && !current.paused) {
    await stopRunningDownloads(tx);
  }
  return next;
}

async function saveSyncSettings(
  tx: Tx,
  changes: NonNullable<UpdateSettingsRequest['sync']>,
): Promise<SyncSettings> {
  const current = readSyncSettings(await lockedSetting(tx, SYNC_SETTINGS_KEY));
  const next: SyncSettings = syncSettingsSchema.parse({ ...current, ...changes });
  await tx.appSetting.update({ where: { key: SYNC_SETTINGS_KEY }, data: { value: next } });
  return next;
}
