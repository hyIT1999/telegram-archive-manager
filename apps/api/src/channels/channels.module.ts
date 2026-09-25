import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module.js';
import { TelegramModule } from '../telegram/telegram.module.js';
import { ChannelDownloadsService } from './channel-downloads.service.js';
import { ChannelTopicsService } from './channel-topics.service.js';
import { ChannelsController } from './channels.controller.js';
import { ChannelsService } from './channels.service.js';

@Module({
  // Topic names are read from Telegram by the worker, over the Telegram RPC.
  imports: [StorageModule, TelegramModule],
  controllers: [ChannelsController],
  providers: [ChannelsService, ChannelDownloadsService, ChannelTopicsService],
})
export class ChannelsModule {}
