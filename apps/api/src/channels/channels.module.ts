import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module.js';
import { ChannelDownloadsService } from './channel-downloads.service.js';
import { ChannelsController } from './channels.controller.js';
import { ChannelsService } from './channels.service.js';

@Module({
  imports: [StorageModule],
  controllers: [ChannelsController],
  providers: [ChannelsService, ChannelDownloadsService],
})
export class ChannelsModule {}
