import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  channelListQuerySchema,
  idParamSchema,
  type ChannelDto,
  type ChannelListQuery,
  type IdParam,
  type Page,
} from '@tam/shared';
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

  @Get(':id')
  get(@Param({ schema: idParamSchema }) params: IdParam): Promise<ChannelDto> {
    return this.channels.get(params.id);
  }
}
