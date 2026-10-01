import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { BackupSkipReason, TelegramErrorCode } from '@tam/shared';
import {
  AuthRequiredError,
  type BackupChatMessage,
  type BackupPayload,
  CaptionTooLongError,
  ChatProtectedError,
  ChatUnavailableError,
  ChatWriteForbiddenError,
  EntitiesRejectedError,
  FileTooLargeError,
  FloodWaitError,
  LoginStepError,
  MediaUnavailableError,
  PeerFloodError,
  RandomIdDuplicateError,
  TelegramError,
  TelegramTimeoutError,
  TopicUnavailableError,
  type UploadedBackupFile,
  UploadIncompleteError,
} from '@tam/telegram';
import { errorMessage } from '../common/error-message.js';
import { BACKUP_NOTES } from '../common/sync-notes.js';
import { TelegramAuthService } from '../telegram/telegram-auth.service.js';
import { TelegramCooldown } from '../telegram/telegram-cooldown.js';
import {
  TELEGRAM_API_PROVIDER,
  type TelegramApiProvider,
  TelegramUnavailableError,
} from '../telegram/telegram.tokens.js';
import { BACKUP_TUNING, type BackupTuning } from './backup-settings.js';
import { BackupSourceError, BackupSources, type OpenedSource } from './backup-sources.js';
import { type BackupBatch, type BackupItem, BackupStore, type SentCopy } from './backup-store.js';
import { BackupTopics } from './backup-topics.js';

/** The rows were taken away (paused, switched off, a newer run): the run stops quietly. */
class StaleRunError extends Error {}

/** No byte moved for too long, outside of Telegram's waits. */
class TransferStalledError extends TelegramTimeoutError {
  constructor() {
    super('The upload made no progress for too long');
  }
}

/**
 * A failure of the backup chat (sending, uploading into it, its topics), told apart from the
 * source: CHANNEL_PRIVATE there means the backup chat is gone, not the archived channel.
 */
class BackupTargetError extends Error {
  constructor(readonly original: unknown) {
    super(errorMessage(original));
  }
}

/** Telegram's random ids are int64: 8 random bytes, never 0. */
function randomId(): bigint {
  const value = randomBytes(8).readBigInt64BE();
  return value === 0n ? 1n : value;
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function later(ms: number): Date {
  return new Date(Date.now() + ms);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted || ms <= 0) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', done);
      resolve();
    }, ms);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener('abort', done, { once: true });
  });
}

/** The text the archive stored for a message; what the copy carries. */
function textOf(item: BackupItem): string {
  return item.text ?? '';
}

/** A copy found in the backup chat for a message whose send outcome was unknown. */
export type FoundCopies = SentCopy[] | 'none' | 'unsure';

/**
 * Backs up one batch (a message, or an album) as NEW messages in the backup chat: never a
 * forward. Each file is uploaded again from its source (a downloaded copy, or Telegram's copy
 * streamed as it uploads), then everything is sent at once with random ids stored beforehand.
 * A send whose outcome is unknown is never repeated blindly: the backup chat is read first.
 */
@Injectable()
export class BackupSender {
  private readonly logger = new Logger(BackupSender.name);
  private lastSendAt = 0;
  /** After Telegram asked the sends to wait, they are spaced twice as far until then. */
  private slowUntil = 0;

  constructor(
    private readonly store: BackupStore,
    private readonly sources: BackupSources,
    private readonly topics: BackupTopics,
    private readonly cooldown: TelegramCooldown,
    private readonly auth: TelegramAuthService,
    @Inject(TELEGRAM_API_PROVIDER) private readonly telegram: TelegramApiProvider,
    @Inject(BACKUP_TUNING) private readonly tuning: BackupTuning,
  ) {}

  /** Settles the batch: sent, waiting, failed or skipped. Never throws. */
  async run(batch: BackupBatch, shutdown: AbortSignal): Promise<void> {
    const lost = new AbortController();
    const signal = AbortSignal.any([shutdown, lost.signal]);
    const alive = setInterval(() => {
      void this.store
        .touch(batch.items)
        .then((owned) => {
          if (!owned) {
            lost.abort(new StaleRunError());
          }
        })
        .catch(() => undefined);
    }, this.tuning.touchIntervalMs);
    alive.unref();
    let phase: 'upload' | 'send' = 'upload';
    try {
      const items = await this.uploadAll(batch, signal);
      if (items.length === 0) {
        return;
      }
      phase = 'send';
      await this.send(batch, items, signal);
    } catch (error) {
      await this.handleFailure(batch, error, phase, shutdown, lost.signal);
    } finally {
      clearInterval(alive);
    }
  }

  /**
   * Reads the backup chat for the copies of `items` sent by a run whose outcome is unknown:
   * messages newer than the last copy the archive knows of, sent by this account and not
   * recorded. One batch sends at a time per backup chat, so they can only be that batch's.
   */
  async findSent(batch: BackupBatch, items: readonly BackupItem[]): Promise<FoundCopies> {
    const after = await this.store.lastKnownCopy(batch.location.id);
    const history = await this.telegram.api.getBackupHistory(batch.location.chatId, after);
    const recorded = await this.store.recordedCopies(
      batch.location.id,
      history.map((message) => message.id),
    );
    const candidates = history.filter(
      (message) =>
        message.isOutgoing &&
        !message.isService &&
        !message.isForwarded &&
        !recorded.has(message.id),
    );
    const matches: BackupChatMessage[][] = [];
    if (items.length === 1) {
      for (const message of candidates) {
        if (matchesItem(items[0]!, message)) {
          matches.push([message]);
        }
      }
    } else {
      const groups = new Map<string, BackupChatMessage[]>();
      for (const message of candidates) {
        if (message.groupedId !== null) {
          groups.set(message.groupedId, [...(groups.get(message.groupedId) ?? []), message]);
        }
      }
      for (const group of groups.values()) {
        const ordered = group.sort((a, b) => a.id - b.id);
        if (
          ordered.length === items.length &&
          ordered.every((message, index) => matchesItem(items[index]!, message))
        ) {
          matches.push(ordered);
        }
      }
    }
    if (matches.length === 0) {
      return 'none';
    }
    if (matches.length > 1) {
      return 'unsure';
    }
    return matches[0]!.map((message) => ({
      backupMessageId: message.id,
      backupGroupedId: message.groupedId,
      extraMessageIds: [],
    }));
  }

  /** Uploads every file of the batch not uploaded yet; returns the items still to send. */
  private async uploadAll(batch: BackupBatch, signal: AbortSignal): Promise<BackupItem[]> {
    const items: BackupItem[] = [];
    for (const item of batch.items) {
      signal.throwIfAborted();
      if (item.media === null) {
        if (textOf(item).trim() === '') {
          await this.store.skip([item], BackupSkipReason.UNSUPPORTED, 'The message has no text.');
          continue;
        }
        items.push(item);
        continue;
      }
      if (item.uploadedMedia !== null) {
        items.push(item);
        continue;
      }
      const opened = await this.open(batch, item, signal);
      if (opened === null) {
        continue;
      }
      if (!(await this.store.stage([item], 'UPLOADING'))) {
        await opened.input.stream.cancel().catch(() => undefined);
        throw new StaleRunError();
      }
      let uploaded: UploadedBackupFile;
      try {
        uploaded = await this.upload(batch, item, opened, signal);
      } catch (error) {
        const cause = error instanceof BackupTargetError ? error.original : error;
        if (cause instanceof FileTooLargeError) {
          await this.store.skip([item], BackupSkipReason.TOO_LARGE, cause.message);
          continue;
        }
        throw error;
      }
      const sent = {
        name: opened.input.attributes.fileName,
        size: opened.input.size,
        sha256: opened.sha256(),
      };
      if (!(await this.store.uploaded(item, uploaded, sent))) {
        throw new StaleRunError();
      }
      items.push({
        ...item,
        uploadedMedia: uploaded,
        sentName: sent.name,
        sentSize: sent.size,
        sentSha256: sent.sha256,
      });
    }
    return items;
  }

  /** The file's source; null once the message was settled as not backed up. */
  private async open(
    batch: BackupBatch,
    item: BackupItem,
    signal: AbortSignal,
  ): Promise<OpenedSource | null> {
    try {
      return await this.sources.open(item.media!, signal);
    } catch (error) {
      const cause = error instanceof BackupSourceError ? error.original : error;
      if (cause instanceof MediaUnavailableError) {
        await this.store.skip(
          [item],
          BackupSkipReason.NOT_AVAILABLE,
          `${cause.message}, and the file was never downloaded.`,
        );
        return null;
      }
      if (cause instanceof ChatProtectedError) {
        await this.store.protectChannel(
          [batch.channel.id, batch.channel.ownerId],
          BACKUP_NOTES.protected,
        );
        throw new StaleRunError();
      }
      throw error;
    }
  }

  /** Streams one file into an upload for the backup chat, with a watchdog and progress. */
  private async upload(
    batch: BackupBatch,
    item: BackupItem,
    opened: OpenedSource,
    signal: AbortSignal,
  ): Promise<UploadedBackupFile> {
    const stalled = new AbortController();
    const upload = AbortSignal.any([signal, stalled.signal]);
    let uploadedBytes = 0;
    let reported = 0;
    let last = { bytes: -1, at: Date.now() };
    const watchdog = setInterval(
      () => {
        const moved = opened.bytes() + uploadedBytes;
        const now = Date.now();
        // Telegram asked to wait: mtcute sleeps through it and nothing moves meanwhile.
        if (
          moved !== last.bytes ||
          this.cooldown.uploadRemainingMs() > 0 ||
          this.cooldown.remainingMs() > 0
        ) {
          last = { bytes: moved, at: now };
          return;
        }
        if (now - last.at > this.tuning.stallTimeoutMs) {
          stalled.abort(new TransferStalledError());
        }
      },
      Math.min(5_000, this.tuning.stallTimeoutMs / 2),
    );
    watchdog.unref();
    try {
      const uploaded = await this.telegram.api
        .uploadBackupFile(batch.location.chatId, opened.input, {
          signal: upload,
          onProgress: (bytes) => {
            uploadedBytes = bytes;
            if (Date.now() - reported >= this.tuning.progressIntervalMs) {
              reported = Date.now();
              void this.store.progress(item, bytes).catch(() => undefined);
            }
          },
        })
        .catch((error: unknown) => {
          if (stalled.signal.aborted) {
            throw stalled.signal.reason;
          }
          if (error instanceof BackupSourceError || signal.aborted) {
            throw error;
          }
          throw new BackupTargetError(error);
        });
      if (opened.bytes() !== opened.input.size) {
        throw new TelegramError(
          `Only ${opened.bytes()} of ${opened.input.size} bytes of the file arrived`,
          TelegramErrorCode.TELEGRAM_ERROR,
        );
      }
      return uploaded;
    } finally {
      clearInterval(watchdog);
    }
  }

  /** Sends the batch as new messages and records the copies. */
  private async send(batch: BackupBatch, items: BackupItem[], signal: AbortSignal): Promise<void> {
    await this.pace(signal);
    signal.throwIfAborted();
    const sourceTopic = items[0]!.threadId;
    let threadId = await this.topicOf(batch, sourceTopic);
    const prepared = items.map((item) => ({
      ...item,
      randomId: item.randomId ?? randomId(),
      textHash: textOf(item) === '' ? null : sha256(textOf(item)),
    }));
    if (!(await this.store.prepareSend(prepared, threadId))) {
      throw new StaleRunError();
    }
    const randomIds = prepared.map((item) => item.randomId);
    let dropEntities = false;
    let captionsApart = false;
    let copies: SentCopy[] | null = null;
    for (let fix = 0; copies === null; fix += 1) {
      try {
        const sent = await this.telegram.api.sendBackup(
          batch.location.chatId,
          payloadOf(items, { dropEntities, captionsApart }),
          { threadId, randomIds },
        );
        this.lastSendAt = Date.now();
        copies = sent.map((message) => ({
          backupMessageId: message.messageId,
          backupGroupedId: message.groupedId,
          extraMessageIds: [],
        }));
      } catch (error) {
        // These are refusals: nothing was sent, so the same random ids are sent again.
        if (fix < 3 && error instanceof EntitiesRejectedError && !dropEntities) {
          dropEntities = true;
          continue;
        }
        if (fix < 3 && error instanceof CaptionTooLongError && !captionsApart) {
          captionsApart = true;
          continue;
        }
        if (fix < 3 && error instanceof TopicUnavailableError && sourceTopic !== null) {
          await this.topics.forget(batch, sourceTopic);
          threadId = await this.topicOf(batch, sourceTopic);
          continue;
        }
        if (error instanceof RandomIdDuplicateError) {
          // An earlier send of this batch arrived after all.
          await this.settleFound(batch, items, await this.findSent(batch, items));
          return;
        }
        if (isRefusal(error)) {
          throw new BackupTargetError(error);
        }
        // Timeout, lost connection, lost lease: whether Telegram posted it cannot be told.
        await this.settleUnknown(batch, items, error, signal);
        return;
      }
    }
    if (captionsApart) {
      await this.sendCaptionsApart(batch, items, copies, threadId);
    }
    await this.store.complete(items, copies, batch.location.chatId);
    await this.store.clearLocation(batch.location.id);
    await this.replaceEarlier(batch, items);
  }

  private async topicOf(batch: BackupBatch, sourceTopic: number | null): Promise<number | null> {
    try {
      return await this.topics.topicFor(batch, sourceTopic);
    } catch (error) {
      throw new BackupTargetError(error);
    }
  }

  /** Captions longer than Telegram takes with a file follow as texts of their own. */
  private async sendCaptionsApart(
    batch: BackupBatch,
    items: readonly BackupItem[],
    copies: SentCopy[],
    threadId: number | null,
  ): Promise<void> {
    for (const [index, item] of items.entries()) {
      const text = textOf(item);
      if (text === '') {
        continue;
      }
      try {
        const [sent] = await this.telegram.api.sendBackup(
          batch.location.chatId,
          { kind: 'text', text: { text, entities: item.entities }, disableWebPreview: true },
          { threadId, randomIds: [randomId()] },
        );
        copies[index]!.extraMessageIds.push(sent!.messageId);
      } catch (error) {
        await this.store.note(
          item,
          `The caption was too long to go with the file, and sending it apart failed: ${errorMessage(error)}`,
        );
      }
    }
  }

  /** "Back up again" asked to delete the earlier copies once the new ones arrived. */
  private async replaceEarlier(batch: BackupBatch, items: readonly BackupItem[]): Promise<void> {
    for (const item of items) {
      if (!item.replacePrevious || item.replacedMessageIds.length === 0) {
        continue;
      }
      try {
        await this.telegram.api.deleteBackupMessages(
          batch.location.chatId,
          item.replacedMessageIds,
        );
        await this.store.replacedDeleted(item);
      } catch (error) {
        await this.store.note(
          item,
          `The earlier copy could not be deleted from the backup chat: ${errorMessage(error)}`,
        );
      }
    }
  }

  /** The outcome of a send is unknown: the backup chat tells, else the rows wait for a new try. */
  private async settleUnknown(
    batch: BackupBatch,
    items: readonly BackupItem[],
    error: unknown,
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted) {
      // Stopping: the reconciler (of the next start) reads the backup chat first.
      await this.store.letGo(items, 'The worker stopped while sending');
      return;
    }
    let found: FoundCopies;
    try {
      found = await this.findSent(batch, items);
    } catch {
      // Telegram cannot be asked now: the reconciler looks later (the rows stay SENDING).
      this.logger.warn(
        `Could not tell whether the backup of ${batch.items.length} message(s) arrived: ${errorMessage(error)}`,
      );
      await this.store.letGo(items, errorMessage(error));
      return;
    }
    if (found === 'none') {
      // Not posted: the same random ids go again (Telegram refuses them if it was posted late).
      await this.store.release(items, {
        error: errorMessage(error),
        retryAt: later(this.retryDelay(items)),
        countsAsTry: true,
      });
      return;
    }
    await this.settleFound(batch, items, found);
  }

  private async settleFound(
    batch: BackupBatch,
    items: readonly BackupItem[],
    found: FoundCopies,
  ): Promise<void> {
    if (found === 'none' || found === 'unsure') {
      await this.store.unsure(
        items,
        'Telegram says this was sent already, but the copy could not be told apart in the backup chat. Look there before using Retry.',
      );
      return;
    }
    await this.store.adopt(items, found, batch.location.chatId);
    await this.replaceEarlier(batch, items);
  }

  /** Sends are spaced out; twice as far for an hour after Telegram asked them to wait. */
  private async pace(signal: AbortSignal): Promise<void> {
    const gap =
      Date.now() < this.slowUntil ? this.tuning.minSendGapMs * 2 : this.tuning.minSendGapMs;
    await sleep(this.lastSendAt + gap - Date.now(), signal);
  }

  private retryDelay(items: readonly BackupItem[]): number {
    const attempts = Math.max(...items.map((item) => item.attempts));
    const delay = Math.min(this.tuning.retryMaxMs, this.tuning.retryBaseMs * 2 ** attempts);
    return delay * (0.9 + Math.random() * 0.2);
  }

  private async handleFailure(
    batch: BackupBatch,
    error: unknown,
    phase: 'upload' | 'send',
    shutdown: AbortSignal,
    lost: AbortSignal,
  ): Promise<void> {
    const items = batch.items;
    if (error instanceof StaleRunError || lost.aborted) {
      return;
    }
    if (shutdown.aborted) {
      await this.store.letGo(items, 'The worker stopped; the backup starts again with it');
      return;
    }
    const target = error instanceof BackupTargetError;
    const cause =
      error instanceof BackupTargetError
        ? error.original
        : error instanceof BackupSourceError
          ? error.original
          : error;

    if (cause instanceof FloodWaitError) {
      if (target) {
        // Sends wait: only this backup chat, and only the backups.
        this.slowUntil = Date.now() + 60 * 60_000;
        await this.store.pauseLocation(
          batch.location.id,
          later(cause.seconds * 1000),
          `Telegram asked to wait ${Math.ceil(cause.seconds / 60)} min before sending more. Backups go on after that.`,
        );
      } else {
        this.cooldown.note(cause.seconds);
      }
      await this.release(
        items,
        `Telegram asked to wait ${cause.seconds} s`,
        cause.seconds * 1000,
        false,
      );
      return;
    }
    if (cause instanceof PeerFloodError) {
      await this.store.pauseLocation(
        batch.location.id,
        later(this.tuning.peerFloodPauseMs),
        'Telegram limits how much this account may send right now (PEER_FLOOD). Backups wait a few hours; sending less at once helps.',
      );
      await this.release(items, cause.message, this.tuning.peerFloodPauseMs, false);
      return;
    }
    if (
      cause instanceof TelegramUnavailableError ||
      (cause instanceof LoginStepError && cause.code === TelegramErrorCode.TELEGRAM_NOT_READY)
    ) {
      await this.release(
        items,
        'Waiting for the worker to connect to Telegram',
        this.tuning.unavailableRetryMs,
        false,
      );
      return;
    }
    if (cause instanceof AuthRequiredError) {
      await this.auth.markSessionRevoked();
      await this.release(
        items,
        'Telegram sign-in expired: sign in again under Settings → Telegram account',
        this.tuning.unavailableRetryMs,
        false,
      );
      return;
    }
    if (
      target &&
      (cause instanceof ChatWriteForbiddenError || cause instanceof ChatUnavailableError)
    ) {
      const message =
        cause instanceof ChatWriteForbiddenError
          ? `This Telegram account may no longer post in "${batch.location.name}". Give it back the right to post, then use Check in Settings → Storage locations.`
          : `This Telegram account can no longer reach "${batch.location.name}" (it left, or the chat is gone).`;
      await this.store.pauseLocation(
        batch.location.id,
        later(this.tuning.attentionPauseMs),
        message,
      );
      await this.release(items, message, this.tuning.attentionPauseMs, false);
      return;
    }
    if (!target && cause instanceof ChatUnavailableError) {
      const note =
        'This account can no longer read the archived chat, so its files cannot be backed up from Telegram.';
      await this.store.noteChannel(batch.channel.ownerId, note);
      await this.release(items, note, 60 * 60_000, false);
      return;
    }
    if (phase === 'send' && cause instanceof UploadIncompleteError) {
      // Telegram lost an uploaded file: that one (or all, when it does not say) goes again.
      const index = cause.fileIndex;
      await this.store.forgetUploads(
        index === null ? items : items.filter((_, at) => at === index),
      );
    }
    const message = errorMessage(cause);
    const result = await this.store.release(items, {
      error: message,
      retryAt: later(this.retryDelay(items)),
      countsAsTry: true,
    });
    const attempt = Math.max(...items.map((item) => item.attempts)) + 1;
    this.logger.warn(
      `Backup of ${items.length} message(s) failed (try ${attempt} of ${this.tuning.maxAttempts}${result === 'failed' ? ', given up' : ''}): ${message}`,
    );
  }

  private async release(
    items: readonly BackupItem[],
    reason: string,
    delayMs: number,
    countsAsTry: boolean,
  ): Promise<void> {
    await this.store.release(items, { error: reason, retryAt: later(delayMs), countsAsTry });
  }
}

/** Refusals of a send: Telegram did not post anything. */
function isRefusal(error: unknown): boolean {
  return (
    error instanceof FloodWaitError ||
    error instanceof PeerFloodError ||
    error instanceof ChatWriteForbiddenError ||
    error instanceof ChatUnavailableError ||
    error instanceof TopicUnavailableError ||
    error instanceof CaptionTooLongError ||
    error instanceof EntitiesRejectedError ||
    error instanceof UploadIncompleteError ||
    error instanceof AuthRequiredError ||
    error instanceof FileTooLargeError
  );
}

/** What a batch sends: one text, or its files, each with its caption. */
function payloadOf(
  items: readonly BackupItem[],
  options: { dropEntities: boolean; captionsApart: boolean },
): BackupPayload {
  const [first] = items;
  if (items.length === 1 && first!.uploadedMedia === null) {
    return {
      kind: 'text',
      text: { text: textOf(first!), entities: options.dropEntities ? [] : first!.entities },
      disableWebPreview: first!.messageType !== 'WEBPAGE',
    };
  }
  return {
    kind: 'media',
    items: items.map((item) => ({
      file: item.uploadedMedia!,
      caption:
        options.captionsApart || textOf(item) === ''
          ? null
          : { text: textOf(item), entities: options.dropEntities ? [] : item.entities },
    })),
  };
}

/** Whether a message of the backup chat is the copy of `item`, as it was sent. */
function matchesItem(item: BackupItem, message: BackupChatMessage): boolean {
  if (item.uploadedMedia === null && item.media === null) {
    return (
      message.media === null &&
      item.sentTextHash !== null &&
      sha256(message.text) === item.sentTextHash
    );
  }
  if (message.media === null) {
    return false;
  }
  if (item.uploadedMedia?.kind === 'photo' || item.media?.type === 'PHOTO') {
    // Telegram recompresses photos: the caption tells them apart.
    return message.media.type === 'PHOTO' && sha256(message.text) === sha256(textOf(item));
  }
  return (
    message.media.size === item.sentSize &&
    (item.sentName === null || message.media.fileName === item.sentName)
  );
}
