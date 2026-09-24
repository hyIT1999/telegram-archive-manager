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
  syncEnabled: boolean;
  headMessageId: number | null;
  backfillComplete: boolean;
  lastSyncedAt: string | null;
  migratedToChannelId: string | null;
  /** Where new media is saved; null until chosen (the default location applies). */
  storageLocation: ChannelStorageLocationDto | null;
  /** The channel's folder inside its location, e.g. "Physics (-1001234567890)". */
  storageFolder: string | null;
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

/** PATCH /api/channels/:id */
export const updateChannelRequestSchema = z.object({
  /** Where new media of the channel is saved. */
  storageLocationId: z.uuid(),
});
export type UpdateChannelRequest = z.infer<typeof updateChannelRequestSchema>;
