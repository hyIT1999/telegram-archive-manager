import { Injectable, NotFoundException } from '@nestjs/common';
import type { Channel, Prisma } from '@tam/database';
import { PrismaService } from '@tam/database/nest';
import { ApiErrorCode, type ChannelDto, type ChannelListQuery, type Page } from '@tam/shared';
import { z } from 'zod';
import { decodeCursor, encodeCursor } from '../common/pagination/cursor.js';
import { EMPTY_CHANNEL_STATS, toChannelDto } from './channel.mapper.js';
import { loadChannelStats } from './channel-stats.js';

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
    });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page.at(-1);
    return {
      items: await this.withStats(page),
      nextCursor: hasMore && last ? encodeCursor([last.createdAt.toISOString(), last.id]) : null,
    };
  }

  async get(id: string): Promise<ChannelDto> {
    const channel = await this.prisma.channel.findUnique({ where: { id } });
    if (!channel) {
      throw new NotFoundException({ message: 'Channel not found', code: ApiErrorCode.NOT_FOUND });
    }
    const stats = await loadChannelStats(this.prisma, [channel.id]);
    return toChannelDto(channel, stats.get(channel.id) ?? EMPTY_CHANNEL_STATS);
  }

  /** Attaches counters to a page of channels with a single stats query. */
  private async withStats(channels: readonly Channel[]): Promise<ChannelDto[]> {
    const stats = await loadChannelStats(
      this.prisma,
      channels.map((channel) => channel.id),
    );
    return channels.map((channel) =>
      toChannelDto(channel, stats.get(channel.id) ?? EMPTY_CHANNEL_STATS),
    );
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
