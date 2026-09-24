import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import { readCookie } from '../common/http/cookies.js';
import type { Env } from '../config/env.js';
import { SESSION_COOKIE_NAME } from './session-token.js';

/** Reads, sets and clears the `tam_sid` session cookie with one set of attributes. */
@Injectable()
export class SessionCookie {
  private readonly attributes: CookieOptions;

  constructor(config: ConfigService<Env, true>) {
    this.attributes = {
      httpOnly: true,
      sameSite: 'strict',
      secure: config.get('COOKIE_SECURE', { infer: true }),
      // The cookie is only needed by the API, never by the SPA's static files.
      path: '/api',
    };
  }

  read(request: Request): string | undefined {
    return readCookie(request.headers.cookie, SESSION_COOKIE_NAME) || undefined;
  }

  /** Sets the cookie to live exactly as long as the session does. */
  set(response: Response, token: string, expiresAt: Date, now: Date = new Date()): void {
    response.cookie(SESSION_COOKIE_NAME, token, {
      ...this.attributes,
      maxAge: Math.max(0, expiresAt.getTime() - now.getTime()),
    });
  }

  clear(response: Response): void {
    response.clearCookie(SESSION_COOKIE_NAME, this.attributes);
  }
}
