import { OnWorkerEvent, Processor } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { type ImportJobData, QUEUES, TelegramErrorCode } from '@tam/shared';
import {
  AuthRequiredError,
  ChatProtectedError,
  ChatUnavailableError,
  FloodWaitError,
  LoginStepError,
} from '@tam/telegram';
import { DelayedError, type Job } from 'bullmq';
import { errorMessage } from '../common/error-message.js';
import { AbortableWorkerHost, isShutdownAbort, requeueForShutdown } from '../shutdown/index.js';
import { TelegramAuthService } from '../telegram/telegram-auth.service.js';
import { TelegramUnavailableError } from '../telegram/telegram.tokens.js';
import { IMPORT_SETTINGS, type ImportSettings } from './import-settings.js';
import { ImportRunner, type RunOutcome } from './import-runner.js';

/** What a run that stopped because of Telegram tells people while it waits to try again. */
export const WAITING_DETAILS = {
  floodWait: (seconds: number) => `Telegram asked to wait ${seconds} s before reading more`,
  unavailable: 'Waiting for the worker to connect to Telegram',
  loggedOut: 'Waiting for Telegram: log in again under Settings → Telegram',
} as const;

/**
 * A job stalls when the worker dies mid-run (its lock expires). Stalls cost nothing here — the
 * run resumes from the last stored page — so they may happen a few times before BullMQ gives up.
 */
const MAX_STALLED = 10;

/**
 * Runs import jobs one at a time (a single Telegram account; parallel reads only trigger rate
 * limits). Waiting for Telegram never uses up a try: the run is delayed and resumes later. Other
 * errors are retried with backoff (see importRunJobOptions), and the job fails after the last try.
 */
@Processor(QUEUES.telegramImport, { concurrency: 1, maxStalledCount: MAX_STALLED })
export class ImportProcessor extends AbortableWorkerHost {
  private readonly logger = new Logger(ImportProcessor.name);

  constructor(
    private readonly runner: ImportRunner,
    private readonly auth: TelegramAuthService,
    @Inject(IMPORT_SETTINGS) private readonly settings: ImportSettings,
  ) {
    super();
  }

  override async process(
    job: Job<ImportJobData>,
    token?: string,
    signal?: AbortSignal,
  ): Promise<RunOutcome> {
    try {
      const outcome = await this.runner.run(job.data, signal);
      this.logger.log(`Import ${job.data.importJobId} run ${job.data.runSeq}: ${outcome}`);
      return outcome;
    } catch (error) {
      if (isShutdownAbort(signal)) {
        await requeueForShutdown(job, token);
      }
      return this.handleError(job, token, error);
    }
  }

  /** Marks the job FAILED once BullMQ has given up on it (last try, or a stall too many). */
  @OnWorkerEvent('failed')
  async onFailed(job: Job<ImportJobData> | undefined, error: Error): Promise<void> {
    if (!job || !isFinalFailure(job, error)) {
      return;
    }
    try {
      await this.runner.fail(
        job.data,
        `The import stopped after ${job.attemptsMade} tries: ${error.message}`,
      );
    } catch (failure) {
      // The reconciler finds the failed run and marks the job later.
      this.logger.warn(
        `Could not mark import ${job.data.importJobId} as failed: ${errorMessage(failure)}`,
      );
    }
  }

  private async handleError(
    job: Job<ImportJobData>,
    token: string | undefined,
    error: unknown,
  ): Promise<RunOutcome> {
    if (error instanceof FloodWaitError) {
      return this.retryLater(
        job,
        token,
        error.seconds * 1000,
        WAITING_DETAILS.floodWait(error.seconds),
      );
    }
    if (error instanceof TelegramUnavailableError) {
      return this.retryLater(
        job,
        token,
        this.settings.unavailableRetryMs,
        WAITING_DETAILS.unavailable,
      );
    }
    if (error instanceof LoginStepError && error.code === TelegramErrorCode.TELEGRAM_NOT_READY) {
      return this.retryLater(
        job,
        token,
        this.settings.unavailableRetryMs,
        WAITING_DETAILS.loggedOut,
      );
    }
    if (error instanceof AuthRequiredError) {
      await this.auth.markSessionRevoked();
      return this.retryLater(
        job,
        token,
        this.settings.unavailableRetryMs,
        WAITING_DETAILS.loggedOut,
      );
    }
    if (error instanceof ChatProtectedError) {
      await this.runner.fail(
        job.data,
        'Content protection was turned on for this chat, so it can no longer be archived.',
      );
      return 'interrupted';
    }
    if (error instanceof ChatUnavailableError) {
      await this.runner.fail(job.data, error.message);
      return 'interrupted';
    }
    this.logger.warn(
      `Import ${job.data.importJobId} run ${job.data.runSeq} failed (try ${job.attemptsMade + 1}): ${errorMessage(error)}`,
    );
    throw error;
  }

  /** Puts the job back as delayed without using up a try, and says why it waits. */
  private async retryLater(
    job: Job<ImportJobData>,
    token: string | undefined,
    delayMs: number,
    detail: string,
  ): Promise<never> {
    await this.runner.noteWaiting(job.data, detail);
    await job.moveToDelayed(Date.now() + delayMs, token);
    throw new DelayedError();
  }
}

/** BullMQ emits 'failed' after every try; only the last one (or an unrecoverable error) counts. */
export function isFinalFailure(job: Job, error: Error): boolean {
  return error.name === 'UnrecoverableError' || job.attemptsMade >= (job.opts.attempts ?? 1);
}
