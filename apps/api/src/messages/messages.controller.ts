import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  type IdParam,
  type MessageDto,
  type MessageListQuery,
  type MessagePageDto,
  idParamSchema,
  messageListQuerySchema,
} from '@tam/shared';
import { MessagesService } from './messages.service.js';

@Controller('messages')
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  /**
   * Newest first by default; filters by channel (with its old basic group), forum topic, message
   * types, dates and downloaded files. `total` comes with the first page only.
   */
  @Get()
  list(
    @Query({ schema: messageListQuerySchema }) query: MessageListQuery,
  ): Promise<MessagePageDto> {
    return this.messages.list(query);
  }

  /** One message with its file, album, reply, topic and neighbours. */
  @Get(':id')
  get(@Param({ schema: idParamSchema }) params: IdParam): Promise<MessageDto> {
    return this.messages.get(params.id);
  }
}
