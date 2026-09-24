import type { INestApplicationContext, LoggerService } from '@nestjs/common';

/**
 * pm2 cannot send POSIX signals on Windows; with `shutdown_with_message` it sends the IPC
 * message 'shutdown' instead. Closes the app like SIGTERM would, then exits (the IPC channel
 * would otherwise keep the process alive).
 */
export function closeOnShutdownMessage(app: INestApplicationContext, logger: LoggerService): void {
  let closing = false;
  process.on('message', (message: unknown) => {
    if (message !== 'shutdown' || closing) {
      return;
    }
    closing = true;
    logger.log('Received shutdown message, closing', 'Shutdown');
    app.close().then(
      () => process.exit(0),
      (error: unknown) => {
        const stack = error instanceof Error ? error.stack : undefined;
        logger.error(`Shutdown failed: ${String(error)}`, stack, 'Shutdown');
        process.exit(1);
      },
    );
  });
}
