import { Module } from '@nestjs/common';
import { TelegramModule } from '../telegram/telegram.module.js';
import { NewMessagesListener } from './new-messages.listener.js';
import { SyncScheduler } from './sync-scheduler.js';
import { DEFAULT_SYNC_SCHEDULER_SETTINGS, SYNC_SCHEDULER_SETTINGS } from './sync-settings.js';

/** Starts syncs of the channels that sync: on Telegram's updates and on a schedule. */
@Module({
  imports: [TelegramModule],
  providers: [
    { provide: SYNC_SCHEDULER_SETTINGS, useValue: DEFAULT_SYNC_SCHEDULER_SETTINGS },
    NewMessagesListener,
    SyncScheduler,
  ],
})
export class SyncModule {}
