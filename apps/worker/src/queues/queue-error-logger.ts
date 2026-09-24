import { getQueueToken } from '@nestjs/bullmq';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ALL_QUEUES } from '@tam/shared';
import type { Queue } from 'bullmq';

/**
 * BullMQ writes errors of a queue without an 'error' listener straight to stderr, stack traces
 * included. This sends the producer queues' errors (typically Redis connection loss) through the
 * Nest logger instead, so they stay one line each and JSON-formatted in production.
 */
@Injectable()
export class QueueErrorLogger implements OnModuleInit {
  private readonly logger = new Logger('Queues');

  constructor(private readonly moduleRef: ModuleRef) {}

  onModuleInit(): void {
    for (const name of ALL_QUEUES) {
      const queue = this.moduleRef.get<Queue>(getQueueToken(name), { strict: false });
      queue.on('error', (error: Error) => this.logger.warn(`Queue "${name}": ${error.message}`));
    }
  }
}
