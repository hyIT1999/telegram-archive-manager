import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '@tam/database/nest';
import { BACKUP_SETTINGS_KEY, type BackupSettings, readBackupSettings } from '@tam/shared';
import { LEASE_TTL_MS } from '../telegram/telegram-connection.js';

/** BackupTuning, fixed for the process. */
export const BACKUP_TUNING = Symbol('BACKUP_TUNING');

/** How the worker paces and guards Telegram backups. */
export interface BackupTuning {
  /** Between two rounds of the scheduler. */
  schedulerIntervalMs: number;
  /** New messages of backed-up channels get their rows this often. */
  seedIntervalMs: number;
  /** Dead runs are looked for this often. */
  reconcileIntervalMs: number;
  /** A running backup writes to its rows at least this often, even while Telegram makes it wait. */
  touchIntervalMs: number;
  /** A running backup of another process quiet for longer belongs to a dead run. */
  quietAfterMs: number;
  /** No byte for this long (outside Telegram's waits) stops a transfer. */
  stallTimeoutMs: number;
  /** Failed tries before a message is FAILED. */
  maxAttempts: number;
  retryBaseMs: number;
  retryMaxMs: number;
  /** Waiting for Telegram to be ready again. */
  unavailableRetryMs: number;
  /** Progress is written at most this often. */
  progressIntervalMs: number;
  /** Least time between two sends; doubled for an hour after Telegram asked to wait. */
  minSendGapMs: number;
  /** The backup chat waits this long when the account may not post there. */
  attentionPauseMs: number;
  /** ...and this long when Telegram limits what the account may send (PEER_FLOOD). */
  peerFloodPauseMs: number;
  /** An album whose newest part was archived more recently may still grow. */
  albumSettleMs: number;
  /** The Backups settings are read again this often. */
  settingsCacheMs: number;
  /** Verify reads this many copies at once, and the first bytes of this many files. */
  verifyBatch: number;
  verifySampleFiles: number;
  verifySampleBytes: number;
  /** The "verifying" flag expires by itself if the worker dies. */
  verifyFlagTtlMs: number;
}

export function defaultBackupTuning(): BackupTuning {
  return {
    schedulerIntervalMs: 3_000,
    seedIntervalMs: 60_000,
    reconcileIntervalMs: 60_000,
    touchIntervalMs: 30_000,
    quietAfterMs: 3 * LEASE_TTL_MS,
    stallTimeoutMs: 120_000,
    maxAttempts: 8,
    retryBaseMs: 30_000,
    retryMaxMs: 60 * 60_000,
    unavailableRetryMs: 30_000,
    progressIntervalMs: 3_000,
    minSendGapMs: 1_500,
    attentionPauseMs: 30 * 60_000,
    peerFloodPauseMs: 6 * 60 * 60_000,
    albumSettleMs: 2 * 60_000,
    settingsCacheMs: 5_000,
    verifyBatch: 100,
    verifySampleFiles: 5,
    verifySampleBytes: 1024 * 1024,
    verifyFlagTtlMs: 30 * 60_000,
  };
}

/** Marks the rows this process runs; another process (or a restart) has another token. */
export const BACKUP_OWNER = Symbol('BACKUP_OWNER');

export function backupOwnerToken(): string {
  return `${hostname()}:${process.pid}:${randomUUID()}`;
}

/** The Backups settings people chose (app_settings "backups"), read again every few seconds. */
@Injectable()
export class BackupPolicy {
  private cached: { settings: BackupSettings; readAt: number } | undefined;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(BACKUP_TUNING) private readonly tuning: BackupTuning,
  ) {}

  async current(): Promise<BackupSettings> {
    const now = Date.now();
    if (this.cached && now - this.cached.readAt < this.tuning.settingsCacheMs) {
      return this.cached.settings;
    }
    const row = await this.prisma.appSetting.findUnique({ where: { key: BACKUP_SETTINGS_KEY } });
    const settings = readBackupSettings(row?.value);
    this.cached = { settings, readAt: now };
    return settings;
  }
}
