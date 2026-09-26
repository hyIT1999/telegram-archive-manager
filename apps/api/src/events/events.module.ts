import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ImportsModule } from '../imports/imports.module.js';
import { EventsController } from './events.controller.js';
import { LiveChanges } from './live-changes.js';
import { LiveEvents } from './live-events.js';
import { DEFAULT_LIVE_EVENTS_SETTINGS, LIVE_EVENTS_SETTINGS } from './live-events-settings.js';

/** GET /api/events: live updates, relayed from PostgreSQL change notifications. */
@Module({
  imports: [AuthModule, ImportsModule],
  controllers: [EventsController],
  providers: [
    { provide: LIVE_EVENTS_SETTINGS, useValue: DEFAULT_LIVE_EVENTS_SETTINGS },
    LiveChanges,
    LiveEvents,
  ],
})
export class EventsModule {}
