import type { Channel, StorageLocation } from '@tam/database';
import type { ChannelDto, ChannelStatsDto } from '@tam/shared';

export const EMPTY_CHANNEL_STATS: Readonly<ChannelStatsDto> = Object.freeze({
  messages: 0,
  media: 0,
  downloadedMedia: 0,
  storageBytes: 0,
});

/** What channel queries load next to the row (`include`), so the DTO can name the location. */
export const CHANNEL_INCLUDE = { storageLocation: true } as const;

export type ChannelWithStorage = Channel & { storageLocation: StorageLocation | null };

/** BIGINT columns become strings; access_hash and cursors never leave the server. */
export function toChannelDto(channel: ChannelWithStorage, stats: ChannelStatsDto): ChannelDto {
  const location = channel.storageLocation;
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
    storageLocation: location
      ? { id: location.id, kind: location.kind, name: location.name, displayPath: location.displayPath }
      : null,
    storageFolder: channel.storageFolder,
    createdAt: channel.createdAt.toISOString(),
    updatedAt: channel.updatedAt.toISOString(),
    stats: { ...stats },
  };
}
