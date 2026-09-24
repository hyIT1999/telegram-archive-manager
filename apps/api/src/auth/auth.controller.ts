import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { loginRequestSchema, type AuthUserDto, type LoginRequest } from '@tam/shared';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service.js';
import { sessionClientInfo, toAuthUserDto, type SessionUser } from './auth.types.js';
import { CurrentUser } from './current-user.decorator.js';
import { Public } from './public.decorator.js';
import { SessionCookie } from './session-cookie.js';

/** Login attempts per client IP and minute (the global limit is much higher). */
export const LOGIN_THROTTLE = { limit: 5, ttl: 60_000 } as const;

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly cookie: SessionCookie,
  ) {}

  @Public()
  @Throttle({ default: LOGIN_THROTTLE })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body({ schema: loginRequestSchema }) credentials: LoginRequest,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthUserDto> {
    const { user, session } = await this.auth.login(credentials, sessionClientInfo(request));
    this.cookie.set(response, session.token, session.expiresAt, session.issuedAt);
    return user;
  }

  @Get('me')
  me(@CurrentUser() user: SessionUser): AuthUserDto {
    return toAuthUserDto(user);
  }

  /** Public and idempotent, so a stale cookie can always be cleared. */
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const token = this.cookie.read(request);
    if (token) {
      await this.auth.logout(token);
    }
    this.cookie.clear(response);
  }
}
