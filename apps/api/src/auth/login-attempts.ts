import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiErrorCode } from '@tam/shared';
import { Redis } from 'ioredis';
import { RetryAfterException } from '../common/errors/retry-after.exception.js';
import type { Env } from '../config/env.js';
import { REDIS_CLIENT } from '../redis/redis.constants.js';
import { loginFailuresKey, type LoginLockoutSettings } from './login-lockout.js';

export const LOGIN_LOCKOUT_SETTINGS = Symbol('LOGIN_LOCKOUT_SETTINGS');

/**
 * Counts failed sign-ins per email in Redis, whatever the client address: after
 * `maxFailures` within `windowMs` of the first one, the email is locked until the window ends.
 * Unknown emails are counted the same way, so a lock never tells whether an account exists.
 * Redis being down never blocks a sign-in (the per-address rate limit still applies).
 */
@Injectable()
export class LoginAttempts {
  private readonly logger = new Logger(LoginAttempts.name);
  private readonly prefix: string;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(LOGIN_LOCKOUT_SETTINGS) private readonly settings: LoginLockoutSettings,
    config: ConfigService<Env, true>,
  ) {
    this.prefix = config.get('BULLMQ_PREFIX', { infer: true });
  }

  /** Throws 429 LOGIN_LOCKED (with Retry-After) while the email is locked. */
  async assertNotLocked(email: string): Promise<void> {
    const key = loginFailuresKey(this.prefix, email);
    let failures: number;
    let remainingMs: number;
    try {
      const [count, ttl] = await Promise.all([this.redis.get(key), this.redis.pttl(key)]);
      failures = Number(count ?? 0);
      remainingMs = ttl;
    } catch (error) {
      this.warn('check', error);
      return;
    }
    if (failures < this.settings.maxFailures) {
      return;
    }
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((remainingMs > 0 ? remainingMs : 1_000) / 1_000),
    );
    const minutes = Math.ceil(retryAfterSeconds / 60);
    throw new RetryAfterException(
      {
        message: `Too many failed sign-ins for this email. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
        code: ApiErrorCode.LOGIN_LOCKED,
      },
      HttpStatus.TOO_MANY_REQUESTS,
      retryAfterSeconds,
    );
  }

  /** Counts a failure; the first one starts the window. */
  async recordFailure(email: string): Promise<void> {
    const key = loginFailuresKey(this.prefix, email);
    try {
      await this.redis.multi().incr(key).pexpire(key, this.settings.windowMs, 'NX').exec();
    } catch (error) {
      this.warn('count', error);
    }
  }

  /** Forgets the failures after a successful sign-in or password change. */
  async clear(email: string): Promise<void> {
    try {
      await this.redis.del(loginFailuresKey(this.prefix, email));
    } catch (error) {
      this.warn('clear', error);
    }
  }

  private warn(action: string, error: unknown): void {
    this.logger.warn(
      `Could not ${action} failed sign-ins in Redis: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
