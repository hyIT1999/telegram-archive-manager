import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { type Channel, Prisma, type StorageLocation, seedMessageBackups } from '@tam/database';
import { PrismaService } from '@tam/database/nest';
import {
  type ActiveBackupDto,
  ApiErrorCode,
  type BackupChatStateDto,
  type BackupCountsDto,
  BackupErrorCode,
  type BackupProblemDto,
  type BackupStage,
  BackupStatus,
  type ChannelBackupDto,
  type MessageBackupDto,
  type MessageType,
  type RequestBackupRequest,
  type RetryBackupsDto,
  TelegramErrorCode,
  backupVerifyingKey,
} from '@tam/shared';
import { locationConfig } from '@tam/storage';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants.js';
import { TelegramRpcClient } from '../telegram/telegram-rpc.client.js';
import { loadBackupSettings, withOldGroups } from './backup-rules.js';
import { loadMessageBackups, toMessageBackupDto } from './message-backups.js';

/** Running backups listed at most. */
const ACTIVE_LIMIT = 10;
/** Latest failures listed. */
const FAILURE_LIMIT = 10;
/** Problems Verify found, listed at most. */
const PROBLEM_SAMPLES = 5;

/** Messages that cannot be recreated in a backup chat. */
const NOT_BACKED_UP = new Set<MessageType>(['SERVICE', 'POLL', 'OTHER']);

interface StatusRow {
  status: BackupStatus;
  messages: number;
  bytes: string;
}

interface MessageRow {
  message_id: string;
  telegram_message_id: number;
  type: MessageType;
  filename: string | null;
}

interface ActiveRow extends MessageRow {
  size: string | null;
  uploaded_bytes: string;
  stage: BackupStage | null;
  requested: boolean;
  updated_at: Date;
}

interface ProblemRow extends MessageRow {
  problem: string | null;
  attempts: number;
  at: Date | null;
}

interface VerifyRow {
  verified_at: Date | null;
  ok: number;
  problems: number;
}

const COUNT_KEYS: Readonly<Record<BackupStatus, keyof BackupCountsDto>> = {
  PENDING: 'pending',
  ACTIVE: 'active',
  COMPLETED: 'completed',
  FAILED: 'failed',
  SKIPPED: 'skipped',
};

function nameOf(row: MessageRow): string {
  return row.filename ?? `Message ${row.telegram_message_id}`;
}

function toProblem(row: ProblemRow): BackupProblemDto {
  return {
    messageId: row.message_id,
    telegramMessageId: row.telegram_message_id,
    name: nameOf(row),
    error: row.problem,
    attempts: row.attempts,
    at: row.at?.toISOString() ?? null,
  };
}

function channelNotFound(): NotFoundException {
  return new NotFoundException({ message: 'Channel not found', code: ApiErrorCode.NOT_FOUND });
}

/**
 * Telegram backups of a channel (its old basic group counts with it): where they stand, retrying
 * failures, verifying the copies, and backing up single messages ("Back up now").
 */
@Injectable()
export class ChannelBackupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rpc: TelegramRpcClient,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async summary(channelId: string): Promise<ChannelBackupDto> {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      include: { backupLocation: true },
    });
    if (!channel) {
      throw channelNotFound();
    }
    const location = channel.backupLocation;
    const [settings, verifying] = await Promise.all([
      loadBackupSettings(this.prisma),
      this.redis.exists(backupVerifyingKey(channelId)).catch(() => 0),
    ]);
    const base = {
      channelId,
      backupEnabled: channel.backupEnabled,
      backupNote: channel.backupNote,
      paused: settings.paused,
    };
    if (!location) {
      return {
        ...base,
        chat: null,
        messages: { pending: 0, active: 0, completed: 0, failed: 0, skipped: 0 },
        bytes: { total: 0, uploaded: 0, remaining: 0 },
        active: [],
        failures: [],
        verify: { running: false, verifiedAt: null, ok: 0, problems: 0, problemSamples: [] },
      };
    }
    const ids = await withOldGroups(this.prisma, channelId);
    const [statuses, active, failures, [verify], problems] = await Promise.all([
      this.prisma.$queryRaw<StatusRow[]>`
        SELECT b.status, count(*)::int AS messages, coalesce(sum(b.size), 0)::text AS bytes
        FROM message_backups b
        WHERE b.channel_id = ANY(${ids}::uuid[]) AND b.storage_location_id = ${location.id}::uuid
        GROUP BY b.status`,
      this.prisma.$queryRaw<ActiveRow[]>`
        SELECT b.message_id, g.telegram_message_id, g.type, m.filename, b.size::text AS size,
               b.uploaded_bytes::text AS uploaded_bytes, b.stage,
               b.requested_at IS NOT NULL AS requested, b.updated_at
        FROM message_backups b
        JOIN messages g ON g.id = b.message_id
        LEFT JOIN media m ON m.message_id = g.id
        WHERE b.channel_id = ANY(${ids}::uuid[]) AND b.storage_location_id = ${location.id}::uuid
          AND b.status = 'ACTIVE'
        ORDER BY g.telegram_date, g.telegram_message_id
        LIMIT ${ACTIVE_LIMIT}`,
      this.problems(ids, location.id, 'failed'),
      this.prisma.$queryRaw<VerifyRow[]>`
        SELECT max(b.verified_at) AS verified_at,
               count(*) FILTER (WHERE b.verified_at IS NOT NULL AND b.verify_error IS NULL)::int AS ok,
               count(*) FILTER (WHERE b.verify_error IS NOT NULL)::int AS problems
        FROM message_backups b
        WHERE b.channel_id = ANY(${ids}::uuid[]) AND b.storage_location_id = ${location.id}::uuid
          AND b.status = 'COMPLETED'`,
      this.problems(ids, location.id, 'verify'),
    ]);

    const messages: BackupCountsDto = {
      pending: 0,
      active: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
    };
    const bytes = { total: 0, uploaded: 0, remaining: 0 };
    for (const row of statuses) {
      const key = COUNT_KEYS[row.status];
      const size = Number(row.bytes);
      messages[key] += row.messages;
      if (key === 'skipped') {
        continue;
      }
      bytes.total += size;
      if (key === 'completed') {
        bytes.uploaded += size;
      } else if (key === 'pending' || key === 'active') {
        bytes.remaining += size;
      }
    }
    return {
      ...base,
      chat: chatState(location),
      messages,
      bytes,
      active: active.map(toActive),
      failures,
      verify: {
        running: verifying === 1,
        verifiedAt: verify?.verified_at?.toISOString() ?? null,
        ok: verify?.ok ?? 0,
        problems: verify?.problems ?? 0,
        problemSamples: problems,
      },
    };
  }

  /** Every FAILED message of the channel goes back in line (in its place, not first). */
  async retryFailed(channelId: string): Promise<RetryBackupsDto> {
    const channel = await this.find(channelId);
    if (channel.backupLocationId === null) {
      return { queued: 0 };
    }
    const ids = await withOldGroups(this.prisma, channelId);
    const queued = await this.prisma.$executeRaw`
      UPDATE message_backups
      SET status = 'PENDING', attempts = 0, error = NULL, not_before = NULL, stage = NULL,
          updated_at = now()
      WHERE status = 'FAILED' AND channel_id = ANY(${ids}::uuid[])
        AND storage_location_id = ${channel.backupLocationId}::uuid`;
    return { queued };
  }

  /** Asks the worker to check every copy of the channel; the outcome arrives live. */
  async verify(channelId: string): Promise<ChannelBackupDto> {
    const channel = await this.find(channelId);
    if (channel.backupLocationId === null) {
      throw new UnprocessableEntityException({
        code: BackupErrorCode.BACKUP_CHAT_MISSING,
        message: 'This channel has no backup chat yet, so there is nothing to verify.',
      });
    }
    await this.rpc.call({ method: 'backup.verify', channelId });
    return this.summary(channelId);
  }

  /**
   * "Back up now" (or, with `force`, "Back up again") for one message and the rest of its album,
   * which always travels with it. Works while automatic backup is off, as long as the channel
   * has a backup chat. `queued` is false when there was nothing to do (already backed up).
   */
  async requestMessage(
    messageId: string,
    request: RequestBackupRequest,
  ): Promise<{ backup: MessageBackupDto; queued: boolean }> {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: { channel: true },
    });
    if (!message) {
      throw new NotFoundException({ message: 'Message not found', code: ApiErrorCode.NOT_FOUND });
    }
    // An old basic group backs up with the supergroup it was upgraded to.
    const owner =
      message.channel.migratedToChannelId === null
        ? message.channel
        : await this.find(message.channel.migratedToChannelId);
    if (message.channel.isProtected || owner.isProtected) {
      throw new UnprocessableEntityException({
        code: TelegramErrorCode.CHAT_PROTECTED,
        message: 'This chat has content protection enabled, so it is never backed up.',
      });
    }
    const locationId = owner.backupLocationId;
    if (locationId === null) {
      throw new UnprocessableEntityException({
        code: BackupErrorCode.BACKUP_CHAT_MISSING,
        message: 'Choose the Telegram chat that receives the backups on the channel page first.',
      });
    }
    if (NOT_BACKED_UP.has(message.type)) {
      throw new UnprocessableEntityException({
        code: BackupErrorCode.BACKUP_NOT_SUPPORTED,
        message: 'This kind of message cannot be recreated in a backup chat.',
      });
    }
    const members =
      message.mediaGroupId === null
        ? [message.id]
        : (
            await this.prisma.message.findMany({
              where: { channelId: message.channelId, mediaGroupId: message.mediaGroupId },
              select: { id: true },
            })
          ).map((row) => row.id);

    const queued = await this.prisma.$transaction(async (tx) => {
      await seedMessageBackups(tx, {
        channelIds: [message.channelId],
        storageLocationId: locationId,
        messageIds: members,
      });
      const rows = await tx.messageBackup.findMany({
        where: { messageId: { in: members }, storageLocationId: locationId },
      });
      if (request.force && rows.some((row) => row.status === BackupStatus.ACTIVE)) {
        throw new ConflictException({
          code: BackupErrorCode.BACKUP_ACTIVE,
          message: 'This message is being backed up right now. Try again when it has finished.',
        });
      }
      let changed = 0;
      for (const row of rows) {
        const data = request.force ? againData(row, request.replacePrevious) : nowData(row);
        if (data !== null) {
          await tx.messageBackup.update({ where: { id: row.id }, data });
          changed += 1;
        }
      }
      return changed > 0;
    });

    const backup = await this.prisma.messageBackup.findUniqueOrThrow({
      where: { messageId_storageLocationId: { messageId, storageLocationId: locationId } },
      include: { storageLocation: true },
    });
    return { backup: toMessageBackupDto(backup, backup.storageLocation), queued };
  }

  /** The copies of one message in backup chats, to follow a "Back up now". */
  async messageBackups(messageId: string): Promise<MessageBackupDto[]> {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { id: true },
    });
    if (!message) {
      throw new NotFoundException({ message: 'Message not found', code: ApiErrorCode.NOT_FOUND });
    }
    return loadMessageBackups(this.prisma, messageId);
  }

  private async find(channelId: string): Promise<Channel> {
    const channel = await this.prisma.channel.findUnique({ where: { id: channelId } });
    if (!channel) {
      throw channelNotFound();
    }
    return channel;
  }

  /** The latest failures, or the problems Verify found. */
  private async problems(
    ids: string[],
    locationId: string,
    kind: 'failed' | 'verify',
  ): Promise<BackupProblemDto[]> {
    const rows =
      kind === 'failed'
        ? await this.prisma.$queryRaw<ProblemRow[]>`
            SELECT b.message_id, g.telegram_message_id, g.type, m.filename, b.error AS problem,
                   b.attempts, b.last_attempt_at AS at
            FROM message_backups b
            JOIN messages g ON g.id = b.message_id
            LEFT JOIN media m ON m.message_id = g.id
            WHERE b.channel_id = ANY(${ids}::uuid[]) AND b.storage_location_id = ${locationId}::uuid
              AND b.status = 'FAILED'
            ORDER BY b.last_attempt_at DESC NULLS LAST
            LIMIT ${FAILURE_LIMIT}`
        : await this.prisma.$queryRaw<ProblemRow[]>`
            SELECT b.message_id, g.telegram_message_id, g.type, m.filename,
                   b.verify_error AS problem, b.attempts, b.verified_at AS at
            FROM message_backups b
            JOIN messages g ON g.id = b.message_id
            LEFT JOIN media m ON m.message_id = g.id
            WHERE b.channel_id = ANY(${ids}::uuid[]) AND b.storage_location_id = ${locationId}::uuid
              AND b.verify_error IS NOT NULL
            ORDER BY b.verified_at DESC NULLS LAST
            LIMIT ${PROBLEM_SAMPLES}`;
    return rows.map(toProblem);
  }
}

function toActive(row: ActiveRow): ActiveBackupDto {
  return {
    messageId: row.message_id,
    telegramMessageId: row.telegram_message_id,
    name: nameOf(row),
    type: row.type,
    size: row.size === null ? null : Number(row.size),
    uploadedBytes: Number(row.uploaded_bytes),
    stage: row.stage,
    requested: row.requested,
    updatedAt: row.updated_at.toISOString(),
  };
}

function chatState(location: StorageLocation): BackupChatStateDto {
  const config = locationConfig(location);
  const waiting =
    location.unavailableUntil !== null && location.unavailableUntil.getTime() > Date.now();
  return {
    id: location.id,
    name: location.name,
    displayPath: location.displayPath,
    telegramChatId: config.kind === 'TELEGRAM' ? config.chatId : location.target,
    isForum: config.kind === 'TELEGRAM' && config.isForum,
    unavailableUntil: waiting ? location.unavailableUntil!.toISOString() : null,
    lastError: location.lastError,
  };
}

type BackupRow = Prisma.MessageBackupGetPayload<Record<string, never>>;

/** "Back up now": waiting or failed messages go first; copies and skipped ones stay as they are. */
function nowData(row: BackupRow): Prisma.MessageBackupUpdateInput | null {
  switch (row.status) {
    case BackupStatus.PENDING:
    case BackupStatus.ACTIVE:
      return row.requestedAt === null ? { requestedAt: new Date() } : null;
    case BackupStatus.FAILED:
      return {
        status: BackupStatus.PENDING,
        requestedAt: new Date(),
        attempts: 0,
        error: null,
        notBefore: null,
      };
    default:
      return null;
  }
}

/**
 * "Back up again": a new copy is sent, first in line; the earlier one is remembered so it can be
 * deleted from the backup chat once the new one is there (when asked to).
 */
function againData(row: BackupRow, replacePrevious: boolean): Prisma.MessageBackupUpdateInput {
  const earlier =
    row.backupMessageId === null
      ? row.replacedMessageIds
      : [...row.replacedMessageIds, row.backupMessageId, ...row.extraMessageIds];
  return {
    status: BackupStatus.PENDING,
    stage: null,
    skipReason: null,
    force: true,
    replacePrevious,
    replacedMessageIds: earlier,
    requestedAt: new Date(),
    attempts: 0,
    error: null,
    notBefore: null,
    randomId: null,
    uploadedMedia: Prisma.DbNull,
    uploadedBytes: 0n,
    sentName: null,
    sentSize: null,
    sentSha256: null,
    sentTextHash: null,
    backupMessageId: null,
    backupThreadId: null,
    backupGroupedId: null,
    extraMessageIds: [],
    completedAt: null,
    verifiedAt: null,
    verifyError: null,
  };
}
