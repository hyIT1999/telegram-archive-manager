import { OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { type ImportJobData, TelegramErrorCode } from '@tam/shared';
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
import type { TelegramAuthService } from '../telegram/telegram-auth.service.js';
import { TelegramUnavailableError } from '../telegram/telegram.tokens.js';
import type { ImportSettings } from './import-settings.js';
import type { ImportRunner, RunOutcome } from './import-runner.js';

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
export const MAX_STALLED = 10;

/**
 * Runs the jobs of one queue with the ImportRunner: imports and syncs share everything but their
 * queue, so a sync never waits behind a long import. Waiting for Telegram never uses up a try:
 * the run is delayed and resumes later. Other errors are retried with backoff (see
 * importRunJobOptions), and the job fails after the last try.
 *
 * Deliberately not decorated: each queue has a thin @Processor subclass, so a subclass that lost
 * its decorator could never quietly become a second worker of another queue.
 */
export abstract class ImportRunHost extends AbortableWorkerHost {
  private readonly logger: Logger;

  protected constructor(
    private readonly runner: ImportRunner,
    private readonly auth: TelegramAuthService,
    private readonly settings: ImportSettings,
    /** "import" or "sync", for logs and messages. */
    private readonly label: string,
  ) {
    super();
    this.logger = new Logger(new.target.name);
  }

  override async process(
    job: Job<ImportJobData>,
    token?: string,
    signal?: AbortSignal,
  ): Promise<RunOutcome> {
    try {
      const outcome = await this.runner.run(job.data, signal);
      this.logger.log(
        `${capitalized(this.label)} ${job.data.importJobId} run ${job.data.runSeq}: ${outcome}`,
      );
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
        `The ${this.label} stopped after ${job.attemptsMade} tries: ${error.message}`,
      );
    } catch (failure) {
      // The reconciler finds the failed run and marks the job later.
      this.logger.warn(
        `Could not mark ${this.label} ${job.data.importJobId} as failed: ${errorMessage(failure)}`,
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
      `${capitalized(this.label)} ${job.data.importJobId} run ${job.data.runSeq} failed (try ${job.attemptsMade + 1}): ${errorMessage(error)}`,
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

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
