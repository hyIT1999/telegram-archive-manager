import { describe, expect, it } from 'vitest';
import {
  generateSessionToken,
  hashSessionToken,
  initialSessionExpiry,
  isSessionExpired,
  isWellFormedSessionToken,
  SESSION_TOUCH_INTERVAL_MS,
  sessionLifetime,
  slidingRefresh,
} from '../../src/auth/session-token.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const now = new Date('2026-01-10T12:00:00.000Z');
const at = (offsetMs: number) => new Date(now.getTime() + offsetMs);

describe('session tokens', () => {
  it('are 256-bit random values encoded as 43 base64url characters', () => {
    const token = generateSessionToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(generateSessionToken()).not.toBe(token);
  });

  it('accepts only well-formed tokens', () => {
    expect(isWellFormedSessionToken(generateSessionToken())).toBe(true);
    expect(isWellFormedSessionToken('')).toBe(false);
    expect(isWellFormedSessionToken('a'.repeat(42))).toBe(false);
    expect(isWellFormedSessionToken(`${'a'.repeat(42)}=`)).toBe(false);
  });

  it('are stored as their sha256 in lowercase hex', () => {
    expect(hashSessionToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    const token = generateSessionToken();
    expect(hashSessionToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
  });
});

describe('session expiry', () => {
  const lifetime = sessionLifetime(168, 30);

  it('converts the configured hours and days', () => {
    expect(lifetime).toEqual({ ttlMs: 168 * HOUR, absoluteTtlMs: 30 * DAY });
  });

  it('starts with the sliding lifetime and a hard absolute limit', () => {
    expect(initialSessionExpiry(now, lifetime)).toEqual({
      expiresAt: at(168 * HOUR),
      absoluteExpiresAt: at(30 * DAY),
    });
  });

  it('never lets the sliding expiry pass the absolute one', () => {
    const expiry = initialSessionExpiry(now, sessionLifetime(72, 1));
    expect(expiry.expiresAt).toEqual(at(DAY));
    expect(expiry.absoluteExpiresAt).toEqual(at(DAY));
  });

  it('expires at either limit', () => {
    const session = { expiresAt: at(HOUR), absoluteExpiresAt: at(2 * HOUR) };
    expect(isSessionExpired(session, at(HOUR - 1))).toBe(false);
    expect(isSessionExpired(session, at(HOUR))).toBe(true);
    expect(
      isSessionExpired({ expiresAt: at(3 * HOUR), absoluteExpiresAt: at(2 * HOUR) }, at(2 * HOUR)),
    ).toBe(true);
  });

  it('does not write again while lastSeenAt is recent', () => {
    const session = { lastSeenAt: now, expiresAt: at(HOUR), absoluteExpiresAt: at(DAY) };
    expect(slidingRefresh(session, at(4 * MINUTE), lifetime)).toBeNull();
    expect(slidingRefresh(session, at(SESSION_TOUCH_INTERVAL_MS), lifetime)).toBeNull();
  });

  it('slides to now + ttl once lastSeenAt is older than five minutes', () => {
    const session = { lastSeenAt: now, expiresAt: at(HOUR), absoluteExpiresAt: at(30 * DAY) };
    const later = at(6 * MINUTE);
    expect(slidingRefresh(session, later, lifetime)).toEqual({
      lastSeenAt: later,
      expiresAt: new Date(later.getTime() + 168 * HOUR),
    });
  });

  it('caps the slide at the absolute expiry', () => {
    const session = { lastSeenAt: now, expiresAt: at(HOUR), absoluteExpiresAt: at(2 * DAY) };
    expect(slidingRefresh(session, at(10 * MINUTE), lifetime)?.expiresAt).toEqual(at(2 * DAY));
  });
});
