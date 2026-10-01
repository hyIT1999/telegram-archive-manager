import type { ImportJobDto } from './imports.js';

/** The live updates stream (server-sent events, GET). */
export const LIVE_EVENTS_PATH = '/api/events';

/**
 * What the live updates stream sends, one event per SSE message (JSON data). The api relays the
 * change notifications of PostgreSQL, so everything announced is committed.
 * - `ready`: the stream is open (always the first event);
 * - `ping`: sent every half minute, so a client notices a stream that went silent (a proxy may
 *   keep a dead connection open) and reconnects;
 * - `resync`: changes may have been missed (the api lost its database listener, or too much
 *   changed at once), so pages read again what they show;
 * - `session.ended`: the session was revoked or expired; the stream ends;
 * - `import.job`: an import or sync job as `GET /api/import-jobs/:id` returns it, after any
 *   change (progress, status, its downloads);
 * - `channel.changed`: a channel changed (settings, sync, the archived range);
 * - `downloads.changed`: downloads of a channel (or of its old basic group) changed;
 * - `backups.changed`: Telegram backups of a channel (or of its old basic group) changed.
 */
export type LiveEvent =
  | { type: 'ready' }
  | { type: 'ping' }
  | { type: 'resync' }
  | { type: 'session.ended' }
  | { type: 'import.job'; job: ImportJobDto }
  | { type: 'channel.changed'; channelId: string }
  | { type: 'downloads.changed'; channelId: string }
  | { type: 'backups.changed'; channelId: string };

export type LiveEventType = LiveEvent['type'];

export type LiveEventOf<T extends LiveEventType> = Extract<LiveEvent, { type: T }>;
