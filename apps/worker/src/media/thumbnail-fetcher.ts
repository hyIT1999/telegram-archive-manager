import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { PrismaService } from '@tam/database/nest';
import { thumbnailExtension, thumbnailKey, thumbnailPath } from '@tam/storage';
import {
  AuthRequiredError,
  ChatUnavailableError,
  type FileIdParts,
  FloodWaitError,
  LoginStepError,
  decodeFileId,
} from '@tam/telegram';
import { errorMessage } from '../common/error-message.js';
import { TelegramAuthService } from '../telegram/telegram-auth.service.js';
import { TelegramCooldown } from '../telegram/telegram-cooldown.js';
import {
  TELEGRAM_API_PROVIDER,
  type TelegramApiProvider,
  TelegramUnavailableError,
} from '../telegram/telegram.tokens.js';
import { DownloadPolicy } from './download-policy.js';
import { MEDIA_SETTINGS, type MediaSettings } from './media-settings.js';
import { telegramReady } from './telegram-ready.js';

/** Files looked at per batch (one getMessages call of Telegram). */
export const THUMBNAIL_BATCH = 100;
/** Batches of one channel that may fail in a row before its files go without a preview. */
const MAX_BATCH_FAILURES = 3;

interface PendingThumbnail {
  id: string;
  telegram_file_id: string;
  telegram_file_unique_id: string;
  is_protected: boolean;
}

interface CheckedThumbnail {
  id: string;
  key: string | null;
}

/**
 * Keeps Telegram's small previews of archived files in the local thumbnail cache, whether or not
 * the files themselves are downloaded, so the archive can be browsed before (or without)
 * downloading hundreds of gigabytes. A batch of up to 100 files of one channel every few seconds;
 * paused together with downloads, and whenever Telegram is not ready or asked to wait.
 */
@Injectable()
export class ThumbnailFetcher implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ThumbnailFetcher.name);
  private readonly failures = new Map<string, number>();
  private readonly shutdown = new AbortController();
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<unknown> | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: DownloadPolicy,
    private readonly auth: TelegramAuthService,
    private readonly cooldown: TelegramCooldown,
    @Inject(TELEGRAM_API_PROVIDER) private readonly telegram: TelegramApiProvider,
    @Inject(MEDIA_SETTINGS) private readonly settings: MediaSettings,
  ) {}

  onApplicationBootstrap(): void {
    if (this.settings.thumbnailDir === null) {
      this.logger.warn(
        'Neither THUMBNAIL_DIR nor STORAGE_LOCAL_ROOT is set: no thumbnails are kept',
      );
      return;
    }
    this.tick();
    this.timer = setInterval(() => this.tick(), this.settings.thumbnailIntervalMs);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.timer);
    this.shutdown.abort();
    await this.idle();
  }

  /** Resolves when no batch is running (shutdown, tests). */
  async idle(): Promise<void> {
    await this.running;
  }

  /** One batch; returns how many files it settled (with or without a preview). */
  async fetchBatch(): Promise<number> {
    const folder = this.settings.thumbnailDir;
    if (folder === null) {
      return 0;
    }
    const downloads = await this.policy.current();
    if (downloads.paused || !(await telegramReady(this.telegram, this.auth, this.cooldown))) {
      return 0;
    }
    const [next] = await this.prisma.$queryRaw<{ channel_id: string }[]>`
      SELECT g.channel_id FROM media m JOIN messages g ON g.id = m.message_id
      WHERE m.thumbnail_checked_at IS NULL
      ORDER BY m.id LIMIT 1`;
    if (!next) {
      return 0;
    }
    const channelId = next.channel_id;
    const rows = await this.prisma.$queryRaw<PendingThumbnail[]>`
      SELECT m.id, m.telegram_file_id, m.telegram_file_unique_id, c.is_protected
      FROM media m
      JOIN messages g ON g.id = m.message_id
      JOIN channels c ON c.id = g.channel_id
      WHERE g.channel_id = ${channelId}::uuid AND m.thumbnail_checked_at IS NULL
      ORDER BY m.id
      LIMIT ${THUMBNAIL_BATCH}`;
    if (rows[0]?.is_protected) {
      return this.markChecked(rows.map((row) => ({ id: row.id, key: null })));
    }

    const checked: CheckedThumbnail[] = [];
    // Files are read through the chat they came from (an old basic group has a chat of its own).
    const byChat = new Map<string, { row: PendingThumbnail; parts: FileIdParts }[]>();
    for (const row of rows) {
      let parts: FileIdParts;
      try {
        parts = decodeFileId(row.telegram_file_id);
      } catch {
        checked.push({ id: row.id, key: null });
        continue;
      }
      byChat.set(parts.chatId, [...(byChat.get(parts.chatId) ?? []), { row, parts }]);
    }
    try {
      for (const [chatId, files] of byChat) {
        const previews = await this.telegram.api.getThumbnails(
          chatId,
          files.map(({ row, parts }) => ({
            messageId: parts.messageId,
            fileUniqueId: row.telegram_file_unique_id,
          })),
          { signal: this.shutdown.signal, timeoutMs: this.settings.thumbnailTimeoutMs },
        );
        for (const { row } of files) {
          const bytes = previews.get(row.telegram_file_unique_id) ?? null;
          checked.push({ id: row.id, key: bytes ? await this.save(folder, row.id, bytes) : null });
        }
      }
      this.failures.delete(channelId);
    } catch (error) {
      if (this.shutdown.signal.aborted) {
        return 0;
      }
      if (error instanceof FloodWaitError) {
        this.cooldown.note(error.seconds);
        return 0;
      }
      if (
        error instanceof TelegramUnavailableError ||
        error instanceof AuthRequiredError ||
        error instanceof LoginStepError
      ) {
        return 0;
      }
      const failures = (this.failures.get(channelId) ?? 0) + 1;
      this.failures.set(channelId, failures);
      this.logger.warn(
        `Thumbnails of channel ${channelId} failed (${failures}×): ${errorMessage(error)}`,
      );
      if (!(error instanceof ChatUnavailableError) && failures < MAX_BATCH_FAILURES) {
        return 0;
      }
      // Give up on this batch: its files show no preview rather than holding up the others.
      this.failures.delete(channelId);
      const settled = new Set(checked.map((item) => item.id));
      checked.push(
        ...rows.filter((row) => !settled.has(row.id)).map((row) => ({ id: row.id, key: null })),
      );
    }
    return this.markChecked(checked);
  }

  /** Writes a preview atomically; null when Telegram sent something that is not an image. */
  private async save(folder: string, mediaId: string, bytes: Uint8Array): Promise<string | null> {
    const extension = thumbnailExtension(bytes);
    if (extension === null) {
      return null;
    }
    const key = thumbnailKey(mediaId, extension);
    const file = thumbnailPath(folder, key);
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, bytes);
    await rename(temporary, file);
    return key;
  }

  private async markChecked(items: readonly CheckedThumbnail[]): Promise<number> {
    if (items.length === 0) {
      return 0;
    }
    const now = new Date();
    await this.prisma.$transaction(
      items.map((item) =>
        this.prisma.media.updateMany({
          where: { id: item.id },
          data: { thumbnailKey: item.key, thumbnailCheckedAt: now },
        }),
      ),
    );
    return items.length;
  }

  private tick(): void {
    if (this.running || this.shutdown.signal.aborted) {
      return;
    }
    this.running = this.fetchBatch()
      .catch((error: unknown) =>
        this.logger.warn(`Fetching thumbnails failed: ${errorMessage(error)}`),
      )
      .finally(() => {
        this.running = undefined;
      });
  }
}
