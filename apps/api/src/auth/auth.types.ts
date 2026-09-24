import type { AuthUserDto } from '@tam/shared';
import type { Request } from 'express';

/** The signed-in user, attached to the request by SessionGuard. */
export interface SessionUser {
  id: string;
  email: string;
  lastLoginAt: Date | null;
}

export interface AuthenticatedRequest extends Request {
  user?: SessionUser;
  sessionId?: string;
}

/** Client details stored with a session (shown later in a "sessions" list, used for audits). */
export interface SessionClientInfo {
  ip: string | null;
  userAgent: string | null;
}

const MAX_USER_AGENT_LENGTH = 512;

export function sessionClientInfo(request: Request): SessionClientInfo {
  return {
    ip: request.ip ?? null,
    userAgent: request.get('user-agent')?.slice(0, MAX_USER_AGENT_LENGTH) ?? null,
  };
}

export function toAuthUserDto(user: SessionUser): AuthUserDto {
  return {
    id: user.id,
    email: user.email,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  };
}
