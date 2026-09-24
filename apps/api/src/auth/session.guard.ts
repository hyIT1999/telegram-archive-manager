import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiErrorCode } from '@tam/shared';
import type { Response } from 'express';
import type { AuthenticatedRequest } from './auth.types.js';
import { IS_PUBLIC_ROUTE } from './public.decorator.js';
import { SessionCookie } from './session-cookie.js';
import { SessionService } from './session.service.js';

/**
 * Global guard (APP_GUARD): every route needs a live session cookie unless it is marked
 * with @Public(). Attaches the user to the request and slides the session expiry.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly cookie: SessionCookie,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const response = http.getResponse<Response>();
    const token = this.cookie.read(request);
    if (!token) {
      throw unauthenticated();
    }
    const now = new Date();
    const session = await this.sessions.resolve(token, now);
    if (!session) {
      // Drop the stale cookie so the browser stops sending it.
      this.cookie.clear(response);
      throw unauthenticated();
    }

    request.user = session.user;
    request.sessionId = session.id;
    if (session.refreshed) {
      this.cookie.set(response, token, session.expiresAt, now);
    }
    return true;
  }
}

function unauthenticated(): UnauthorizedException {
  return new UnauthorizedException({
    message: 'Authentication required',
    code: ApiErrorCode.UNAUTHENTICATED,
  });
}
