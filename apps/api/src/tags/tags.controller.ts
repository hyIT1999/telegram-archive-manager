import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  type CreateTagRequest,
  type IdParam,
  type TagDto,
  type TagListDto,
  type UpdateTagRequest,
  createTagRequestSchema,
  idParamSchema,
  updateTagRequestSchema,
} from '@tam/shared';
import { TagsService } from './tags.service.js';

@Controller('tags')
export class TagsController {
  constructor(private readonly tags: TagsService) {}

  /** Every tag by name, with how many messages carry it. */
  @Get()
  list(): Promise<TagListDto> {
    return this.tags.list();
  }

  /** 409 TAG_NAME_TAKEN when the name is in use; 422 TAG_LIMIT_REACHED at MAX_TAGS tags. */
  @Post()
  create(@Body({ schema: createTagRequestSchema }) request: CreateTagRequest): Promise<TagDto> {
    return this.tags.create(request);
  }

  @Patch(':id')
  update(
    @Param({ schema: idParamSchema }) params: IdParam,
    @Body({ schema: updateTagRequestSchema }) request: UpdateTagRequest,
  ): Promise<TagDto> {
    return this.tags.update(params.id, request);
  }

  /** The tag is taken off every message that carried it. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param({ schema: idParamSchema }) params: IdParam): Promise<void> {
    return this.tags.remove(params.id);
  }
}
