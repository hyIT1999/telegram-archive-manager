import { Processor } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { MAX_DOWNLOAD_CONCURRENCY, type MediaDownloadJobData, QUEUES } from '@tam/shared';
import type { Job } from 'bullmq';
import { AbortableWorkerHost, isShutdownAbort, requeueForShutdown } from '../shutdown/index.js';
import { DownloadScheduler } from './download-scheduler.js';
import { type DownloadOutcome, MediaDownloader } from './media-downloader.js';

/**
 * A crashed worker leaves its tries ACTIVE; BullMQ hands them out again once their lock expires,
 * and they resume from their partial files. That may happen a few times before BullMQ gives up
 * (the reconciler then puts the file back in line).
 */
const MAX_STALLED = 10;

/**
 * Runs download tries. The scheduler never queues more tries than the download settings allow at
 * once, so the fixed concurrency here is only the upper bound. Failures are recorded in
 * download_jobs by the downloader; a job only fails in BullMQ on unexpected errors.
 */
@Processor(QUEUES.mediaDownload, {
  concurrency: MAX_DOWNLOAD_CONCURRENCY,
  maxStalledCount: MAX_STALLED,
})
export class MediaDownloadProcessor extends AbortableWorkerHost {
  private readonly logger = new Logger(MediaDownloadProcessor.name);

  constructor(
    private readonly downloader: MediaDownloader,
    private readonly scheduler: DownloadScheduler,
  ) {
    super();
  }

  override async process(
    job: Job<MediaDownloadJobData>,
    token?: string,
    signal?: AbortSignal,
  ): Promise<DownloadOutcome> {
    try {
      const outcome = await this.downloader.run(job.data, signal);
      this.logger.debug(`Download ${job.data.downloadJobId} try ${job.data.runSeq}: ${outcome}`);
      return outcome;
    } catch (error) {
      if (isShutdownAbort(signal)) {
        await requeueForShutdown(job, token);
      }
      throw error;
    } finally {
      this.scheduler.nudge();
    }
  }
}
