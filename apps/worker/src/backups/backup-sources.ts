import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@tam/database/nest';
import { DownloadStatus, type MediaType } from '@tam/shared';
import {
  type LocationDriverFactory,
  isDriverLocation,
  thumbnailExtension,
  thumbnailPath,
} from '@tam/storage';
import type { BackupFileAttributes, BackupFileInput } from '@tam/telegram';
import { errorMessage } from '../common/error-message.js';
import { LOCATION_DRIVERS, MEDIA_SETTINGS, type MediaSettings } from '../media/media-settings.js';
import { TELEGRAM_API_PROVIDER, type TelegramApiProvider } from '../telegram/telegram.tokens.js';
import type { BackupMediaSource } from './backup-store.js';

/** Telegram takes a thumbnail of at most this size (and 320 px, which the cache keeps). */
const MAX_THUMBNAIL_BYTES = 200 * 1024;

/** Files sent with a preview picture of their own. */
const THUMBNAIL_TYPES = new Set<MediaType>([
  'VIDEO',
  'ANIMATION',
  'VIDEO_NOTE',
  'AUDIO',
  'DOCUMENT',
]);

const KINDS: Readonly<Record<MediaType, BackupFileAttributes['kind']>> = {
  PHOTO: 'photo',
  VIDEO: 'video',
  ANIMATION: 'animation',
  VIDEO_NOTE: 'video_note',
  AUDIO: 'audio',
  VOICE: 'voice',
  DOCUMENT: 'document',
  STICKER: 'document',
};

/**
 * A failure while reading the file from its source (Telegram's copy of the archived message, or
 * a downloaded copy), told apart from failures of the backup chat.
 */
export class BackupSourceError extends Error {
  constructor(readonly original: unknown) {
    super(errorMessage(original));
    this.name = 'BackupSourceError';
  }
}

/** A file opened for uploading: its bytes, counted and hashed as they pass. */
export interface OpenedSource {
  input: BackupFileInput;
  /** Where the bytes come from. */
  from: 'telegram' | 'copy';
  /** Bytes passed so far. */
  bytes(): number;
  /** The SHA-256 of every byte that passed (read once the stream ended). */
  sha256(): string;
}

/** How the archive describes a file, for a downloaded copy sent again. */
export function archivedAttributes(media: BackupMediaSource): BackupFileAttributes {
  const kind = KINDS[media.type];
  return {
    kind,
    fileName: media.filename,
    mimeType: media.mimeType,
    width: media.width,
    height: media.height,
    duration: media.duration === null ? null : Math.round(media.duration),
    supportsStreaming: kind === 'video' && media.mimeType === 'video/mp4',
    performer: null,
    title: null,
  };
}

/**
 * Where the bytes of a file to back up come from: the downloaded copy (Local folder or Google
 * Drive) when there is one, which spares Telegram a download and outlives a deleted source
 * message; otherwise Telegram's copy of the archived message, streamed as the upload takes it.
 * Nothing is written to disk either way.
 */
@Injectable()
export class BackupSources {
  private readonly logger = new Logger(BackupSources.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(TELEGRAM_API_PROVIDER) private readonly telegram: TelegramApiProvider,
    @Inject(LOCATION_DRIVERS) private readonly drivers: LocationDriverFactory,
    @Inject(MEDIA_SETTINGS) private readonly media: MediaSettings,
  ) {}

  /**
   * Opens the file. BackupSourceError: Telegram's copy cannot be read (deleted message,
   * protection, a wait) and there is no downloaded copy.
   */
  async open(source: BackupMediaSource, signal: AbortSignal): Promise<OpenedSource> {
    const thumbnail = await this.thumbnail(source);
    const copy = await this.openCopy(source, thumbnail);
    if (copy) {
      return copy;
    }
    try {
      const file = await this.telegram.api.openBackupSource(source.telegramFileId, { signal });
      return counted(file.stream, file.size, file.attributes, thumbnail, 'telegram');
    } catch (error) {
      throw new BackupSourceError(error);
    }
  }

  /** Whether a downloaded copy exists (a message gone from Telegram can still be backed up). */
  hasCopy(source: BackupMediaSource): boolean {
    return (
      source.downloadStatus === DownloadStatus.DOWNLOADED &&
      source.storageLocationId !== null &&
      source.storageKey !== null
    );
  }

  private async openCopy(
    source: BackupMediaSource,
    thumbnail: Uint8Array | null,
  ): Promise<OpenedSource | null> {
    if (!this.hasCopy(source)) {
      return null;
    }
    try {
      const location = await this.prisma.storageLocation.findUnique({
        where: { id: source.storageLocationId! },
      });
      if (!location || !isDriverLocation(location)) {
        return null;
      }
      const driver = this.drivers.forLocation(location);
      const info = await driver.stat(source.storageKey!);
      if (!info || (source.size !== null && info.size !== source.size)) {
        return null;
      }
      const stream = Readable.toWeb(
        await driver.openReadStream(source.storageKey!, undefined, info),
      ) as ReadableStream<Uint8Array>;
      return counted(stream, info.size, archivedAttributes(source), thumbnail, 'copy');
    } catch (error) {
      // An unreachable copy (Drive offline, folder gone): Telegram's copy is read instead.
      this.logger.warn(
        `The downloaded copy of ${source.id} cannot be read: ${errorMessage(error)}`,
      );
      return null;
    }
  }

  /** The cached preview, when Telegram takes it as a thumbnail (JPEG, 200 KB at most). */
  private async thumbnail(source: BackupMediaSource): Promise<Uint8Array | null> {
    const folder = this.media.thumbnailDir;
    if (folder === null || source.thumbnailKey === null || !THUMBNAIL_TYPES.has(source.type)) {
      return null;
    }
    try {
      const bytes = new Uint8Array(await readFile(thumbnailPath(folder, source.thumbnailKey)));
      return bytes.length <= MAX_THUMBNAIL_BYTES && thumbnailExtension(bytes) === 'jpg'
        ? bytes
        : null;
    } catch {
      return null;
    }
  }
}

/** Passes the bytes on as they are read, counting and hashing them; tags reading failures. */
function counted(
  stream: ReadableStream<Uint8Array>,
  size: number,
  attributes: BackupFileAttributes,
  thumbnail: Uint8Array | null,
  from: OpenedSource['from'],
): OpenedSource {
  const hash = createHash('sha256');
  let bytes = 0;
  let digest: string | null = null;
  const reader = stream.getReader();
  const passing = new ReadableStream<Uint8Array>({
    async pull(controller) {
      let result: Awaited<ReturnType<typeof reader.read>>;
      try {
        result = await reader.read();
      } catch (error) {
        throw new BackupSourceError(error);
      }
      if (result.done) {
        digest = hash.digest('hex');
        controller.close();
        return;
      }
      hash.update(result.value);
      bytes += result.value.length;
      controller.enqueue(result.value);
    },
    async cancel(reason) {
      await reader.cancel(reason);
    },
  });
  return {
    input: { stream: passing, size, attributes, thumbnail },
    from,
    bytes: () => bytes,
    sha256: () => digest ?? hash.copy().digest('hex'),
  };
}
