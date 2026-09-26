import pg from 'pg';

/** The notification channel of the change triggers (migration phase7_live_sync). */
export const CHANGE_CHANNEL = 'tam_changes';

export type ChangeKind = 'job' | 'channel' | 'downloads';

/** One committed change: an import job, a channel, or the downloads of a channel. */
export interface Change {
  kind: ChangeKind;
  /** The import job or channel id. */
  id: string;
}

const PAYLOAD =
  /^(job|channel|downloads):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** Reads a trigger payload ("job:<uuid>"…); null for anything else. */
export function parseChange(payload: string | undefined): Change | null {
  const match = PAYLOAD.exec(payload ?? '');
  if (!match) {
    return null;
  }
  return { kind: match[1] as ChangeKind, id: match[2] as string };
}

export interface ChangeListenerOptions {
  connectionString: string;
  /** Shown in pg_stat_activity. */
  applicationName?: string;
  onChange: (change: Change) => void;
  /**
   * Called each time LISTEN is active: `resumed` is true after a lost connection came back, when
   * changes made meanwhile were missed.
   */
  onListening?: (resumed: boolean) => void;
  /** A lost or refused connection; the listener tries again by itself. */
  onError?: (error: Error) => void;
  /** First pause before connecting again, doubled up to `maxRetryMs`. */
  minRetryMs?: number;
  maxRetryMs?: number;
}

export interface ChangeListener {
  /** Stops listening for good. */
  close(): Promise<void>;
}

/**
 * Listens for the change triggers on a connection of its own (a pooled connection cannot hold
 * LISTEN), reconnecting with backoff whenever the connection is lost.
 */
export function listenForChanges(options: ChangeListenerOptions): ChangeListener {
  const minRetryMs = options.minRetryMs ?? 1_000;
  const maxRetryMs = options.maxRetryMs ?? 30_000;
  let client: pg.Client | undefined;
  let timer: NodeJS.Timeout | undefined;
  let retryMs = minRetryMs;
  let listenedBefore = false;
  let closed = false;

  const retry = (failed: pg.Client) => {
    if (closed || client !== failed) {
      return;
    }
    client = undefined;
    failed.end().catch(() => undefined);
    timer = setTimeout(connect, retryMs);
    timer.unref();
    retryMs = Math.min(retryMs * 2, maxRetryMs);
  };

  const connect = () => {
    timer = undefined;
    if (closed) {
      return;
    }
    const current = new pg.Client({
      connectionString: options.connectionString,
      application_name: options.applicationName,
      connectionTimeoutMillis: 5_000,
      keepAlive: true,
    });
    client = current;
    current.on('notification', (message) => {
      if (message.channel !== CHANGE_CHANNEL) {
        return;
      }
      const change = parseChange(message.payload);
      if (change) {
        options.onChange(change);
      }
    });
    current.on('error', (error: Error) => {
      options.onError?.(error);
      retry(current);
    });
    current.on('end', () => retry(current));
    current
      .connect()
      .then(() => current.query(`LISTEN ${CHANGE_CHANNEL}`))
      .then(() => {
        if (closed || client !== current) {
          return;
        }
        retryMs = minRetryMs;
        options.onListening?.(listenedBefore);
        listenedBefore = true;
      })
      .catch((error: unknown) => {
        options.onError?.(error instanceof Error ? error : new Error(String(error)));
        retry(current);
      });
  };

  connect();
  return {
    async close() {
      closed = true;
      clearTimeout(timer);
      const current = client;
      client = undefined;
      await current?.end().catch(() => undefined);
    },
  };
}
