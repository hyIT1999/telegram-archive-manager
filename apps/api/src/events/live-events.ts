import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '@tam/database/nest';
import type { LiveEvent } from '@tam/shared';
import { Observable, Subject, type Subscription } from 'rxjs';
import { IMPORT_JOB_INCLUDE } from '../imports/import-job.mapper.js';
import { ImportJobsService } from '../imports/import-jobs.service.js';
import { type ChangeSignal, LiveChanges } from './live-changes.js';
import { LIVE_EVENTS_SETTINGS, type LiveEventsSettings } from './live-events-settings.js';

interface Batch {
  jobs: Set<string>;
  channels: Set<string>;
  downloads: Set<string>;
  resync: boolean;
}

function emptyBatch(): Batch {
  return { jobs: new Set(), channels: new Set(), downloads: new Set(), resync: false };
}

/**
 * Turns database changes into the events of the live updates stream, once for every client of
 * this process. Changes are gathered for a short window: a job goes out whole (as the import-jobs
 * endpoints return it), channels and downloads as a hint to read again. Nothing is prepared
 * while nobody listens.
 */
@Injectable()
export class LiveEvents implements OnModuleDestroy {
  private readonly logger = new Logger(LiveEvents.name);
  private readonly events = new Subject<LiveEvent>();
  private readonly subscription: Subscription;
  private batch = emptyBatch();
  private timer: NodeJS.Timeout | undefined;
  /** Batches go out one after the other, so a slow one never overtakes a newer one. */
  private sending: Promise<void> = Promise.resolve();
  private listeners = 0;

  constructor(
    changes: LiveChanges,
    private readonly prisma: PrismaService,
    private readonly jobs: ImportJobsService,
    @Inject(LIVE_EVENTS_SETTINGS) private readonly settings: LiveEventsSettings,
  ) {
    this.subscription = changes.signals$.subscribe((signal) => this.collect(signal));
  }

  /** The events of all changes from now on, for one client. */
  stream(): Observable<LiveEvent> {
    return new Observable<LiveEvent>((subscriber) => {
      this.listeners += 1;
      const subscription = this.events.subscribe(subscriber);
      return () => {
        this.listeners -= 1;
        subscription.unsubscribe();
      };
    });
  }

  onModuleDestroy(): void {
    clearTimeout(this.timer);
    this.subscription.unsubscribe();
    this.events.complete();
  }

  private collect(signal: ChangeSignal): void {
    if (this.listeners === 0) {
      return;
    }
    if (signal.kind === 'resync') {
      this.batch.resync = true;
    } else {
      const { kind, id } = signal.change;
      const target =
        kind === 'job'
          ? this.batch.jobs
          : kind === 'channel'
            ? this.batch.channels
            : this.batch.downloads;
      target.add(id);
    }
    this.timer ??= setTimeout(() => this.flush(), this.settings.batchMs);
  }

  private flush(): void {
    this.timer = undefined;
    const batch = this.batch;
    this.batch = emptyBatch();
    this.sending = this.sending.then(async () => {
      try {
        for (const event of await this.toEvents(batch)) {
          this.events.next(event);
        }
      } catch (error) {
        this.logger.warn(
          `Could not prepare live updates: ${error instanceof Error ? error.message : String(error)}`,
        );
        this.events.next({ type: 'resync' });
      }
    });
  }

  private async toEvents(batch: Batch): Promise<LiveEvent[]> {
    if (batch.resync || batch.jobs.size > this.settings.maxJobsPerBatch) {
      return [{ type: 'resync' }];
    }
    const events: LiveEvent[] = [];
    if (batch.jobs.size > 0) {
      const rows = await this.prisma.importJob.findMany({
        where: { id: { in: [...batch.jobs] } },
        include: IMPORT_JOB_INCLUDE,
      });
      for (const job of await this.jobs.toDtos(rows)) {
        events.push({ type: 'import.job', job });
      }
    }
    for (const channelId of batch.channels) {
      events.push({ type: 'channel.changed', channelId });
    }
    for (const channelId of batch.downloads) {
      events.push({ type: 'downloads.changed', channelId });
    }
    return events;
  }
}
