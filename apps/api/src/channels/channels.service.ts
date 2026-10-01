import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { type Channel, type Prisma, seedMessageBackups } from '@tam/database';
import { PrismaService } from '@tam/database/nest';
import {
  ApiErrorCode,
  BackupErrorCode,
  type ChannelDto,
  type ChannelListQuery,
  ImportErrorCode,
  type Page,
  StorageKind,
  TelegramErrorCode,
  type UpdateChannelRequest,
} from '@tam/shared';
import { channelFolderName, isDriverLocation } from '@tam/storage';
import { z } from 'zod';
import { stopRunningBackups, withOldGroups } from '../backups/backup-rules.js';
import { decodeCursor, encodeCursor } from '../common/pagination/cursor.js';
import { stopRunningDownloads } from '../downloads/download-rules.js';
import {
  CHANNEL_INCLUDE,
  type ChannelWithStorage,
  EMPTY_CHANNEL_STATS,
  toChannelDto,
} from './channel.mapper.js';
import { loadChannelStats } from './channel-stats.js';

/**
 * Switching backup on creates a row for every archived message of the channel, which takes a
 * moment for a large archive.
 */
const UPDATE_TRANSACTION = { timeout: 60_000, maxWait: 5_000 } as const;

/** Keyset position in the (createdAt desc, id desc) order. */
const channelCursorSchema = z
  .tuple([z.iso.datetime(), z.uuid()])
  .transform(([createdAt, id]) => ({ createdAt: new Date(createdAt), id }));
type ChannelCursor = z.output<typeof channelCursorSchema>;

@Injectable()
export class ChannelsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ChannelListQuery): Promise<Page<ChannelDto>> {
    const cursor =
      query.cursor === undefined ? undefined : decodeCursor(query.cursor, channelCursorSchema);
    const rows = await this.prisma.channel.findMany({
      where: { AND: [searchFilter(query.q), afterCursor(cursor)] },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      include: CHANNEL_INCLUDE,
    });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page.at(-1);
    return {
      items: await this.withStatsAll(page),
      nextCursor: hasMore && last ? encodeCursor([last.createdAt.toISOString(), last.id]) : null,
    };
  }

  async get(id: string): Promise<ChannelDto> {
    const channel = await this.prisma.channel.findUnique({
      where: { id },
      include: CHANNEL_INCLUDE,
    });
    if (!channel) {
      throw channelNotFound();
    }
    return this.withStats(channel);
  }

  /**
   * Chooses where the channel's media is saved, whether it downloads automatically, and whether
   * it syncs.
   *
   * The channel's folder name is fixed the first time a location is chosen, so a later rename in
   * Telegram does not split its files over two folders. The old basic group of an upgraded
   * supergroup follows the download switch; switching off stops running downloads nobody asked
   * for (they keep their partial files and go on when switched on again). Protected chats and old
   * groups never sync; switching sync on clears why it had stopped by itself.
   *
   * The backup chat must be a Telegram location, never the channel itself. While backup is on,
   * every archived message of the channel (and of its old basic group) gets a backup row, so the
   * panel counts them at once; switching it off takes back running backups nobody asked for.
   */
  async update(id: string, request: UpdateChannelRequest): Promise<ChannelDto> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const channel = await tx.channel.findUnique({ where: { id } });
      if (!channel) {
        throw channelNotFound();
      }
      const data: Prisma.ChannelUncheckedUpdateInput = {};
      if (request.storageLocationId !== undefined) {
        const location = await tx.storageLocation.findUnique({
          where: { id: request.storageLocationId },
          select: { id: true, kind: true },
        });
        if (!location) {
          throw locationNotFound();
        }
        if (!isDriverLocation(location)) {
          throw new UnprocessableEntityException({
            code: BackupErrorCode.LOCATION_KIND_NOT_ALLOWED,
            message:
              'Media is downloaded to a folder or to Google Drive. A Telegram chat can only receive backups.',
          });
        }
        data.storageLocationId = location.id;
        data.storageFolder =
          channel.storageFolder ??
          channelFolderName(channel.title, channel.telegramChatId.toString());
      }
      if (request.downloadMedia !== undefined) {
        const oldGroups = await tx.channel.findMany({
          where: { migratedToChannelId: id },
          select: { id: true },
        });
        const ids = [id, ...oldGroups.map((group) => group.id)];
        await tx.channel.updateMany({
          where: { id: { in: ids } },
          data: {
            downloadMedia: request.downloadMedia,
            ...(request.downloadMedia ? { downloadNote: null } : {}),
          },
        });
        if (!request.downloadMedia) {
          await stopRunningDownloads(tx, ids);
        }
      }
      if (request.syncEnabled !== undefined) {
        if (request.syncEnabled) {
          assertSyncable(channel);
        }
        data.syncEnabled = request.syncEnabled;
        if (request.syncEnabled) {
          data.syncNote = null;
        }
      }
      let backupLocationId = channel.backupLocationId;
      if (request.backupLocationId !== undefined) {
        const location = await tx.storageLocation.findUnique({
          where: { id: request.backupLocationId },
          select: { id: true, kind: true, target: true },
        });
        if (!location) {
          throw locationNotFound();
        }
        if (location.kind !== StorageKind.TELEGRAM) {
          throw new UnprocessableEntityException({
            code: BackupErrorCode.LOCATION_KIND_NOT_ALLOWED,
            message: 'Backups go to a Telegram chat. Add one under Settings → Storage locations.',
          });
        }
        if (location.target === channel.telegramChatId.toString()) {
          throw new UnprocessableEntityException({
            code: BackupErrorCode.BACKUP_CHAT_ARCHIVED,
            message: 'A channel cannot be backed up into itself.',
          });
        }
        backupLocationId = location.id;
        data.backupLocationId = location.id;
      }
      const backupEnabled = request.backupEnabled ?? channel.backupEnabled;
      if (request.backupEnabled !== undefined) {
        if (request.backupEnabled) {
          assertBackupable(channel, backupLocationId);
          data.backupNote = null;
        }
        data.backupEnabled = request.backupEnabled;
        if (!request.backupEnabled) {
          await stopRunningBackups(tx, await withOldGroups(tx, id));
        }
      }
      const backupStarts =
        (request.backupEnabled === true && !channel.backupEnabled) ||
        (request.backupLocationId !== undefined && backupLocationId !== channel.backupLocationId);
      if (backupEnabled && backupStarts && backupLocationId !== null) {
        await seedMessageBackups(tx, {
          channelIds: await withOldGroups(tx, id),
          storageLocationId: backupLocationId,
        });
      }
      return tx.channel.update({ where: { id }, data, include: CHANNEL_INCLUDE });
    }, UPDATE_TRANSACTION);
    return this.withStats(updated);
  }

  /**
   * Adds a chat from the cached Telegram chat list to the archive. Idempotent: selecting the same
   * chat again (even concurrently) returns the existing channel. Everything but the id comes from
   * the cache the worker filled from Telegram, so a client cannot bypass content protection.
   */
  async createFromDialog(
    telegramChatId: string,
  ): Promise<{ channel: ChannelDto; created: boolean }> {
    const chatId = BigInt(telegramChatId);
    const dialog = await this.prisma.telegramDialog.findUnique({
      where: { telegramChatId: chatId },
    });
    if (!dialog) {
      throw new NotFoundException({
        code: TelegramErrorCode.DIALOG_NOT_FOUND,
        message: 'This chat is not in your Telegram chat list. Refresh the list and try again.',
      });
    }
    if (dialog.isProtected) {
      throw new UnprocessableEntityException({
        code: TelegramErrorCode.CHAT_PROTECTED,
        message: 'This chat has content protection enabled, so it cannot be archived.',
      });
    }
    const backupChat = await this.prisma.storageLocation.findUnique({
      where: { kind_target: { kind: StorageKind.TELEGRAM, target: telegramChatId } },
      select: { id: true },
    });
    if (backupChat) {
      throw new UnprocessableEntityException({
        code: BackupErrorCode.CHAT_IS_BACKUP_TARGET,
        message: 'This chat receives backups, so archiving it would copy the copies.',
      });
    }
    const details = {
      title: dialog.title,
      username: dialog.username,
      type: dialog.type,
      accessHash: dialog.accessHash,
      isForum: dialog.isForum,
      isProtected: dialog.isProtected,
      memberCount: dialog.memberCount,
      migratedFromChatId: dialog.migratedFromChatId,
    };
    const { count } = await this.prisma.channel.createMany({
      data: [{ telegramChatId: chatId, ...details }],
      skipDuplicates: true,
    });
    const channel =
      count === 1
        ? await this.prisma.channel.findUniqueOrThrow({
            where: { telegramChatId: chatId },
            include: CHANNEL_INCLUDE,
          })
        : await this.prisma.channel.update({
            where: { telegramChatId: chatId },
            data: details,
            include: CHANNEL_INCLUDE,
          });
    return { channel: await this.withStats(channel), created: count === 1 };
  }

  private async withStats(channel: ChannelWithStorage): Promise<ChannelDto> {
    const [dto] = await this.withStatsAll([channel]);
    return dto as ChannelDto;
  }

  /** Attaches counters to a page of channels with a single stats query. */
  private async withStatsAll(channels: readonly ChannelWithStorage[]): Promise<ChannelDto[]> {
    const stats = await loadChannelStats(
      this.prisma,
      channels.map((channel) => channel.id),
    );
    return channels.map((channel) =>
      toChannelDto(channel, stats.get(channel.id) ?? EMPTY_CHANNEL_STATS),
    );
  }
}

function channelNotFound(): NotFoundException {
  return new NotFoundException({ message: 'Channel not found', code: ApiErrorCode.NOT_FOUND });
}

function locationNotFound(): NotFoundException {
  return new NotFoundException({
    message: 'Storage location not found',
    code: ApiErrorCode.NOT_FOUND,
  });
}

/**
 * Protected chats are never backed up, an upgraded group follows its supergroup, and backups need
 * a backup chat.
 */
function assertBackupable(channel: Channel, backupLocationId: string | null): void {
  if (channel.isProtected) {
    throw new UnprocessableEntityException({
      code: TelegramErrorCode.CHAT_PROTECTED,
      message: 'This chat has content protection enabled, so it is never backed up.',
    });
  }
  if (channel.migratedToChannelId !== null) {
    throw new UnprocessableEntityException({
      code: ImportErrorCode.CHANNEL_MIGRATED,
      message:
        'This group was upgraded to a supergroup; back up the supergroup, which includes it.',
    });
  }
  if (backupLocationId === null) {
    throw new UnprocessableEntityException({
      code: BackupErrorCode.BACKUP_CHAT_MISSING,
      message: 'Choose the Telegram chat that receives the backups first.',
    });
  }
}

/** Protected chats are never archived, and an upgraded group gets no new messages. */
function assertSyncable(channel: Channel): void {
  if (channel.isProtected) {
    throw new UnprocessableEntityException({
      code: TelegramErrorCode.CHAT_PROTECTED,
      message: 'This chat has content protection enabled, so it cannot be synced.',
    });
  }
  if (channel.migratedToChannelId !== null) {
    throw new UnprocessableEntityException({
      code: ImportErrorCode.CHANNEL_MIGRATED,
      message: 'This group was upgraded to a supergroup, which gets its new messages: sync that.',
    });
  }
}

function searchFilter(q: string | undefined): Prisma.ChannelWhereInput {
  if (q === undefined) {
    return {};
  }
  return {
    OR: [
      { title: { contains: q, mode: 'insensitive' } },
      { username: { contains: q, mode: 'insensitive' } },
    ],
  };
}

function afterCursor(cursor: ChannelCursor | undefined): Prisma.ChannelWhereInput {
  if (cursor === undefined) {
    return {};
  }
  return {
    OR: [
      { createdAt: { lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ],
  };
}
