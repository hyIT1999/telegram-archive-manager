import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Change, type ChangeListener, listenForChanges } from '@tam/database';
import { type Observable, Subject } from 'rxjs';
import type { Env } from '../config/env.js';

/** A committed change, or word that changes may have been missed (the listener reconnected). */
export type ChangeSignal = { kind: 'change'; change: Change } | { kind: 'resync' };

/**
 * The change notifications of PostgreSQL (see the migration phase7_live_sync), on a connection of
 * this process's own. It never blocks startup: without the database it keeps trying, and a
 * listener that comes back announces a resync, since changes made meanwhile were not heard.
 */
@Injectable()
export class LiveChanges implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(LiveChanges.name);
  private readonly signals = new Subject<ChangeSignal>();
  private listener: ChangeListener | undefined;
  private failing = false;

  constructor(private readonly config: ConfigService<Env, true>) {}

  get signals$(): Observable<ChangeSignal> {
    return this.signals.asObservable();
  }

  onApplicationBootstrap(): void {
    this.listener = listenForChanges({
      connectionString: this.config.get('DATABASE_URL', { infer: true }),
      applicationName: 'tam-api-live',
      onChange: (change) => this.signals.next({ kind: 'change', change }),
      onListening: (resumed) => {
        this.failing = false;
        if (resumed) {
          this.logger.log('Listening for database changes again');
          this.signals.next({ kind: 'resync' });
        }
      },
      onError: (error) => {
        if (!this.failing) {
          this.logger.warn(`Lost the database change notifications (${error.message}); retrying`);
        }
        this.failing = true;
      },
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.listener?.close();
    this.signals.complete();
  }
}
