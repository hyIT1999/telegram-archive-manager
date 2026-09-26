import { Module } from '@nestjs/common';
import { MessageTagsController } from './message-tags.controller.js';
import { TagsController } from './tags.controller.js';
import { TagsService } from './tags.service.js';

@Module({
  controllers: [TagsController, MessageTagsController],
  providers: [TagsService],
})
export class TagsModule {}
