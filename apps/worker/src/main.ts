import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ALL_QUEUES } from '@tam/shared';
import type { Queue } from 'bullmq';
import { errorMessage } from './common/error-message.js';
import { defaultEnvFiles, loadEnvFiles } from './config/env-files.js';
import { validateWorkerEnv, type WorkerEnv } from './config/env.schema.js';
import { createWorkerLogger } from './config/logger.js';
import { ShutdownCoordinator } from './shutdown/shutdown-coordinator.js';

const CONTEXT = 'Bootstrap';

const envFiles = loadEnvFiles(defaultEnvFiles());
const env = readEnvironment();
const logger = createWorkerLogger(env);
logger.debug(`Environment files: ${envFiles.join(', ') || 'none'}`, CONTEXT);

// Imported only now: ConfigModule.forRoot() validates process.env as soon as the module loads.
const { WorkerModule } = await import('./worker.module.js');

const app = await NestFactory.createApplicationContext(WorkerModule, {
  logger,
  abortOnError: false,
}).catch((error: unknown) => {
  logger.error(
    `Worker failed to start: ${errorMessage(error)}`,
    error instanceof Error ? error.stack : undefined,
    CONTEXT,
  );
  process.exit(1);
});

// useProcessExit: after closing, exit(0) instead of re-raising the signal, which Windows cannot
// do for SIGHUP/SIGBREAK.
app.enableShutdownHooks(['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'], { useProcessExit: true });
closeOnShutdownMessage(app);

logger.log(
  'Worker ready',
  {
    pid: process.pid,
    queues: ALL_QUEUES.map((name) => app.get<Queue>(getQueueToken(name)).name),
    prefix: env.BULLMQ_PREFIX,
    processors: app
      .get(ShutdownCoordinator)
      .workers()
      .map((worker) => worker.name),
    heartbeatIntervalMs: env.WORKER_HEARTBEAT_INTERVAL_MS,
  },
  CONTEXT,
);

function readEnvironment(): WorkerEnv {
  try {
    return validateWorkerEnv(process.env);
  } catch (error) {
    // No logger yet: LOG_LEVEL itself may be the invalid value.
    console.error(errorMessage(error));
    process.exit(1);
  }
}

/**
 * pm2 cannot deliver signals on Windows. With `shutdown_with_message: true` it sends a
 * 'shutdown' IPC message instead, which must trigger the same graceful close as SIGINT/SIGTERM.
 */
function closeOnShutdownMessage(context: INestApplicationContext): void {
  let closing = false;
  process.on('message', (message: unknown) => {
    if (message !== 'shutdown' || closing) {
      return;
    }
    closing = true;
    logger.log('Shutdown requested by the process manager', CONTEXT);
    context.close().then(
      () => {
        logger.log('Worker stopped', CONTEXT);
        process.exit(0);
      },
      (error: unknown) => {
        logger.error(
          `Shutdown failed: ${errorMessage(error)}`,
          error instanceof Error ? error.stack : undefined,
          CONTEXT,
        );
        process.exit(1);
      },
    );
  });
}
