import path from 'node:path';
import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { refreshMediaCounters } from '@tam/database';
import { PrismaService } from '@tam/database/nest';
import {
  ApiErrorCode,
  DownloadErrorCode,
  DownloadJobStatus,
  DownloadStatus,
  type MediaDto,
  TelegramErrorCode,
} from '@tam/shared';
import {
  type StorageDriver,
  THUMBNAIL_FOLDER,
  thumbnailContentType,
  thumbnailPath,
} from '@tam/storage';
import type { Env } from '../config/env.js';
import { StorageDrivers } from '../storage/storage-drivers.js';
import { withStorageErrors } from '../storage/storage-errors.js';
import { MEDIA_INCLUDE, type MediaWithDetails, toMediaDto } from './media.mapper.js';

/** A stored file, ready to be streamed. */
export interface StoredContent {
  driver: StorageDriver;
  key: string;
  mimeType: string;
  /** The name a download gets. */
  fileName: string;
  /** SHA-256 of the stored bytes (lowercase hex), recorded when the download completed. */
  checksum: string | null;
}

/** Download states a request can (re)start: everything but running and done. */
const RESTARTABLE: DownloadJobStatus[] = [
  DownloadJobStatus.PENDING,
  DownloadJobStatus.PAUSED,
  DownloadJobStatus.FAILED,
  DownloadJobStatus.SKIPPED,
  DownloadJobStatus.CANCELLED,
];

/** Download states a cancel stops. */
const CANCELLABLE: DownloadJobStatus[] = [
  DownloadJobStatus.PENDING,
  DownloadJobStatus.ACTIVE,
  DownloadJobStatus.PAUSED,
];

function mediaNotFound(): NotFoundException {
  return new NotFoundException({ code: ApiErrorCode.NOT_FOUND, message: 'Media file not found' });
}

@Injectable()
export class MediaService {
  private readonly thumbnailDir: string | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly drivers: StorageDrivers,
    config: ConfigService<Env, true>,
  ) {
    const root = config.get('STORAGE_LOCAL_ROOT', { infer: true });
    this.thumbnailDir =
      config.get('THUMBNAIL_DIR', { infer: true }) ??
      (root === undefined ? null : path.join(root, THUMBNAIL_FOLDER));
  }

  async get(id: string): Promise<MediaDto> {
    return toMediaDto(await this.find(id));
  }

  /**
   * Downloads the file as soon as possible, whatever the channel's switch and the automatic
   * download settings say (tries start from zero again). `queued` is false when there was
   * nothing to do: the file is downloaded or already downloading.
   */
  async requestDownload(id: string): Promise<{ media: MediaDto; queued: boolean }> {
    const queued = await this.prisma.$transaction(async (tx) => {
      const media = await tx.media.findUnique({
        where: { id },
        include: {
          downloadJob: true,
          message: { select: { channel: { select: { isProtected: true } } } },
        },
      });
      if (!media) {
        throw mediaNotFound();
      }
      if (media.message.channel.isProtected) {
        throw new UnprocessableEntityException({
          code: TelegramErrorCode.CHAT_PROTECTED,
          message: 'Content protection is on for this chat, so its files are not downloaded.',
        });
      }
      if (media.downloadStatus === DownloadStatus.DOWNLOADED) {
        return false;
      }
      const now = new Date();
      const job = media.downloadJob;
      if (job === null) {
        await tx.downloadJob.create({ data: { mediaId: id, requestedAt: now } });
      } else if (job.status === DownloadJobStatus.ACTIVE) {
        // Running: it now goes on even if the channel's automatic downloads are switched off.
        await tx.downloadJob.updateMany({
          where: { id: job.id, status: DownloadJobStatus.ACTIVE, requestedAt: null },
          data: { requestedAt: now },
        });
        return false;
      } else {
        const { count } = await tx.downloadJob.updateMany({
          where: { id: job.id, status: { in: RESTARTABLE } },
          data: {
            status: DownloadJobStatus.PENDING,
            requestedAt: now,
            attempts: 0,
            stage: null,
            reason: null,
            error: null,
            notBefore: null,
          },
        });
        if (count === 0) {
          return false;
        }
      }
      await tx.media.update({
        where: { id },
        data: { downloadStatus: DownloadStatus.PENDING, error: null },
      });
      if (job?.importJobId) {
        await refreshMediaCounters(tx, job.importJobId);
      }
      return true;
    });
    return { media: await this.get(id), queued };
  }

  /** Stops waiting for (or downloading) the file; a running download stops and drops its part. */
  async cancel(id: string): Promise<MediaDto> {
    await this.prisma.$transaction(async (tx) => {
      const media = await tx.media.findUnique({ where: { id }, include: { downloadJob: true } });
      if (!media) {
        throw mediaNotFound();
      }
      const job = media.downloadJob;
      const { count } = job
        ? await tx.downloadJob.updateMany({
            where: { id: job.id, status: { in: CANCELLABLE } },
            data: {
              status: DownloadJobStatus.CANCELLED,
              stage: null,
              notBefore: null,
              requestedAt: null,
            },
          })
        : { count: 0 };
      if (count === 0) {
        throw new ConflictException({
          code: DownloadErrorCode.INVALID_DOWNLOAD_STATE,
          message:
            media.downloadStatus === DownloadStatus.DOWNLOADED
              ? 'The file is already downloaded.'
              : 'The file is neither waiting nor downloading.',
        });
      }
      await tx.media.update({
        where: { id },
        data: {
          downloadStatus: DownloadStatus.CANCELLED,
          downloadProgress: 0,
          downloadedBytes: 0n,
          error: null,
        },
      });
      if (job?.importJobId) {
        await refreshMediaCounters(tx, job.importJobId);
      }
    });
    return this.get(id);
  }

  /** The stored file of a downloaded media file (409 while it is not downloaded). */
  async openContent(id: string): Promise<StoredContent> {
    const media = await this.find(id);
    const location = media.storageLocation;
    if (
      media.downloadStatus !== DownloadStatus.DOWNLOADED ||
      media.storageKey === null ||
      location === null
    ) {
      throw new ConflictException({
        code: DownloadErrorCode.MEDIA_NOT_DOWNLOADED,
        message: 'The file is not downloaded yet.',
      });
    }
    const driver = await withStorageErrors(async () => this.drivers.forLocation(location));
    const key = media.storageKey;
    return {
      driver,
      key,
      mimeType: media.mimeType ?? 'application/octet-stream',
      fileName: media.filename ?? key.slice(key.lastIndexOf('/') + 1),
      checksum: media.checksum,
    };
  }

  /** The preview in the thumbnail cache (404 when the file has none). */
  async thumbnailFile(id: string): Promise<{ path: string; contentType: string }> {
    const media = await this.prisma.media.findUnique({
      where: { id },
      select: { thumbnailKey: true },
    });
    if (!media) {
      throw mediaNotFound();
    }
    if (media.thumbnailKey === null || this.thumbnailDir === null) {
      throw new NotFoundException({
        code: ApiErrorCode.NOT_FOUND,
        message: 'This file has no preview.',
      });
    }
    return {
      path: thumbnailPath(this.thumbnailDir, media.thumbnailKey),
      contentType: thumbnailContentType(media.thumbnailKey),
    };
  }

  private async find(id: string): Promise<MediaWithDetails> {
    const media = await this.prisma.media.findUnique({ where: { id }, include: MEDIA_INCLUDE });
    if (!media) {
      throw mediaNotFound();
    }
    return media;
  }
}
