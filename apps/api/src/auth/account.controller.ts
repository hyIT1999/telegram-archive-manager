import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiErrorCode,
  changePasswordRequestSchema,
  idParamSchema,
  type ChangePasswordRequest,
  type IdParam,
  type RevokeSessionsResultDto,
  type SessionDto,
} from '@tam/shared';
import type { Response } from 'express';
import { AccountService } from './account.service.js';
import { LOGIN_THROTTLE } from './auth.controller.js';
import type { SessionUser } from './auth.types.js';
import { CurrentSessionId } from './current-session.decorator.js';
import { CurrentUser } from './current-user.decorator.js';
import { SessionCookie } from './session-cookie.js';

/** The signed-in user's password and sessions (Settings → Your account). */
@Controller('auth')
export class AccountController {
  constructor(
    private readonly account: AccountService,
    private readonly cookie: SessionCookie,
  ) {}

  /** 204; every other session is signed out. Limited like sign-ins. */
  @Throttle({ default: LOGIN_THROTTLE })
  @Post('password')
  @HttpCode(HttpStatus.NO_CONTENT)
  changePassword(
    @Body({ schema: changePasswordRequestSchema }) body: ChangePasswordRequest,
    @CurrentUser() user: SessionUser,
    @CurrentSessionId() sessionId: string,
  ): Promise<void> {
    return this.account.changePassword(user, sessionId, body);
  }

  @Get('sessions')
  sessions(
    @CurrentUser() user: SessionUser,
    @CurrentSessionId() sessionId: string,
  ): Promise<SessionDto[]> {
    return this.account.listSessions(user, sessionId);
  }

  /** Signs out every session but this one. */
  @Post('sessions/revoke-others')
  @HttpCode(HttpStatus.OK)
  async revokeOthers(
    @CurrentUser() user: SessionUser,
    @CurrentSessionId() sessionId: string,
  ): Promise<RevokeSessionsResultDto> {
    return { revoked: await this.account.revokeOtherSessions(user, sessionId) };
  }

  /** Signs out one session (204); this browser's own session ends like a logout. */
  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @Param({ schema: idParamSchema }) params: IdParam,
    @CurrentUser() user: SessionUser,
    @CurrentSessionId() sessionId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    if (!(await this.account.revokeSession(user, params.id))) {
      throw new NotFoundException({
        message: 'No such session.',
        code: ApiErrorCode.NOT_FOUND,
      });
    }
    if (params.id === sessionId) {
      this.cookie.clear(response);
    }
  }
}
