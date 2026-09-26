import { z } from 'zod';
import { MediaType } from '../enums.js';

/** Most files downloaded at the same time (one Telegram account shares its bandwidth anyway). */
export const MAX_DOWNLOAD_CONCURRENCY = 4;
/** Highest "download automatically up to" limit, in MiB (Telegram files end at 4 GB). */
export const MAX_AUTO_DOWNLOAD_MB = 4_096;

const MIB = 1024 * 1024;

const downloadSettingFields = {
  /** Stops every download, files requested one by one included. */
  paused: z.boolean(),
  /** Media types downloaded automatically; the others wait until someone requests them. */
  mediaTypes: z
    .array(z.enum(MediaType))
    .max(Object.keys(MediaType).length * 2)
    .transform((types) => [...new Set(types)]),
  /** Larger files (MiB) wait until someone requests them; null = no limit. */
  maxFileSizeMb: z.number().int().min(1).max(MAX_AUTO_DOWNLOAD_MB).nullable(),
  /** Files downloaded at the same time. */
  concurrency: z.number().int().min(1).max(MAX_DOWNLOAD_CONCURRENCY),
};

/**
 * How media files are downloaded (app_settings key "downloads"). Stored values are parsed with
 * this schema, so settings saved by an older version gain the defaults of newer fields.
 * The defaults download everything, smallest files first.
 */
export const downloadSettingsSchema = z.object({
  paused: downloadSettingFields.paused.default(false),
  mediaTypes: downloadSettingFields.mediaTypes.default(() => Object.values(MediaType)),
  maxFileSizeMb: downloadSettingFields.maxFileSizeMb.default(null),
  concurrency: downloadSettingFields.concurrency.default(2),
});
export type DownloadSettings = z.output<typeof downloadSettingsSchema>;

/** The app_settings key holding DownloadSettings. */
export const DOWNLOAD_SETTINGS_KEY = 'downloads';

export function defaultDownloadSettings(): DownloadSettings {
  return downloadSettingsSchema.parse({});
}

/** Reads stored settings; anything unreadable falls back to the defaults. */
export function readDownloadSettings(stored: unknown): DownloadSettings {
  const parsed = downloadSettingsSchema.safeParse(stored ?? {});
  return parsed.success ? parsed.data : defaultDownloadSettings();
}

/** Whether a file is downloaded without being requested (types and size of the settings). */
export function isAutoDownloaded(
  settings: Pick<DownloadSettings, 'mediaTypes' | 'maxFileSizeMb'>,
  media: { type: MediaType; size: number | null },
): boolean {
  if (!settings.mediaTypes.includes(media.type)) {
    return false;
  }
  // A size Telegram did not tell cannot exceed the limit.
  return (
    settings.maxFileSizeMb === null ||
    media.size === null ||
    media.size <= settings.maxFileSizeMb * MIB
  );
}

/** How often the worker checks each synced channel for new messages, in minutes. */
export const SYNC_INTERVAL_MINUTES = [15, 30, 60, 180, 360, 720, 1440] as const;
export type SyncIntervalMinutes = (typeof SYNC_INTERVAL_MINUTES)[number];

const syncSettingFields = {
  /**
   * Between two checks of a channel. Telegram also announces most new messages as they come, so
   * the check mostly catches what arrived while the worker was stopped.
   */
  intervalMinutes: z.literal([...SYNC_INTERVAL_MINUTES]),
};

/** How channels are synced (app_settings key "sync"); stored values are parsed like downloads. */
export const syncSettingsSchema = z.object({
  intervalMinutes: syncSettingFields.intervalMinutes.default(15),
});
export type SyncSettings = z.output<typeof syncSettingsSchema>;

/** The app_settings key holding SyncSettings. */
export const SYNC_SETTINGS_KEY = 'sync';

export function defaultSyncSettings(): SyncSettings {
  return syncSettingsSchema.parse({});
}

/** Reads stored settings; anything unreadable falls back to the defaults. */
export function readSyncSettings(stored: unknown): SyncSettings {
  const parsed = syncSettingsSchema.safeParse(stored ?? {});
  return parsed.success ? parsed.data : defaultSyncSettings();
}

function changesSomething(value: Record<string, unknown>): boolean {
  return Object.values(value).some((field) => field !== undefined);
}

/** PATCH /api/settings — only the given fields change. */
export const updateSettingsRequestSchema = z
  .object({
    downloads: z
      .object(downloadSettingFields)
      .partial()
      .refine(changesSomething, { message: 'Nothing to change' })
      .optional(),
    sync: z
      .object(syncSettingFields)
      .partial()
      .refine(changesSomething, { message: 'Nothing to change' })
      .optional(),
  })
  .refine(changesSomething, { message: 'Nothing to change' });
export type UpdateSettingsRequest = z.infer<typeof updateSettingsRequestSchema>;

/** GET /api/settings */
export interface SettingsDto {
  downloads: DownloadSettings;
  sync: SyncSettings;
  /** Server limits shown for information; they change in the server's .env. */
  disk: {
    /** Downloads to a folder on the server stop before its disk has less free space (MIN_FREE_DISK_MB). */
    minFreeDiskMb: number;
  };
}
