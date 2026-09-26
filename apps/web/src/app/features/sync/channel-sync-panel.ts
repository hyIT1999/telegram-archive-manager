import { DatePipe, formatNumber } from '@angular/common';
import {
  Component,
  DestroyRef,
  LOCALE_ID,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { rxResource, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatProgressBar } from '@angular/material/progress-bar';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatSlideToggle, type MatSlideToggleChange } from '@angular/material/slide-toggle';
import { RouterLink } from '@angular/router';
import { filter, finalize } from 'rxjs';
import { LiveEvents } from '../../core/live/live-events';
import { liveRefresh } from '../../core/live/live-refresh';
import { Notice } from '../../shared/components/notice/notice';
import { type ChannelDto, type ImportJobDto, detailString, toApiError } from '../../shared/models';
import { timeAgo } from '../../shared/text/relative-time';
import { ChannelsApi } from '../channels/channels-api';
import { IMPORT_POLLING } from '../imports/import-job-watch';
import { JOB_STATUS_ICONS, isMoving, progressPercent, statusLabel } from '../imports/import-labels';
import { ImportsApi } from '../imports/imports-api';

/** "5 minutes ago" is refreshed this often. */
const CLOCK_MS = 30_000;

/**
 * The sync section of a channel page: the switch that keeps the channel up to date, when it was
 * last synced, why sync stopped by itself (if it did), the latest sync followed live, and "Sync
 * now".
 */
@Component({
  selector: 'app-channel-sync-panel',
  imports: [
    DatePipe,
    MatButton,
    MatIcon,
    MatProgressBar,
    MatProgressSpinner,
    MatSlideToggle,
    Notice,
    RouterLink,
  ],
  templateUrl: './channel-sync-panel.html',
  styleUrl: './channel-sync-panel.scss',
})
export class ChannelSyncPanel {
  readonly channel = input.required<ChannelDto>();
  /** The channel after the switch changed it. */
  readonly channelChange = output<ChannelDto>();

  private readonly imports = inject(ImportsApi);
  private readonly channels = inject(ChannelsApi);
  private readonly polling = inject(IMPORT_POLLING);
  private readonly destroyRef = inject(DestroyRef);
  private readonly locale = inject(LOCALE_ID);

  /** Protected chats never sync; an upgraded group gets no new messages. */
  protected readonly syncable = computed(
    () => !this.channel().isProtected && this.channel().migratedToChannelId === null,
  );
  protected readonly imported = computed(() => this.channel().headMessageId !== null);
  private readonly channelId = computed(() => this.channel().id);

  private readonly latest = rxResource({
    params: () => (this.syncable() ? this.channelId() : undefined),
    stream: ({ params }) => this.imports.list({ channelId: params, type: 'SYNC', limit: 1 }),
  });
  /** The channel's latest sync; null when it never synced, undefined while loading. */
  protected readonly job = computed<ImportJobDto | null | undefined>(() =>
    this.latest.hasValue() ? (this.latest.value().items[0] ?? null) : undefined,
  );
  protected readonly moving = computed(() => {
    const job = this.job();
    return !!job && isMoving(job);
  });

  private readonly now = signal(new Date());
  /** When the channel was last up to date: a sync that just completed counts before the channel is read again. */
  protected readonly lastSyncedAt = computed(() => {
    const job = this.job();
    const completed = job?.status === 'COMPLETED' ? job.completedAt : null;
    const stored = this.channel().lastSyncedAt;
    return completed && (!stored || completed > stored) ? completed : stored;
  });
  protected readonly lastSynced = computed(() => {
    const at = this.lastSyncedAt();
    return at ? timeAgo(at, this.now(), this.locale) : null;
  });

  protected readonly switching = signal(false);
  protected readonly syncing = signal(false);
  protected readonly actionError = signal<string | null>(null);
  protected readonly blockingJobId = signal<string | null>(null);
  protected readonly statusIcons = JOB_STATUS_ICONS;

  constructor() {
    inject(LiveEvents)
      .on('import.job')
      .pipe(
        filter(({ job }) => job.type === 'SYNC' && job.channelId === this.channelId()),
        takeUntilDestroyed(),
      )
      .subscribe(({ job }) => this.show(job));
    liveRefresh({
      reload: () => this.latest.reload(),
      loading: () => this.latest.isLoading(),
      active: () => this.moving(),
      poll: (live) => (live ? null : this.polling.jobMs),
    });
    const clock = setInterval(() => this.now.set(new Date()), CLOCK_MS);
    this.destroyRef.onDestroy(() => clearInterval(clock));
  }

  protected statusLabel(job: ImportJobDto): string {
    return statusLabel(job);
  }

  protected percent(job: ImportJobDto): number | null {
    return progressPercent(job);
  }

  /** What the latest sync did, or does now. */
  protected summary(job: ImportJobDto): string {
    const count = (value: number) => formatNumber(value, this.locale, '1.0-0');
    switch (job.status) {
      case 'COMPLETED': {
        const found =
          job.processedMessages === 0
            ? 'No new messages'
            : `${count(job.processedMessages)} new ${job.processedMessages === 1 ? 'message' : 'messages'}`;
        return job.completedAt
          ? `${found} · ${timeAgo(job.completedAt, this.now(), this.locale)}`
          : found;
      }
      case 'RUNNING':
        return job.totalMessages === null
          ? `${count(job.processedMessages)} read so far`
          : `${count(job.processedMessages)} of about ${count(job.totalMessages)} new messages`;
      case 'PENDING':
        return job.statusDetail ?? 'Waiting for the worker';
      case 'FAILED':
        return job.error ?? 'The sync stopped';
      default:
        return 'Cancelled';
    }
  }

  protected toggle(change: MatSlideToggleChange): void {
    this.switching.set(true);
    this.actionError.set(null);
    this.channels
      .update(this.channel().id, { syncEnabled: change.checked })
      .pipe(
        finalize(() => this.switching.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (channel) => this.channelChange.emit(channel),
        error: (error: unknown) => {
          this.actionError.set(toApiError(error).message);
          // Show the switch where it really is.
          change.source.checked = !change.checked;
        },
      });
  }

  protected syncNow(): void {
    if (this.syncing()) {
      return;
    }
    this.syncing.set(true);
    this.actionError.set(null);
    this.blockingJobId.set(null);
    this.imports
      .sync(this.channel().id)
      .pipe(
        finalize(() => this.syncing.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        // The sync the api created, or the one already on its way: the latest either way.
        next: ({ job }) => this.show(job, true),
        error: (error: unknown) => {
          this.actionError.set(toApiError(error).message);
          this.blockingJobId.set(detailString(error, 'jobId'));
        },
      });
  }

  /** The latest sync changed, or a newer one started. */
  private show(job: ImportJobDto, latest = false): void {
    const current = this.job();
    if (current === undefined || !this.latest.hasValue()) {
      return;
    }
    if (latest || current === null || current.id === job.id || job.createdAt > current.createdAt) {
      this.latest.set({ ...this.latest.value(), items: [job] });
    }
  }
}
