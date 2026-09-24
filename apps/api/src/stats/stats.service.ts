import { Injectable } from '@nestjs/common';
import { PrismaService } from '@tam/database/nest';
import type { StatsDto } from '@tam/shared';
import { toStatsDto } from './stats.mapper.js';

@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Four aggregate queries, whatever the archive size. */
  async totals(): Promise<StatsDto> {
    const [channels, messages, mediaByType, mediaByStatus] = await Promise.all([
      // Legacy basic groups (migrated to a supergroup) are part of their supergroup, not a channel.
      this.prisma.channel.count({ where: { migratedToChannelId: null } }),
      this.prisma.message.count(),
      this.prisma.media.groupBy({ by: ['type'], _count: { _all: true } }),
      this.prisma.media.groupBy({
        by: ['downloadStatus'],
        _count: { _all: true },
        _sum: { size: true },
      }),
    ]);
    return toStatsDto({
      channels,
      messages,
      mediaByType: mediaByType.map((row) => ({ type: row.type, count: row._count._all })),
      mediaByStatus: mediaByStatus.map((row) => ({
        status: row.downloadStatus,
        count: row._count._all,
        bytes: row._sum.size ?? 0n,
      })),
    });
  }
}
