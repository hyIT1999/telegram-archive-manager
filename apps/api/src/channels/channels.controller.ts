import { Body, Controller, Get, HttpStatus, Param, Post, Query, Res } from '@nestjs/common';
import {
  channelListQuerySchema,
  createChannelRequestSchema,
  idParamSchema,
  type ChannelDto,
  type ChannelListQuery,
  type CreateChannelRequest,
  type IdParam,
  type Page,
} from '@tam/shared';
import type { Response } from 'express';
import { ChannelsService } from './channels.service.js';

@Controller('channels')
export class ChannelsController {
  constructor(private readonly channels: ChannelsService) {}

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
}
