import { z } from 'zod';
import type { ChatType } from '../enums.js';
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
  createdAt: string;
  updatedAt: string;
  stats: ChannelStatsDto;
}
