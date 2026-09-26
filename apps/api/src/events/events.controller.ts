import { Controller, Inject, type MessageEvent, Req, Sse } from '@nestjs/common';
import type { LiveEvent } from '@tam/shared';
import {
  type Observable,
  catchError,
  concatMap,
  filter,
  from,
  interval,
  map,
  merge,
  of,
  take,
  takeWhile,
} from 'rxjs';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { SessionService } from '../auth/session.service.js';
import { LiveEvents } from './live-events.js';
import { LIVE_EVENTS_SETTINGS, type LiveEventsSettings } from './live-events-settings.js';

const SESSION_ENDED: LiveEvent = { type: 'session.ended' };
const PING: LiveEvent = { type: 'ping' };

@Controller('events')
export class EventsController {
  constructor(
    private readonly live: LiveEvents,
    private readonly sessions: SessionService,
    @Inject(LIVE_EVENTS_SETTINGS) private readonly settings: LiveEventsSettings,
  ) {}

  /**
   * Live updates over server-sent events (see LiveEvent): `ready` first, then the changes of
   * import jobs, channels and downloads as they are committed, and a `ping` now and then: it
   * keeps proxies from closing a quiet connection, and lets browsers notice one that died (they
   * never see SSE comments). When the session is revoked or expires, `session.ended` is the last
   * event. The stream never fails: problems become a `resync`.
   */
  @Sse()
  stream(@Req() request: AuthenticatedRequest): Observable<MessageEvent> {
    const sessionId = request.sessionId ?? '';
    const ready: MessageEvent = {
      data: { type: 'ready' } satisfies LiveEvent,
      retry: this.settings.retryMs,
    };
    const heartbeat = interval(this.settings.heartbeatMs).pipe(
      map((): MessageEvent => ({ data: PING })),
    );
    const sessionEnded = interval(this.settings.sessionCheckMs).pipe(
      // A database hiccup is no reason to end the stream: the next check decides.
      concatMap(() => from(this.sessions.isActive(sessionId)).pipe(catchError(() => of(true)))),
      filter((active) => !active),
      take(1),
      map((): MessageEvent => ({ data: SESSION_ENDED })),
    );
    const events = this.live.stream().pipe(map((event): MessageEvent => ({ data: event })));
    return merge(of(ready), heartbeat, events, sessionEnded).pipe(
      takeWhile((message) => message.data !== SESSION_ENDED, true),
    );
  }
}
