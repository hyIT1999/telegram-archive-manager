import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';

const RENEW_IF_OWNER = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0`;

const RELEASE_IF_OWNER = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0`;

/**
 * A Redis lease (SET NX PX + compare-and-renew/compare-and-delete). Guarantees that at most one
 * worker process holds the Telegram connection: two processes using the same auth key would make
 * Telegram revoke the session (AUTH_KEY_DUPLICATED).
 */
export class RedisLease {
  readonly token: string;

  constructor(
    private readonly redis: Redis,
    private readonly key: string,
    private readonly ttlMs: number,
    owner: string,
  ) {
    this.token = `${owner}:${randomUUID()}`;
  }

  async tryAcquire(): Promise<boolean> {
    return (await this.redis.set(this.key, this.token, 'PX', this.ttlMs, 'NX')) === 'OK';
  }

  /** False when the lease expired or another process took it over. */
  async renew(): Promise<boolean> {
    return (await this.redis.eval(RENEW_IF_OWNER, 1, this.key, this.token, String(this.ttlMs))) === 1;
  }

  async release(): Promise<void> {
    await this.redis.eval(RELEASE_IF_OWNER, 1, this.key, this.token);
  }
}
