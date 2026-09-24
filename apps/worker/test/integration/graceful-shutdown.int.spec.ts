import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PrismaService } from '@tam/database/nest';
import { Queue } from 'bullmq';
import { afterAll, afterEach, describe, expect, inject, it, vi } from 'vitest';
import { SHUTDOWN_ABORT_REASON } from '../../src/shutdown/index.js';
import {
  PROBE_QUEUE,
  ShutdownProbeModule,
  ShutdownProbeProcessor,
} from './support/shutdown-probe.js';
import { TEST_BULLMQ_PREFIX } from './test-env.js';

describe('graceful shutdown of long jobs', () => {
  /** Reads the probe queue from outside the application, which closes during the test. */
  const inspector = new Queue(PROBE_QUEUE, {
    connection: { url: inject('redisUrl') },
    prefix: TEST_BULLMQ_PREFIX,
  });
  let app: INestApplicationContext | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
    await inspector.obliterate({ force: true });
  });

  afterAll(() => inspector.close());

  async function boot(): Promise<INestApplicationContext> {
    app = await NestFactory.createApplicationContext(ShutdownProbeModule, {
      logger: false,
      abortOnError: false,
    });
    return app;
  }

  it('hands BullMQ a processor that receives an AbortSignal', async () => {
    const processor = (await boot()).get(ShutdownProbeProcessor);
    // Worker#processorAcceptsSignal is private; BullMQ creates signals only when it is true.
    expect(Reflect.get(processor.worker, 'processorAcceptsSignal')).toBe(true);
  });

  it('returns an active job to wait without consuming an attempt', async () => {
    const context = await boot();
    const processor = context.get(ShutdownProbeProcessor);
    const queue = context.get<Queue>(getQueueToken(PROBE_QUEUE));

    const job = await queue.add('probe', { note: 'long job' }, { attempts: 3 });
    await expect(processor.started).resolves.toBe(job.id);
    expect(await queue.getJobState(job.id ?? '')).toBe('active');

    const prisma = context.get(PrismaService);
    const disconnect = prisma.onModuleDestroy.bind(prisma);
    vi.spyOn(prisma, 'onModuleDestroy').mockImplementation(async () => {
      processor.timeline.push('database disconnected');
      await disconnect();
    });

    await context.close();
    app = undefined;

    expect(processor.abortReason).toBe(SHUTDOWN_ABORT_REASON);
    // The job yielded while the database was still connected.
    expect(processor.timeline).toEqual(['job requeued', 'database disconnected']);

    const stored = await inspector.getJob(job.id ?? '');
    expect(await stored?.getState()).toBe('waiting');
    expect(stored?.attemptsMade).toBe(0);
    expect(stored?.failedReason).toBeFalsy();
    expect(await inspector.getFailedCount()).toBe(0);
  });
});
