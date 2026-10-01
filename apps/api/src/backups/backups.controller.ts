import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Res } from '@nestjs/common';
import {
  type ChannelBackupDto,
  type IdParam,
  type MessageBackupDto,
  type RequestBackupRequest,
  type RetryBackupsDto,
  idParamSchema,
  requestBackupRequestSchema,
} from '@tam/shared';
import type { Response } from 'express';
import { ChannelBackupService } from './channel-backup.service.js';

/** Telegram backups of channels and of single messages. */
@Controller()
export class BackupsController {
  constructor(private readonly backups: ChannelBackupService) {}

  /** Where the channel's backup stands: counts, bytes, running and failed messages, Verify. */
  @Get('channels/:id/backup')
  summary(@Param({ schema: idParamSchema }) params: IdParam): Promise<ChannelBackupDto> {
    return this.backups.summary(params.id);
  }

  /** Every failed message of the channel goes back in line. */
  @Post('channels/:id/backup/retry')
  @HttpCode(HttpStatus.OK)
  retry(@Param({ schema: idParamSchema }) params: IdParam): Promise<RetryBackupsDto> {
    return this.backups.retryFailed(params.id);
  }

  /** Starts checking every copy of the channel in the backup chat; results arrive live. */
  @Post('channels/:id/backup/verify')
  @HttpCode(HttpStatus.ACCEPTED)
  verify(@Param({ schema: idParamSchema }) params: IdParam): Promise<ChannelBackupDto> {
    return this.backups.verify(params.id);
  }

  /** The copies of one message in backup chats (to follow its backup without reading it all). */
  @Get('messages/:id/backups')
  messageBackups(@Param({ schema: idParamSchema }) params: IdParam): Promise<MessageBackupDto[]> {
    return this.backups.messageBackups(params.id);
  }

  /**
   * Back up this message (and the rest of its album) now: 202 when queued, 200 when there was
   * nothing to do. `force` sends a new copy although one exists ("Back up again").
   */
  @Post('messages/:id/backup')
  async request(
    @Param({ schema: idParamSchema }) params: IdParam,
    @Body({ schema: requestBackupRequestSchema }) request: RequestBackupRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<MessageBackupDto> {
    const { backup, queued } = await this.backups.requestMessage(params.id, request);
    response.status(queued ? HttpStatus.ACCEPTED : HttpStatus.OK);
    return backup;
  }
}
