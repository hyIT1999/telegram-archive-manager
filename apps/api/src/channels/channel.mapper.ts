import type { Channel } from '@tam/database';
import type { ChannelDto, ChannelStatsDto } from '@tam/shared';

export const EMPTY_CHANNEL_STATS: Readonly<ChannelStatsDto> = Object.freeze({
  messages: 0,
  media: 0,
  downloadedMedia: 0,
  storageBytes: 0,
});

/** BIGINT columns become strings; access_hash and cursors never leave the server. */
export function toChannelDto(channel: Channel, stats: ChannelStatsDto): ChannelDto {
  return {
    id: channel.id,
    telegramChatId: channel.telegramChatId.toString(),
    title: channel.title,
    username: channel.username,
    type: channel.type,
    isProtected: channel.isProtected,
    isForum: channel.isForum,
    memberCount: channel.memberCount,
    syncEnabled: channel.syncEnabled,
    headMessageId: channel.headMessageId,
    backfillComplete: channel.backfillComplete,
    lastSyncedAt: channel.lastSyncedAt?.toISOString() ?? null,
    migratedToChannelId: channel.migratedToChannelId,
    createdAt: channel.createdAt.toISOString(),
    updatedAt: channel.updatedAt.toISOString(),
    stats: { ...stats },
  };
}
