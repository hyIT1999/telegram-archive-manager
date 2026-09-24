import type { ConfigService } from '@nestjs/config';
import type { QueueOptions } from 'bullmq';
import type { WorkerEnv } from '../config/env.schema.js';

/** Connection and key prefix shared by every queue and worker; they must match the api's. */
export function bullRootOptions(config: ConfigService<WorkerEnv, true>): QueueOptions {
  return {
    prefix: config.get('BULLMQ_PREFIX', { infer: true }),
    connection: {
      url: config.get('REDIS_URL', { infer: true }),
      // Workers block on Redis; BullMQ requires commands to retry until the connection is back.
      maxRetriesPerRequest: null,
    },
  };
}
