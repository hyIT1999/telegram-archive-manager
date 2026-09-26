import { z } from 'zod';
import type { ChatType, StorageKind } from '../enums.js';
import { cursorQuerySchema } from './common.js';

export const channelListQuerySchema = cursorQuerySchema.extend({
  q: z.string().trim().min(1).max(200).optional(),
});
export type ChannelListQuery = z.infer<typeof channelListQuerySchema>;

export interface ChannelStatsDto {
  messages: number;
  media: number;
  downloadedMedia: number;
  storageBytes: number;
}

export interface ChannelDto {
  id: string;
  telegramChatId: string;
  title: string;
  username: string | null;
  type: ChatType;
  isProtected: boolean;
  isForum: boolean;
  memberCount: number | null;
  /** New messages are read on a schedule and when Telegram announces them. */
  syncEnabled: boolean;
  /** Why automatic sync switched itself off (e.g. content protection was turned on). */
  syncNote: string | null;
  headMessageId: number | null;
  backfillComplete: boolean;
  lastSyncedAt: string | null;
  migratedToChannelId: string | null;
  /** Where new media is saved; null until chosen (the default location applies). */
  storageLocation: ChannelStorageLocationDto | null;
  /** The channel's folder inside its location, e.g. "Physics (-1001234567890)". */
  storageFolder: string | null;
  /** Media files download automatically (within the download settings). */
  downloadMedia: boolean;
  /** Why automatic downloads stopped by themselves, e.g. the chat can no longer be read. */
  downloadNote: string | null;
  createdAt: string;
  updatedAt: string;
  stats: ChannelStatsDto;
}

export interface ChannelStorageLocationDto {
  id: string;
  kind: StorageKind;
  name: string;
  displayPath: string;
}

/** PATCH /api/channels/:id — change any of the channel's settings. */
export const updateChannelRequestSchema = z
  .object({
    /** Where new media of the channel is saved. */
    storageLocationId: z.uuid().optional(),
    /** Download the channel's media automatically. */
    downloadMedia: z.boolean().optional(),
    /** Keep the channel up to date with new messages. */
    syncEnabled: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Nothing to change',
  });
export type UpdateChannelRequest = z.infer<typeof updateChannelRequestSchema>;
