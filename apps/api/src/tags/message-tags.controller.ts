import { Body, Controller, Delete, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  type AddMessageTagRequest,
  type IdParam,
  type MessageTagParams,
  type MessageTagsDto,
  addMessageTagRequestSchema,
  idParamSchema,
  messageTagParamsSchema,
} from '@tam/shared';
import { TagsService } from './tags.service.js';

@Controller('messages/:id/tags')
export class MessageTagsController {
  constructor(private readonly tags: TagsService) {}

  /** Tags the message with `tagId`, or with `name` (a new name creates the tag). */
  @Post()
  @HttpCode(HttpStatus.OK)
  add(
    @Param({ schema: idParamSchema }) params: IdParam,
    @Body({ schema: addMessageTagRequestSchema }) request: AddMessageTagRequest,
  ): Promise<MessageTagsDto> {
    return this.tags.tagMessage(params.id, request);
  }

  @Delete(':tagId')
  remove(
    @Param({ schema: messageTagParamsSchema }) params: MessageTagParams,
  ): Promise<MessageTagsDto> {
    return this.tags.untagMessage(params.id, params.tagId);
  }
}
