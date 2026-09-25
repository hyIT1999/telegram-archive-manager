import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  channelListQuerySchema,
  createChannelRequestSchema,
  idParamSchema,
  updateChannelRequestSchema,
  type ChannelDownloadsDto,
  type ChannelDto,
  type ChannelListQuery,
  type CreateChannelRequest,
  type IdParam,
  type Page,
  type RetryDownloadsDto,
  type UpdateChannelRequest,
} from '@tam/shared';
import type { Response } from 'express';
import { ChannelDownloadsService } from './channel-downloads.service.js';
import { ChannelsService } from './channels.service.js';

@Controller('channels')
export class ChannelsController {
  constructor(
    private readonly channels: ChannelsService,
    private readonly downloads: ChannelDownloadsService,
  ) {}

  /** Newest first; `nextCursor` continues the listing, `q` filters title/username. */
  @Get()
  list(
    @Query({ schema: channelListQuerySchema }) query: ChannelListQuery,
  ): Promise<Page<ChannelDto>> {
    return this.channels.list(query);
  }

  /** Adds a chat from the Telegram chat list: 201 when created, 200 when it already existed. */
  @Post()
  async create(
    @Body({ schema: createChannelRequestSchema }) request: CreateChannelRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ChannelDto> {
    const { channel, created } = await this.channels.createFromDialog(request.telegramChatId);
    response.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return channel;
  }

  @Get(':id')
  get(@Param({ schema: idParamSchema }) params: IdParam): Promise<ChannelDto> {
    return this.channels.get(params.id);
  }

  /** Chooses the storage location of the channel's media and switches automatic downloads. */
  @Patch(':id')
  update(
    @Param({ schema: idParamSchema }) params: IdParam,
    @Body({ schema: updateChannelRequestSchema }) request: UpdateChannelRequest,
  ): Promise<ChannelDto> {
    return this.channels.update(params.id, request);
  }

  /** Files per download status, what downloads right now, and whether the location has room. */
  @Get(':id/downloads')
  downloadSummary(@Param({ schema: idParamSchema }) params: IdParam): Promise<ChannelDownloadsDto> {
    return this.downloads.summary(params.id);
  }

  /** Puts every failed file of the channel back in line. */
  @Post(':id/downloads/retry')
  @HttpCode(HttpStatus.OK)
  retryDownloads(@Param({ schema: idParamSchema }) params: IdParam): Promise<RetryDownloadsDto> {
    return this.downloads.retryFailed(params.id);
  }
}
