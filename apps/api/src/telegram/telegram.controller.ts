import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  telegramAuthenticateRequestSchema,
  type TelegramAuthenticateRequest,
  type TelegramDialogListDto,
  type TelegramStatusDto,
} from '@tam/shared';
import { TelegramService } from './telegram.service.js';

/** Login steps per client IP and minute (codes and passwords must not be brute-forced). */
export const AUTHENTICATE_THROTTLE = { limit: 10, ttl: 60_000 } as const;

@Controller('telegram')
export class TelegramController {
  constructor(private readonly telegram: TelegramService) {}

  @Get('status')
  status(): Promise<TelegramStatusDto> {
    return this.telegram.status();
  }

  /** One login step: phone → code → (2FA password); `resend` asks for another code. */
  @Throttle({ default: AUTHENTICATE_THROTTLE })
  @Post('authenticate')
  @HttpCode(HttpStatus.OK)
  authenticate(
    @Body({ schema: telegramAuthenticateRequestSchema }) request: TelegramAuthenticateRequest,
  ): Promise<TelegramStatusDto> {
    return this.telegram.authenticate(request);
  }

  /** Logs out of Telegram, or cancels a pending login. */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(): Promise<TelegramStatusDto> {
    return this.telegram.logout();
  }

  /** The cached list of channels and groups the account can access. */
  @Get('chats')
  chats(): Promise<TelegramDialogListDto> {
    return this.telegram.dialogs();
  }

  /** Asks the worker to re-read the chat list from Telegram (runs in the background). */
  @Post('chats/refresh')
  @HttpCode(HttpStatus.ACCEPTED)
  refreshChats(): Promise<TelegramDialogListDto> {
    return this.telegram.refreshDialogs();
  }
}
