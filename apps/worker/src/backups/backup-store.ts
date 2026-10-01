import { Inject, Injectable } from '@nestjs/common';
import { Prisma, seedMessageBackups } from '@tam/database';
import { PrismaService } from '@tam/database/nest';
import {
  type BackupSkipReason,
  type BackupStage,
  BackupStatus,
  type DownloadStatus,
  type MediaType,
  type MessageType,
} from '@tam/shared';
import { locationConfig } from '@tam/storage';
import type { MessageEntity, UploadedBackupFile } from '@tam/telegram';
import { BACKUP_TUNING, type BackupTuning } from './backup-settings.js';

/** A row a run owns: ACTIVE with the run number it was given. */
export interface BackupRowRef {
  id: string;
  runSeq: number;
  /** Failed tries before this one. */
  attempts: number;
}

/** The archived file of a message, as a backup needs it. */
export interface BackupMediaSource {
  id: string;
  telegramFileId: string;
  telegramFileUniqueId: string;
  type: MediaType;
  filename: string | null;
  mimeType: string | null;
  size: number | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  downloadStatus: DownloadStatus;
  storageLocationId: string | null;
  storageKey: string | null;
  checksum: string | null;
  thumbnailKey: string | null;
}

/** One message of a batch, with what an earlier run left (uploaded file, random id). */
export interface BackupItem extends BackupRowRef {
  messageId: string;
  telegramMessageId: number;
  messageType: MessageType;
  /** The text, or the caption of the file, as the archive stored it first. */
  text: string | null;
  entities: MessageEntity[];
  /** Forum topic in the source (null outside forums and for General). */
  threadId: number | null;
  force: boolean;
  replacePrevious: boolean;
  replacedMessageIds: number[];
  randomId: bigint | null;
  uploadedMedia: UploadedBackupFile | null;
  sentName: string | null;
  sentSize: number | null;
  sentSha256: string | null;
  sentTextHash: string | null;
  media: BackupMediaSource | null;
}

/** What a run backs up at once: one message, or the pending messages of one album. */
export interface BackupBatch {
  location: {
    id: string;
    name: string;
    /** Marked id of the backup chat. */
    chatId: string;
    isForum: boolean;
  };
  channel: {
    /** The channel whose messages these are (an old basic group has its own). */
    id: string;
    title: string;
    /** The supergroup an old group was upgraded to; the channel itself otherwise. */
    ownerId: string;
  };
  /** Oldest message first. */
  items: BackupItem[];
}

/** What arrived in the backup chat for one message. */
export interface SentCopy {
  backupMessageId: number;
  backupGroupedId: string | null;
  extraMessageIds: number[];
}

/** How a run that ended without a copy left its rows. */
export type ReleaseResult = 'waiting' | 'failed' | 'stale';

interface Candidate {
  id: string;
  storage_location_id: string;
  channel_id: string;
  media_group_id: bigint | null;
}

const ITEM_INCLUDE = {
  message: { include: { media: true } },
} satisfies Prisma.MessageBackupInclude;

type ItemRow = Prisma.MessageBackupGetPayload<{ include: typeof ITEM_INCLUDE }>;

function owned(row: Pick<BackupRowRef, 'id' | 'runSeq'>) {
  return { id: row.id, runSeq: row.runSeq, status: BackupStatus.ACTIVE };
}

/** Stored formatting, as the importer wrote it; anything malformed is left out. */
function entitiesOf(value: Prisma.JsonValue | null): MessageEntity[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return [];
    }
    const { kind, offset, length, params } = entry as Record<string, unknown>;
    if (typeof kind !== 'string' || typeof offset !== 'number' || typeof length !== 'number') {
      return [];
    }
    return [
      {
        kind,
        offset,
        length,
        ...(typeof params === 'object' && params !== null && !Array.isArray(params)
          ? { params: params as Record<string, unknown> }
          : {}),
      },
    ];
  });
}

function uploadedOf(value: Prisma.JsonValue | null): UploadedBackupFile | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const { kind, id, accessHash, fileReference } = value as Record<string, unknown>;
  if (
    (kind !== 'photo' && kind !== 'document') ||
    typeof id !== 'string' ||
    typeof accessHash !== 'string' ||
    typeof fileReference !== 'string'
  ) {
    return null;
  }
  return { kind, id, accessHash, fileReference };
}

function toItem(row: ItemRow): BackupItem {
  const message = row.message;
  const media = message.media[0] ?? null;
  return {
    id: row.id,
    runSeq: row.runSeq,
    attempts: row.attempts,
    messageId: message.id,
    telegramMessageId: message.telegramMessageId,
    messageType: message.type,
    text: message.text ?? message.caption,
    entities: entitiesOf(message.entities),
    threadId: message.threadId,
    force: row.force,
    replacePrevious: row.replacePrevious,
    replacedMessageIds: row.replacedMessageIds,
    randomId: row.randomId,
    uploadedMedia: uploadedOf(row.uploadedMedia),
    sentName: row.sentName,
    sentSize: row.sentSize === null ? null : Number(row.sentSize),
    sentSha256: row.sentSha256,
    sentTextHash: row.sentTextHash,
    media: media
      ? {
          id: media.id,
          telegramFileId: media.telegramFileId,
          telegramFileUniqueId: media.telegramFileUniqueId,
          type: media.type,
          filename: media.filename,
          mimeType: media.mimeType,
          size: media.size === null ? null : Number(media.size),
          width: media.width,
          height: media.height,
          duration: media.duration,
          downloadStatus: media.downloadStatus,
          storageLocationId: media.storageLocationId,
          storageKey: media.storageKey,
          checksum: media.checksum,
          thumbnailKey: media.thumbnailKey,
        }
      : null,
  };
}

/**
 * message_backups, changed only by compare-and-set: a run writes while its rows are ACTIVE with
 * its run number, so pausing, switching off or a newer run (after a crash) makes an older one
 * stop at its next write.
 */
@Injectable()
export class BackupStore {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(BACKUP_TUNING) private readonly tuning: BackupTuning,
  ) {}

  /**
   * Rows for the messages that arrived since backup was switched on (sync, imports). Existing
   * rows stay as they are, so this may run as often as needed. Returns how many it created.
   */
  async seedNew(): Promise<number> {
    const channels = await this.prisma.channel.findMany({
      where: { backupEnabled: true, backupLocationId: { not: null }, isProtected: false },
      select: { id: true, backupLocationId: true },
    });
    let created = 0;
    for (const channel of channels) {
      const oldGroups = await this.prisma.channel.findMany({
        where: { migratedToChannelId: channel.id },
        select: { id: true },
      });
      created += await seedMessageBackups(this.prisma, {
        channelIds: [channel.id, ...oldGroups.map((group) => group.id)],
        storageLocationId: channel.backupLocationId!,
      });
    }
    return created;
  }

  /**
   * Makes the next batch ACTIVE for `owner`: asked-for messages first, then the oldest message of
   * a channel with backup on, one backup chat at a time (none while it has an ACTIVE row). A
   * channel being imported waits (its messages are still arriving, newest first), and so does an
   * album that may still grow. Null when nothing is due.
   */
  claim(owner: string): Promise<BackupBatch | null> {
    return this.prisma.$transaction(async (tx) => {
      const [candidate] = await tx.$queryRaw<Candidate[]>`
        SELECT b.id, b.storage_location_id, b.channel_id, g.media_group_id
        FROM message_backups b
        JOIN messages g ON g.id = b.message_id
        JOIN channels c ON c.id = b.channel_id
        LEFT JOIN channels o ON o.id = c.migrated_to_channel_id
        JOIN storage_locations l ON l.id = b.storage_location_id
        WHERE b.status = 'PENDING'
          AND (b.not_before IS NULL OR b.not_before <= now())
          AND (l.unavailable_until IS NULL OR l.unavailable_until <= now())
          AND NOT c.is_protected AND NOT coalesce(o.is_protected, false)
          AND (
            b.requested_at IS NOT NULL
            OR (
              coalesce(o.backup_enabled, c.backup_enabled)
              AND coalesce(o.backup_location_id, c.backup_location_id) = b.storage_location_id
              AND NOT EXISTS (
                SELECT 1 FROM import_jobs j
                WHERE j.channel_id IN (c.id, coalesce(o.id, c.id))
                  AND j.status IN ('PENDING', 'RUNNING', 'PAUSED')
              )
            )
          )
          AND NOT EXISTS (
            SELECT 1 FROM message_backups a
            WHERE a.storage_location_id = b.storage_location_id AND a.status = 'ACTIVE'
          )
        ORDER BY b.requested_at ASC NULLS LAST, g.telegram_date, g.telegram_message_id, b.id
        LIMIT 1
        FOR UPDATE OF b SKIP LOCKED`;
      if (!candidate) {
        return null;
      }
      let ids = [candidate.id];
      if (candidate.media_group_id !== null) {
        const members = await tx.$queryRaw<{ id: string; ready: boolean }[]>`
          WITH album AS (
            SELECT max(g.telegram_message_id) AS last_id, max(g.created_at) AS last_archived
            FROM messages g
            WHERE g.channel_id = ${candidate.channel_id}::uuid
              AND g.media_group_id = ${candidate.media_group_id}
          )
          SELECT b.id,
                 (c.head_message_id > album.last_id
                  OR album.last_archived < now() - make_interval(secs => ${this.tuning.albumSettleMs / 1000})) AS ready
          FROM message_backups b
          JOIN messages g ON g.id = b.message_id
          JOIN channels c ON c.id = g.channel_id
          CROSS JOIN album
          WHERE b.storage_location_id = ${candidate.storage_location_id}::uuid
            AND g.channel_id = ${candidate.channel_id}::uuid
            AND g.media_group_id = ${candidate.media_group_id}
            AND b.status = 'PENDING'
          ORDER BY g.telegram_message_id
          LIMIT 10
          FOR UPDATE OF b SKIP LOCKED`;
        if (members.length > 0 && !members[0]!.ready) {
          // Its last parts may still be on their way: look again a little later.
          await tx.messageBackup.updateMany({
            where: { id: { in: members.map((member) => member.id) } },
            data: { notBefore: new Date(Date.now() + this.tuning.albumSettleMs) },
          });
          return null;
        }
        ids = members.map((member) => member.id);
      }
      await tx.$executeRaw`
        UPDATE message_backups
        SET status = 'ACTIVE', stage = 'FETCHING', run_seq = run_seq + 1, owner = ${owner},
            last_attempt_at = now(), updated_at = now()
        WHERE id = ANY(${ids}::uuid[])`;
      const rows = await tx.messageBackup.findMany({
        where: { id: { in: ids } },
        include: ITEM_INCLUDE,
      });
      const location = await tx.storageLocation.findUniqueOrThrow({
        where: { id: candidate.storage_location_id },
      });
      const channel = await tx.channel.findUniqueOrThrow({ where: { id: candidate.channel_id } });
      const config = locationConfig(location);
      return {
        location: {
          id: location.id,
          name: location.name,
          chatId: config.kind === 'TELEGRAM' ? config.chatId : location.target,
          isForum: config.kind === 'TELEGRAM' && config.isForum,
        },
        channel: {
          id: channel.id,
          title: channel.title,
          ownerId: channel.migratedToChannelId ?? channel.id,
        },
        items: rows.map(toItem).sort((a, b) => a.telegramMessageId - b.telegramMessageId),
      };
    });
  }

  /** The rows of a batch as they are now; null once the run no longer owns one of them. */
  async stillOwned(items: readonly BackupRowRef[]): Promise<boolean> {
    const count = await this.prisma.messageBackup.count({
      where: { OR: items.map(owned) },
    });
    return count === items.length;
  }

  /** Shows the run is alive (a long upload, a wait for Telegram); false once it lost a row. */
  async touch(items: readonly BackupRowRef[]): Promise<boolean> {
    return this.update(items, {});
  }

  async stage(items: readonly BackupRowRef[], stage: BackupStage): Promise<boolean> {
    return this.update(items, { stage });
  }

  async progress(item: BackupRowRef, uploadedBytes: number): Promise<boolean> {
    return this.update([item], { uploadedBytes: BigInt(uploadedBytes) });
  }

  /** A file is uploaded and kept by Telegram: an interrupted album does not upload it again. */
  async uploaded(
    item: BackupRowRef,
    file: UploadedBackupFile,
    sent: { name: string | null; size: number; sha256: string },
  ): Promise<boolean> {
    return this.update([item], {
      uploadedMedia: { ...file },
      sentName: sent.name,
      sentSize: BigInt(sent.size),
      sentSha256: sent.sha256,
      uploadedBytes: BigInt(sent.size),
    });
  }

  /** Forgets uploaded files Telegram no longer has, so they are uploaded again. */
  async forgetUploads(items: readonly BackupRowRef[]): Promise<void> {
    await this.prisma.messageBackup.updateMany({
      where: { id: { in: items.map((item) => item.id) } },
      data: { uploadedMedia: Prisma.DbNull, uploadedBytes: 0n },
    });
  }

  /**
   * Stage SENDING, with the random id of each message: committed before the send, so a crash
   * during it is found by the reconciler and a repeated send cannot post twice.
   */
  async prepareSend(
    items: readonly (BackupRowRef & { randomId: bigint; textHash: string | null })[],
    threadId: number | null,
  ): Promise<boolean> {
    return this.prisma
      .$transaction(async (tx) => {
        for (const item of items) {
          const { count } = await tx.messageBackup.updateMany({
            where: owned(item),
            data: {
              stage: 'SENDING',
              randomId: item.randomId,
              sentTextHash: item.textHash,
              backupThreadId: threadId,
            },
          });
          if (count === 0) {
            throw new StaleRunError();
          }
        }
        return true;
      })
      .catch((error: unknown) => {
        if (error instanceof StaleRunError) {
          return false;
        }
        throw error;
      });
  }

  /** The copies arrived: COMPLETED with where they are. False when the run lost a row. */
  async complete(
    items: readonly BackupRowRef[],
    copies: readonly SentCopy[],
    chatId: string,
  ): Promise<boolean> {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      for (const [index, item] of items.entries()) {
        const copy = copies[index]!;
        await tx.messageBackup.updateMany({
          where: { id: item.id, runSeq: item.runSeq },
          data: {
            status: BackupStatus.COMPLETED,
            stage: null,
            owner: null,
            error: null,
            notBefore: null,
            requestedAt: null,
            force: false,
            uploadedMedia: Prisma.DbNull,
            backupChatId: BigInt(chatId),
            backupMessageId: copy.backupMessageId,
            backupGroupedId: copy.backupGroupedId === null ? null : BigInt(copy.backupGroupedId),
            extraMessageIds: copy.extraMessageIds,
            completedAt: now,
            verifiedAt: null,
            verifyError: null,
          },
        });
      }
      return true;
    });
  }

  /** Earlier copies were deleted from the backup chat after a new one arrived. */
  async replacedDeleted(item: Pick<BackupRowRef, 'id'>): Promise<void> {
    await this.prisma.messageBackup.updateMany({
      where: { id: item.id },
      data: { replacedMessageIds: [], replacePrevious: false },
    });
  }

  /** Something to note on a copy that did arrive (e.g. a follow-up text that did not). */
  async note(item: Pick<BackupRowRef, 'id'>, error: string): Promise<void> {
    await this.prisma.messageBackup.updateMany({ where: { id: item.id }, data: { error } });
  }

  /**
   * The run ends without a copy and the next one waits until `retryAt`. A failed try
   * (`countsAsTry`) counts toward maxAttempts and the last one makes the message FAILED; waiting
   * for Telegram or for a person never counts. Uploaded files and random ids stay for the next
   * run.
   */
  async release(
    items: readonly BackupRowRef[],
    outcome: { error: string; retryAt: Date; countsAsTry: boolean },
  ): Promise<ReleaseResult> {
    let result: ReleaseResult = 'stale';
    await this.prisma.$transaction(async (tx) => {
      for (const item of items) {
        const attempts = item.attempts + (outcome.countsAsTry ? 1 : 0);
        const failed = outcome.countsAsTry && attempts >= this.tuning.maxAttempts;
        const { count } = await tx.messageBackup.updateMany({
          where: owned(item),
          data: {
            status: failed ? BackupStatus.FAILED : BackupStatus.PENDING,
            attempts,
            stage: null,
            owner: null,
            error: outcome.error,
            notBefore: failed ? null : outcome.retryAt,
          },
        });
        if (count > 0) {
          result = failed ? 'failed' : 'waiting';
        }
      }
    });
    return result;
  }

  /** Never backed up as it is: FAILED at once. */
  async fail(items: readonly BackupRowRef[], error: string): Promise<boolean> {
    return this.finish(items, { status: BackupStatus.FAILED, error });
  }

  /** Not backed up, for a reason people see (gone, protected, too large). */
  async skip(
    items: readonly BackupRowRef[],
    reason: BackupSkipReason,
    error: string,
  ): Promise<boolean> {
    return this.finish(items, { status: BackupStatus.SKIPPED, skipReason: reason, error });
  }

  /**
   * Content protection was turned on for the source chat: nothing of it is backed up any more,
   * and automatic backup switches off with a note.
   */
  async protectChannel(channelIds: readonly string[], note: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE message_backups
        SET status = 'SKIPPED', skip_reason = 'PROTECTED', stage = NULL, owner = NULL,
            error = ${note}, not_before = NULL, updated_at = now()
        WHERE channel_id = ANY(${[...channelIds]}::uuid[])
          AND status IN ('PENDING', 'ACTIVE', 'FAILED')
          AND stage IS DISTINCT FROM 'SENDING'`;
      await tx.channel.updateMany({
        where: { id: { in: [...channelIds] } },
        data: { backupEnabled: false, backupNote: note },
      });
    });
  }

  /** The source chat cannot be read: automatic backup waits, and people see why. */
  async noteChannel(channelId: string, note: string): Promise<void> {
    await this.prisma.channel.updateMany({ where: { id: channelId }, data: { backupNote: note } });
  }

  /** Backups to the chat wait until `until`; `message` tells people why. */
  async pauseLocation(locationId: string, until: Date, message: string): Promise<void> {
    await this.prisma.storageLocation.updateMany({
      where: { id: locationId },
      data: { unavailableUntil: until, lastError: message, lastCheckedAt: new Date() },
    });
  }

  /** The chat takes backups again (a send worked). */
  async clearLocation(locationId: string): Promise<void> {
    await this.prisma.storageLocation.updateMany({
      where: { id: locationId, lastError: { not: null } },
      data: { lastError: null },
    });
  }

  /** Running rows quiet since `before` and not owned by `owner`: their run died. */
  async deadRuns(owner: string, before: Date): Promise<BackupBatch[]> {
    const rows = await this.prisma.messageBackup.findMany({
      where: {
        status: BackupStatus.ACTIVE,
        updatedAt: { lt: before },
        OR: [{ owner: null }, { owner: { not: owner } }],
      },
      include: { ...ITEM_INCLUDE, storageLocation: true, channel: true },
      orderBy: { updatedAt: 'asc' },
      take: 50,
    });
    // A run is one location and one channel: an album or a single message.
    const batches = new Map<string, BackupBatch>();
    for (const row of rows) {
      const key = `${row.storageLocationId}:${row.channelId}:${row.runSeq}:${row.message.mediaGroupId ?? row.id}`;
      let batch = batches.get(key);
      if (!batch) {
        const config = locationConfig(row.storageLocation);
        batch = {
          location: {
            id: row.storageLocationId,
            name: row.storageLocation.name,
            chatId: config.kind === 'TELEGRAM' ? config.chatId : row.storageLocation.target,
            isForum: config.kind === 'TELEGRAM' && config.isForum,
          },
          channel: {
            id: row.channelId,
            title: row.channel.title,
            ownerId: row.channel.migratedToChannelId ?? row.channelId,
          },
          items: [],
        };
        batches.set(key, batch);
      }
      batch.items.push(toItem(row));
    }
    return [...batches.values()].map((batch) => ({
      ...batch,
      items: batch.items.sort((a, b) => a.telegramMessageId - b.telegramMessageId),
    }));
  }

  /** Where each of these rows stands in its run (for the reconciler). */
  async stagesOf(items: readonly BackupRowRef[]): Promise<Map<string, BackupStage | null>> {
    const rows = await this.prisma.messageBackup.findMany({
      where: { id: { in: items.map((item) => item.id) } },
      select: { id: true, stage: true },
    });
    return new Map(rows.map((row) => [row.id, row.stage]));
  }

  /** The newest message of the backup chat this archive knows it sent. */
  async lastKnownCopy(locationId: string): Promise<number> {
    const [row] = await this.prisma.$queryRaw<{ last: number | null }[]>`
      SELECT max(greatest(b.backup_message_id, (SELECT max(e) FROM unnest(b.extra_message_ids) e)))::int AS last
      FROM message_backups b
      WHERE b.storage_location_id = ${locationId}::uuid AND b.backup_message_id IS NOT NULL`;
    return row?.last ?? 0;
  }

  /** Which of these messages of the backup chat are recorded as copies (or follow-ups). */
  async recordedCopies(locationId: string, ids: readonly number[]): Promise<Set<number>> {
    if (ids.length === 0) {
      return new Set();
    }
    const rows = await this.prisma.$queryRaw<{ id: number }[]>`
      SELECT DISTINCT x.id::int AS id
      FROM message_backups b
      CROSS JOIN LATERAL (SELECT b.backup_message_id UNION ALL SELECT unnest(b.extra_message_ids)) AS x(id)
      WHERE b.storage_location_id = ${locationId}::uuid AND x.id = ANY(${[...ids]}::int[])`;
    return new Set(rows.map((row) => row.id));
  }

  /**
   * The run stops (shutdown, or it cannot tell whether its send arrived): rows that were being
   * sent lose their owner, so the reconciler reads the backup chat before anything is sent again;
   * the others go back in line.
   */
  async letGo(items: readonly BackupRowRef[], reason: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.messageBackup.updateMany({
        where: { OR: items.map(owned), stage: 'SENDING' },
        data: { owner: null },
      }),
      this.prisma.messageBackup.updateMany({
        where: {
          AND: [
            { OR: items.map(owned) },
            { OR: [{ stage: null }, { stage: { in: ['FETCHING', 'UPLOADING'] } }] },
          ],
        },
        data: {
          status: BackupStatus.PENDING,
          stage: null,
          owner: null,
          error: reason,
          notBefore: null,
        },
      }),
    ]);
  }

  /** Clears SENDING once a dead run's send is known not to have happened. */
  async takeBack(items: readonly BackupRowRef[], error: string): Promise<void> {
    await this.prisma.messageBackup.updateMany({
      where: { id: { in: items.map((item) => item.id) }, status: BackupStatus.ACTIVE },
      data: {
        status: BackupStatus.PENDING,
        stage: null,
        owner: null,
        error,
        notBefore: null,
      },
    });
  }

  /** A dead run's send did arrive: COMPLETED with the copies found in the backup chat. */
  async adopt(
    items: readonly BackupRowRef[],
    copies: readonly SentCopy[],
    chatId: string,
  ): Promise<void> {
    await this.complete(items, copies, chatId);
  }

  /** A dead run's outcome cannot be told: FAILED, for a person to look at the backup chat. */
  async unsure(items: readonly BackupRowRef[], error: string): Promise<void> {
    await this.prisma.messageBackup.updateMany({
      where: { id: { in: items.map((item) => item.id) }, status: BackupStatus.ACTIVE },
      data: { status: BackupStatus.FAILED, stage: null, owner: null, error },
    });
  }

  private async update(
    items: readonly Pick<BackupRowRef, 'id' | 'runSeq'>[],
    data: Prisma.MessageBackupUpdateManyMutationInput,
  ): Promise<boolean> {
    const { count } = await this.prisma.messageBackup.updateMany({
      where: { OR: items.map(owned) },
      data,
    });
    return count === items.length;
  }

  private async finish(
    items: readonly BackupRowRef[],
    data: {
      status: typeof BackupStatus.FAILED | typeof BackupStatus.SKIPPED;
      skipReason?: BackupSkipReason;
      error: string;
    },
  ): Promise<boolean> {
    const { count } = await this.prisma.messageBackup.updateMany({
      where: { OR: items.map(owned) },
      data: {
        status: data.status,
        skipReason: data.skipReason ?? null,
        stage: null,
        owner: null,
        error: data.error,
        notBefore: null,
        uploadedMedia: Prisma.DbNull,
      },
    });
    return count > 0;
  }
}

class StaleRunError extends Error {}
