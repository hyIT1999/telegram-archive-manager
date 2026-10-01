import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type StorageLocation, refreshMediaCountersOf } from '@tam/database';
import { isDriverLocation } from '@tam/storage';
import { PrismaService } from '@tam/database/nest';
import {
  ApiErrorCode,
  type ChannelDownloadsDto,
  type DownloadCountsDto,
  DownloadJobStatus,
  type DownloadLocationDto,
  type RetryDownloadsDto,
} from '@tam/shared';
import type { Env } from '../config/env.js';
import { type ActiveDownloadRow, toActiveDownloadDto } from '../downloads/active-downloads.js';
import { loadDownloadSettings } from '../downloads/download-rules.js';
import { StorageDrivers } from '../storage/storage-drivers.js';

/** Free space of a location is asked for at most this often (Drive asks Google). */
const SPACE_CACHE_MS = 30_000;
/** Running downloads listed at most. */
const ACTIVE_LIMIT = 10;

interface StatusRow {
  status: DownloadJobStatus;
  files: number;
  bytes: string;
}

const COUNT_KEYS: Readonly<Record<DownloadJobStatus, keyof DownloadCountsDto>> = {
  PENDING: 'pending',
  PAUSED: 'pending',
  ACTIVE: 'active',
  COMPLETED: 'downloaded',
  FAILED: 'failed',
  SKIPPED: 'skipped',
  CANCELLED: 'cancelled',
};

function channelNotFound(): NotFoundException {
  return new NotFoundException({ message: 'Channel not found', code: ApiErrorCode.NOT_FOUND });
}

/** Where a channel's downloads stand; the channel's old basic group, if any, counts with it. */
@Injectable()
export class ChannelDownloadsService {
  private readonly space = new Map<string, { at: number; freeBytes: number | null }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly drivers: StorageDrivers,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async summary(channelId: string): Promise<ChannelDownloadsDto> {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      include: { storageLocation: true },
    });
    if (!channel) {
      throw channelNotFound();
    }
    const ids = await this.withOldGroup(channelId);
    const [statuses, active, settings, location] = await Promise.all([
      // From download_jobs_channel_id_status_size_idx alone, however many files the channel has.
      this.prisma.$queryRaw<StatusRow[]>`
        SELECT d.status, count(*)::int AS files, coalesce(sum(d.size), 0)::text AS bytes
        FROM download_jobs d
        WHERE d.channel_id = ANY(${ids}::uuid[])
        GROUP BY d.status`,
      this.prisma.$queryRaw<ActiveDownloadRow[]>`
        SELECT m.id, m.filename, m.mime_type, m.type, m.size::text AS size,
               m.downloaded_bytes::text AS downloaded_bytes, d.progress, d.stage,
               d.requested_at IS NOT NULL AS requested, d.updated_at, g.telegram_message_id
        FROM download_jobs d
        JOIN media m ON m.id = d.media_id
        JOIN messages g ON g.id = m.message_id
        WHERE d.channel_id = ANY(${ids}::uuid[]) AND d.status = 'ACTIVE'
        ORDER BY d.updated_at DESC
        LIMIT ${ACTIVE_LIMIT}`,
      loadDownloadSettings(this.prisma),
      channel.storageLocation ??
        this.prisma.storageLocation.findFirst({ where: { isDefault: true } }),
    ]);

    const files: DownloadCountsDto = {
      pending: 0,
      active: 0,
      downloaded: 0,
      failed: 0,
      skipped: 0,
      cancelled: 0,
    };
    const bytes = { total: 0, downloaded: 0, remaining: 0 };
    for (const row of statuses) {
      const key = COUNT_KEYS[row.status];
      const size = Number(row.bytes);
      files[key] += row.files;
      bytes.total += size;
      if (key === 'downloaded') {
        bytes.downloaded += size;
      } else if (key === 'pending' || key === 'active') {
        bytes.remaining += size;
      }
    }
    const where = location ? await this.locationDto(location) : null;
    const minFree = this.config.get('MIN_FREE_DISK_MB', { infer: true }) * 1024 * 1024;
    return {
      channelId,
      downloadMedia: channel.downloadMedia,
      downloadNote: channel.downloadNote,
      paused: settings.paused,
      files,
      bytes,
      active: active.map(toActiveDownloadDto),
      location: where,
      fits:
        where === null || where.freeBytes === null
          ? null
          : bytes.remaining + (where.kind === 'LOCAL' ? minFree : 0) <= where.freeBytes,
    };
  }

  /** Every FAILED file of the channel goes back in line, as if each was asked for. */
  async retryFailed(channelId: string): Promise<RetryDownloadsDto> {
    const exists = await this.prisma.channel.count({ where: { id: channelId } });
    if (exists === 0) {
      throw channelNotFound();
    }
    const ids = await this.withOldGroup(channelId);
    const queued = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ media_id: string; import_job_id: string | null }[]>`
        UPDATE download_jobs d
        SET status = 'PENDING', requested_at = now(), attempts = 0, error = NULL, not_before = NULL,
            stage = NULL, updated_at = now()
        WHERE d.status = 'FAILED' AND d.channel_id = ANY(${ids}::uuid[])
        RETURNING d.media_id, d.import_job_id`;
      if (rows.length > 0) {
        await tx.$executeRaw`
          UPDATE media SET download_status = 'PENDING', error = NULL, updated_at = now()
          WHERE id = ANY(${rows.map((row) => row.media_id)}::uuid[])`;
        await refreshMediaCountersOf(
          tx,
          rows.map((row) => row.import_job_id),
        );
      }
      return rows.length;
    });
    return { queued };
  }

  /** The channel and the old basic group it was upgraded from (its own channel row). */
  private async withOldGroup(channelId: string): Promise<string[]> {
    const oldGroups = await this.prisma.channel.findMany({
      where: { migratedToChannelId: channelId },
      select: { id: true },
    });
    return [channelId, ...oldGroups.map((row) => row.id)];
  }

  private async locationDto(location: StorageLocation): Promise<DownloadLocationDto> {
    const waiting =
      location.unavailableUntil !== null && location.unavailableUntil.getTime() > Date.now();
    return {
      id: location.id,
      kind: location.kind,
      name: location.name,
      displayPath: location.displayPath,
      freeBytes: await this.freeBytes(location),
      unavailableUntil: waiting ? location.unavailableUntil!.toISOString() : null,
      lastError: location.lastError,
    };
  }

  /** Free bytes of the location, asked at most every 30 s; null when it cannot tell. */
  private async freeBytes(location: StorageLocation): Promise<number | null> {
    const cached = this.space.get(location.id);
    if (cached && Date.now() - cached.at < SPACE_CACHE_MS) {
      return cached.freeBytes;
    }
    let freeBytes: number | null = null;
    try {
      if (isDriverLocation(location)) {
        freeBytes = (await this.drivers.forLocation(location).space()).freeBytes;
      }
    } catch {
      // Unreachable right now (Drive offline, folder gone): the location check says why.
    }
    this.space.set(location.id, { at: Date.now(), freeBytes });
    return freeBytes;
  }
}
