import { Module } from '@nestjs/common';
import { TelegramModule } from '../telegram/telegram.module.js';
import { ForumTopicsRefresher } from './forum-topics-refresher.js';
import { DEFAULT_TOPICS_SETTINGS, TOPICS_SETTINGS } from './topics-settings.js';

/** Keeps the topic names of archived forums in step with Telegram. */
@Module({
  imports: [TelegramModule],
  providers: [
    { provide: TOPICS_SETTINGS, useValue: DEFAULT_TOPICS_SETTINGS },
    ForumTopicsRefresher,
  ],
})
export class TopicsModule {}
