import { createHash } from 'node:crypto';

/** How many failed sign-ins lock an email, and for how long the count runs. */
export interface LoginLockoutSettings {
  maxFailures: number;
  windowMs: number;
}

export const DEFAULT_LOGIN_LOCKOUT: LoginLockoutSettings = {
  maxFailures: 10,
  windowMs: 15 * 60_000,
};

/**
 * Redis key counting an email's failed sign-ins. Hashed, so Redis never holds the address;
 * used by the api and by the reset-password CLI, which unlocks the account.
 */
export function loginFailuresKey(prefix: string, email: string): string {
  return `${prefix}:auth:login-failures:${createHash('sha256').update(email).digest('hex')}`;
}
