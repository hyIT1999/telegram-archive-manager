import { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';

/**
 * Creates the api's general-purpose Redis connection. It connects immediately and keeps
 * reconnecting in the background; commands fail after a couple of reconnection attempts
 * instead of piling up, so request handlers and readiness probes stay responsive.
 */
export function createRedisClient(url: string, logger = new Logger('Redis')): Redis {
  const client = new Redis(url, {
    connectionName: 'tam-api',
    lazyConnect: false,
    connectTimeout: 5_000,
    maxRetriesPerRequest: 2,
  });

  // ioredis emits 'error' on every failed reconnect; log the outage once and its recovery once.
  let healthy = true;
  client.on('error', (error: Error) => {
    if (healthy) {
      healthy = false;
      logger.warn(`Redis connection error: ${error.message}`);
    }
  });
  client.on('ready', () => {
    if (!healthy) {
      healthy = true;
      logger.log('Redis connection restored');
    }
  });
  return client;
}

/** QUITs gracefully when connected; otherwise drops the connection and stops reconnecting. */
export async function closeRedisClient(client: Redis): Promise<void> {
  if (client.status === 'end') {
    return;
  }
  if (client.status === 'ready') {
    try {
      await client.quit();
      return;
    } catch {
      // Fall through to a hard disconnect.
    }
  }
  client.disconnect();
}
