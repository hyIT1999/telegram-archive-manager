import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { PrismaService } from '@tam/database/nest';
import { REDIS_KEYS, type HealthReadyDto } from '@tam/shared';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants.js';
import { workerStatusFromHeartbeat } from './worker-heartbeat.js';

/** A probe that takes longer than this counts as down, so /ready always answers quickly. */
const PROBE_TIMEOUT_MS = 2_000;

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly indicators: HealthIndicatorService,
  ) {}

  /** Database and Redis decide readiness; the worker is reported but never fails the check. */
  async readiness(): Promise<HealthReadyDto> {
    const [database, redis] = await Promise.all([
      this.indicators
        .check('database')
        .attempt(async () => {
          await this.prisma.$queryRaw`SELECT 1`;
        })
        .withTimeout(PROBE_TIMEOUT_MS),
      this.indicators
        .check('redis')
        .attempt(async () => {
          const [pong, heartbeat] = await Promise.all([
            this.redis.ping(),
            this.redis.get(REDIS_KEYS.workerHeartbeat),
          ]);
          if (pong !== 'PONG') {
            throw new Error(`Unexpected PING reply: ${pong}`);
          }
          return { heartbeat };
        })
        .withTimeout(PROBE_TIMEOUT_MS),
    ]);

    const databaseStatus = database.database.status === 'up' ? 'up' : 'down';
    const redisStatus = redis.redis.status === 'up' ? 'up' : 'down';
    const heartbeat: unknown = redis.redis['heartbeat'];
    return {
      status: databaseStatus === 'up' && redisStatus === 'up' ? 'ok' : 'error',
      checks: { database: databaseStatus, redis: redisStatus },
      worker: workerStatusFromHeartbeat(typeof heartbeat === 'string' ? heartbeat : null),
    };
  }
}
