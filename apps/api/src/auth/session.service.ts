import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@tam/database/nest';
import type { Env } from '../config/env.js';
import type { SessionClientInfo, SessionUser } from './auth.types.js';
import {
  generateSessionToken,
  hashSessionToken,
  initialSessionExpiry,
  isSessionExpired,
  isWellFormedSessionToken,
  sessionLifetime,
  slidingRefresh,
  type SessionLifetime,
} from './session-token.js';

export interface IssuedSession {
  /** Raw token for the cookie; only its sha256 is stored. */
  token: string;
  issuedAt: Date;
  expiresAt: Date;
}

export interface ActiveSession {
  id: string;
  user: SessionUser;
  expiresAt: Date;
  /** True when this request extended the sliding expiry (the cookie should be re-issued). */
  refreshed: boolean;
}

@Injectable()
export class SessionService {
  private readonly lifetime: SessionLifetime;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    this.lifetime = sessionLifetime(
      config.get('SESSION_TTL_HOURS', { infer: true }),
      config.get('SESSION_ABSOLUTE_TTL_DAYS', { infer: true }),
    );
  }

  /** Starts a session and prunes the user's expired ones. */
  async create(
    userId: string,
    client: SessionClientInfo,
    now: Date = new Date(),
  ): Promise<IssuedSession> {
    const token = generateSessionToken();
    const { expiresAt, absoluteExpiresAt } = initialSessionExpiry(now, this.lifetime);
    await this.prisma.$transaction([
      this.prisma.session.deleteMany({
        where: { userId, OR: [{ expiresAt: { lte: now } }, { absoluteExpiresAt: { lte: now } }] },
      }),
      this.prisma.session.create({
        data: {
          userId,
          tokenHash: hashSessionToken(token),
          expiresAt,
          absoluteExpiresAt,
          lastSeenAt: now,
          ip: client.ip,
          userAgent: client.userAgent,
        },
      }),
    ]);
    return { token, issuedAt: now, expiresAt };
  }

  /** Returns the live session for a cookie token (sliding its expiry when due), or null. */
  async resolve(token: string, now: Date = new Date()): Promise<ActiveSession | null> {
    if (!isWellFormedSessionToken(token)) {
      return null;
    }
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      include: { user: { select: { id: true, email: true, lastLoginAt: true } } },
    });
    if (!session) {
      return null;
    }
    if (isSessionExpired(session, now)) {
      await this.prisma.session.deleteMany({ where: { id: session.id } });
      return null;
    }

    const refresh = slidingRefresh(session, now, this.lifetime);
    if (!refresh) {
      return { id: session.id, user: session.user, expiresAt: session.expiresAt, refreshed: false };
    }
    const { count } = await this.prisma.session.updateMany({
      where: { id: session.id },
      data: refresh,
    });
    if (count === 0) {
      // Revoked (logout elsewhere) between the read and the write.
      return null;
    }
    return { id: session.id, user: session.user, expiresAt: refresh.expiresAt, refreshed: true };
  }

  /**
   * Whether a session still exists and has not expired. Only reads: a long-lived response (live
   * updates) cannot send a refreshed cookie, so it must not extend the session either.
   */
  async isActive(sessionId: string, now: Date = new Date()): Promise<boolean> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { expiresAt: true, absoluteExpiresAt: true },
    });
    return session !== null && !isSessionExpired(session, now);
  }

  async revoke(token: string): Promise<void> {
    if (!isWellFormedSessionToken(token)) {
      return;
    }
    await this.prisma.session.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
  }

  /** The user's sessions that have not expired, the most recently used first. */
  listForUser(userId: string, now: Date = new Date()): Promise<SessionRecord[]> {
    return this.prisma.session.findMany({
      where: { userId, expiresAt: { gt: now }, absoluteExpiresAt: { gt: now } },
      orderBy: [{ lastSeenAt: 'desc' }, { id: 'desc' }],
      select: SESSION_RECORD,
    });
  }

  /** Ends one of the user's sessions; false when the user has no such session. */
  async revokeById(userId: string, sessionId: string): Promise<boolean> {
    const { count } = await this.prisma.session.deleteMany({ where: { id: sessionId, userId } });
    return count > 0;
  }

  /** Ends every session of the user except `keepSessionId`; returns how many ended. */
  async revokeOthers(userId: string, keepSessionId: string): Promise<number> {
    const { count } = await this.prisma.session.deleteMany({
      where: { userId, id: { not: keepSessionId } },
    });
    return count;
  }
}

const SESSION_RECORD = {
  id: true,
  createdAt: true,
  lastSeenAt: true,
  expiresAt: true,
  ip: true,
  userAgent: true,
} as const;

/** What the sessions list shows about a session (never its token hash). */
export interface SessionRecord {
  id: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  ip: string | null;
  userAgent: string | null;
}
