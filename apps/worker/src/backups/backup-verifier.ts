import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '@tam/database/nest';
import { BackupStatus, backupVerifyingKey } from '@tam/shared';
import { locationConfig } from '@tam/storage';
import { type BackupChatMessage, FloodWaitError } from '@tam/telegram';
import type { Redis } from 'ioredis';
import { errorMessage } from '../common/error-message.js';
import { TelegramRpcServer } from '../telegram/telegram-rpc.server.js';
import {
  TELEGRAM_API_PROVIDER,
  TELEGRAM_REDIS,
  type TelegramApiProvider,
} from '../telegram/telegram.tokens.js';
import { BACKUP_TUNING, type BackupTuning } from './backup-settings.js';

/** A wait Telegram asks for is sat out up to this long; a longer one ends the Verify. */
const MAX_VERIFY_WAIT_MS = 5 * 60_000;

interface CheckedRow {
  id: string;
  backupMessageId: number;
  backupThreadId: number | null;
  extraMessageIds: number[];
  sentName: string | null;
  sentSize: bigint | null;
  message: {
    text: string | null;
    caption: string | null;
    media: { telegramFileUniqueId: string; type: string }[];
  };
}

/**
 * Checks the copies of a channel in its backup chat (the api's Verify): each copy is still there,
 * is a new message rather than a forward, carries the archived text and a file of the size and
 * name that was sent, in the right topic, and is not the archived file itself; the first bytes
 * of a few files are read back. Runs in the background; the outcome lands on each row and
 * arrives live.
 */
@Injectable()
export class BackupVerifier implements OnModuleInit {
  private readonly logger = new Logger(BackupVerifier.name);
  private readonly running = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly rpc: TelegramRpcServer,
    @Inject(TELEGRAM_API_PROVIDER) private readonly telegram: TelegramApiProvider,
    @Inject(TELEGRAM_REDIS) private readonly redis: Redis,
    @Inject(BACKUP_TUNING) private readonly tuning: BackupTuning,
  ) {}

  onModuleInit(): void {
    this.rpc.register('backup.verify', (call) => this.start(call.channelId));
  }

  /** Starts a Verify of the channel unless one runs; resolves once it is flagged as running. */
  async start(channelId: string): Promise<void> {
    if (this.running.has(channelId)) {
      return;
    }
    const flag = backupVerifyingKey(channelId);
    await this.redis.set(flag, new Date().toISOString(), 'PX', this.tuning.verifyFlagTtlMs);
    const run = this.verify(channelId)
      .catch((error: unknown) => {
        this.logger.warn(
          `Verifying the backup of channel ${channelId} failed: ${errorMessage(error)}`,
        );
      })
      .finally(async () => {
        this.running.delete(channelId);
        await this.redis.del(flag).catch(() => undefined);
      });
    this.running.set(channelId, run);
  }

  /** Resolves when no Verify runs (tests, shutdown). */
  async idle(): Promise<void> {
    await Promise.all(this.running.values());
  }

  async verify(channelId: string): Promise<void> {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      include: { backupLocation: true },
    });
    const location = channel?.backupLocation;
    if (!channel || !location) {
      return;
    }
    const config = locationConfig(location);
    if (config.kind !== 'TELEGRAM') {
      return;
    }
    const oldGroups = await this.prisma.channel.findMany({
      where: { migratedToChannelId: channelId },
      select: { id: true },
    });
    const channelIds = [channelId, ...oldGroups.map((group) => group.id)];
    let after = 0;
    let sampled = 0;
    for (;;) {
      const rows: CheckedRow[] = (await this.prisma.messageBackup.findMany({
        where: {
          channelId: { in: channelIds },
          storageLocationId: location.id,
          status: BackupStatus.COMPLETED,
          backupMessageId: { gt: after },
        },
        orderBy: { backupMessageId: 'asc' },
        take: this.tuning.verifyBatch,
        select: {
          id: true,
          backupMessageId: true,
          backupThreadId: true,
          extraMessageIds: true,
          sentName: true,
          sentSize: true,
          message: {
            select: {
              text: true,
              caption: true,
              media: { select: { telegramFileUniqueId: true, type: true } },
            },
          },
        },
      })) as CheckedRow[];
      if (rows.length === 0) {
        return;
      }
      const copies = await this.withWaits(() =>
        this.telegram.api.getBackupMessages(
          config.chatId,
          rows.map((row) => row.backupMessageId),
        ),
      );
      const byId = new Map(copies.map((copy) => [copy.id, copy]));
      const results: { id: string; problem: string | null }[] = [];
      for (const row of rows) {
        const copy = byId.get(row.backupMessageId);
        let problem = problemOf(row, copy, config.isForum);
        if (problem === null && copy?.media && sampled < this.tuning.verifySampleFiles) {
          sampled += 1;
          problem = await this.readBack(config.chatId, copy);
        }
        results.push({ id: row.id, problem });
      }
      const now = new Date();
      await this.prisma.$transaction(
        results.map((result) =>
          this.prisma.messageBackup.updateMany({
            where: { id: result.id },
            data: { verifiedAt: now, verifyError: result.problem },
          }),
        ),
      );
      after = rows.at(-1)!.backupMessageId;
    }
  }

  /** The first bytes of a copy's file download: null when they arrive. */
  private async readBack(chatId: string, copy: BackupChatMessage): Promise<string | null> {
    const wanted = Math.min(
      this.tuning.verifySampleBytes,
      copy.media?.size ?? this.tuning.verifySampleBytes,
    );
    try {
      const read = await this.withWaits(() =>
        this.telegram.api.readBackupFileHead(chatId, copy.id, wanted),
      );
      return read > 0 ? null : 'The file of the copy cannot be read.';
    } catch (error) {
      return `The file of the copy cannot be read: ${errorMessage(error)}`;
    }
  }

  /** Sits out short waits Telegram asks for; a long one ends the Verify. */
  private async withWaits<T>(operation: () => Promise<T>): Promise<T> {
    for (;;) {
      try {
        return await operation();
      } catch (error) {
        if (!(error instanceof FloodWaitError) || error.seconds * 1000 > MAX_VERIFY_WAIT_MS) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, error.seconds * 1000));
      }
    }
  }
}

/** What is wrong with a copy, or null when it is as it was sent. */
function problemOf(
  row: CheckedRow,
  copy: BackupChatMessage | undefined,
  isForum: boolean,
): string | null {
  if (!copy) {
    return 'The copy is no longer in the backup chat.';
  }
  if (copy.isForwarded) {
    return 'The copy is a forward, not a new message.';
  }
  const archived = row.message.media[0];
  if (archived && copy.media === null) {
    return 'The copy has no file.';
  }
  if (archived && copy.media) {
    if (copy.media.fileUniqueId === archived.telegramFileUniqueId) {
      return 'The copy is the archived file itself, not a new upload.';
    }
    if (
      archived.type !== 'PHOTO' &&
      row.sentSize !== null &&
      copy.media.size !== Number(row.sentSize)
    ) {
      return 'The file of the copy has another size than the one sent.';
    }
    if (
      row.sentName !== null &&
      copy.media.fileName !== null &&
      copy.media.fileName !== row.sentName
    ) {
      return 'The file of the copy has another name than the one sent.';
    }
  }
  const text = (row.message.text ?? row.message.caption ?? '').trim();
  // A caption sent apart follows in a text of its own.
  if (row.extraMessageIds.length === 0 && copy.text.trim() !== text) {
    return 'The text of the copy differs from the archived one.';
  }
  if (isForum && copy.threadId !== row.backupThreadId) {
    return 'The copy is in another topic than expected.';
  }
  return null;
}
