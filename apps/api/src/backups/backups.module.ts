import { Module } from '@nestjs/common';
import { TelegramModule } from '../telegram/telegram.module.js';
import { BackupsController } from './backups.controller.js';
import { ChannelBackupService } from './channel-backup.service.js';

@Module({
  // Verify runs in the worker, which is asked over the Telegram RPC.
  imports: [TelegramModule],
  controllers: [BackupsController],
  providers: [ChannelBackupService],
})
export class BackupsModule {}
