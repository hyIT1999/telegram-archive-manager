import { createHash, randomBytes } from 'node:crypto';

export const SESSION_COOKIE_NAME = 'tam_sid';

/** lastSeenAt/expiresAt are written at most this often, so most requests stay read-only. */
export const SESSION_TOUCH_INTERVAL_MS = 5 * 60_000;

const TOKEN_BYTES = 32;
/** 32 random bytes in base64url: 43 characters, no padding. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface SessionLifetime {
  /** Sliding lifetime, renewed while the session is used. */
  ttlMs: number;
  /** Hard maximum counted from the login. */
  absoluteTtlMs: number;
}

export interface SessionExpiry {
  expiresAt: Date;
  absoluteExpiresAt: Date;
}

export function sessionLifetime(ttlHours: number, absoluteTtlDays: number): SessionLifetime {
  return { ttlMs: ttlHours * 3_600_000, absoluteTtlMs: absoluteTtlDays * 86_400_000 };
}

/** Opaque 256-bit session token; only the cookie ever holds it. */
export function generateSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function isWellFormedSessionToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

/** What the sessions table stores instead of the token: sha256, lowercase hex. */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function earliest(a: Date, b: Date): Date {
  return a.getTime() <= b.getTime() ? a : b;
}

export function initialSessionExpiry(now: Date, lifetime: SessionLifetime): SessionExpiry {
  const absoluteExpiresAt = new Date(now.getTime() + lifetime.absoluteTtlMs);
  const expiresAt = earliest(new Date(now.getTime() + lifetime.ttlMs), absoluteExpiresAt);
  return { expiresAt, absoluteExpiresAt };
}

export function isSessionExpired(session: SessionExpiry, now: Date): boolean {
  const at = now.getTime();
  return session.expiresAt.getTime() <= at || session.absoluteExpiresAt.getTime() <= at;
}

/**
 * Sliding expiry: once lastSeenAt is older than SESSION_TOUCH_INTERVAL_MS, the session is
 * extended to now + ttl, never beyond its absolute expiry. Returns null when no write is due.
 */
export function slidingRefresh(
  session: SessionExpiry & { lastSeenAt: Date },
  now: Date,
  lifetime: SessionLifetime,
): { lastSeenAt: Date; expiresAt: Date } | null {
  if (now.getTime() - session.lastSeenAt.getTime() <= SESSION_TOUCH_INTERVAL_MS) {
    return null;
  }
  const expiresAt = earliest(new Date(now.getTime() + lifetime.ttlMs), session.absoluteExpiresAt);
  return { lastSeenAt: now, expiresAt };
}
