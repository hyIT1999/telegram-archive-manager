import { WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import type { Worker } from 'bullmq';
import { errorMessage } from '../common/error-message.js';
import { SHUTDOWN_ABORT_REASON } from './shutdown-abort.js';

/**
 * Stops every BullMQ worker at the start of shutdown and asks active jobs to hand themselves back
 * to the queue (see AbortableWorkerHost), then waits until they have.
 *
 * This runs in onModuleDestroy rather than beforeApplicationShutdown. Nest runs every
 * onModuleDestroy hook before any beforeApplicationShutdown hook, and the global PrismaModule
 * disconnects in its onModuleDestroy. Processors still need the database until they reach a
 * safe point. Nest destroys the root module first and global modules last, so this provider
 * must stay in WorkerModule itself.
 */
@Injectable()
export class ShutdownCoordinator implements OnModuleDestroy {
  private readonly logger = new Logger(ShutdownCoordinator.name);

  constructor(private readonly discovery: DiscoveryService) {}

  /** The BullMQ workers @nestjs/bullmq created for @Processor classes. */
  workers(): Worker[] {
    const workers = new Set<Worker>();
    for (const wrapper of this.discovery.getProviders()) {
      const instance: unknown = wrapper.isDependencyTreeStatic() ? wrapper.instance : undefined;
      if (instance instanceof WorkerHost) {
        try {
          workers.add(instance.worker);
        } catch {
          // Not registered (BullModule manualRegistration); there is nothing to stop.
        }
      }
    }
    return [...workers];
  }

  async onModuleDestroy(): Promise<void> {
    const workers = this.workers();
    if (workers.length === 0) {
      this.logger.log('Shutting down');
      return;
    }
    this.logger.log(
      `Shutting down: stopping ${workers.length} worker(s), active jobs are asked to yield`,
    );
    // close() comes first: it stops fetching, so a job that yields is not replaced by the next
    // waiting one, and it resolves once the active jobs have settled.
    const closing = workers.map((worker) => worker.close());
    for (const worker of workers) {
      worker.cancelAllJobs(SHUTDOWN_ABORT_REASON);
    }
    const results = await Promise.allSettled(closing);
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        this.logger.error(
          `Worker "${workers[index]?.name}" did not close cleanly: ${errorMessage(result.reason)}`,
        );
      }
    });
  }
}
