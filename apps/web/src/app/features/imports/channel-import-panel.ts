import {
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
} from '@angular/core';
import { rxResource, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { Router, RouterLink } from '@angular/router';
import { filter, finalize } from 'rxjs';
import { LiveEvents } from '../../core/live/live-events';
import { liveRefresh } from '../../core/live/live-refresh';
import { Notice } from '../../shared/components/notice/notice';
import { Skeleton } from '../../shared/components/skeleton/skeleton';
import { type ChannelDto, type ImportJobDto, detailString, toApiError } from '../../shared/models';
import { IMPORT_POLLING } from './import-job-watch';
import {
  type ImportChoice,
  importChoiceProblem,
  isMoving,
  isUnfinished,
  toImportRequest,
} from './import-labels';
import { DEFAULT_IMPORT_CHOICE, ImportModePicker } from './import-mode-picker';
import { ImportProgress } from './import-progress';
import { ImportsApi } from './imports-api';

/**
 * The import section of a channel page: its latest import job, followed live, and a way to
 * import (again) — new messages and whatever older history is still missing. Syncs have a panel
 * of their own.
 */
@Component({
  selector: 'app-channel-import-panel',
  imports: [
    ImportModePicker,
    ImportProgress,
    MatButton,
    MatIcon,
    MatProgressSpinner,
    Notice,
    RouterLink,
    Skeleton,
  ],
  templateUrl: './channel-import-panel.html',
  styleUrl: './channel-import-panel.scss',
})
export class ChannelImportPanel {
  readonly channel = input.required<ChannelDto>();

  private readonly api = inject(ImportsApi);
  private readonly router = inject(Router);
  private readonly polling = inject(IMPORT_POLLING);
  private readonly destroyRef = inject(DestroyRef);

  /** Protected chats and old groups of upgraded supergroups are never imported on their own. */
  protected readonly importable = computed(
    () => !this.channel().isProtected && this.channel().migratedToChannelId === null,
  );
  /** Changes only with the channel itself, not with a newer copy of it (e.g. after a switch). */
  private readonly channelId = computed(() => this.channel().id);
  private readonly latest = rxResource({
    params: () => (this.importable() ? this.channelId() : undefined),
    stream: ({ params }) => this.api.list({ channelId: params, type: 'IMPORT', limit: 1 }),
  });
  /** The channel's latest import; null when it was never imported, undefined while loading. */
  protected readonly job = computed<ImportJobDto | null | undefined>(() =>
    this.latest.hasValue() ? (this.latest.value().items[0] ?? null) : undefined,
  );
  protected readonly loadError = computed(() =>
    this.latest.error() ? toApiError(this.latest.error()).message : null,
  );
  protected readonly canStart = computed(() => {
    const job = this.job();
    return job === null || (job !== undefined && !isUnfinished(job));
  });

  protected readonly choice = linkedSignal<ChannelDto, ImportChoice>({
    source: this.channel,
    computation: () => DEFAULT_IMPORT_CHOICE,
  });
  protected readonly request = computed(() => {
    const choice = this.choice();
    return importChoiceProblem(choice) ? null : toImportRequest(choice);
  });
  protected readonly starting = signal(false);
  protected readonly startError = signal<string | null>(null);
  protected readonly blockingJobId = signal<string | null>(null);

  constructor() {
    inject(LiveEvents)
      .on('import.job')
      .pipe(
        filter(({ job }) => job.type === 'IMPORT' && job.channelId === this.channelId()),
        takeUntilDestroyed(),
      )
      .subscribe(({ job }) => this.show(job));
    liveRefresh({
      reload: () => this.latest.reload(),
      loading: () => this.latest.isLoading(),
      active: () => {
        const job = this.job();
        return !!job && isMoving(job);
      },
      poll: (live) => (live ? null : this.polling.jobMs),
    });
  }

  protected reload(): void {
    this.latest.reload();
  }

  protected start(): void {
    const request = this.request();
    if (!request || this.starting()) {
      return;
    }
    this.starting.set(true);
    this.startError.set(null);
    this.blockingJobId.set(null);
    this.api
      .start(this.channel().id, request)
      .pipe(
        finalize(() => this.starting.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ job }) => void this.router.navigate(['/imports', job.id]),
        error: (error: unknown) => {
          this.startError.set(toApiError(error).message);
          this.blockingJobId.set(detailString(error, 'jobId'));
        },
      });
  }

  /** The latest import changed, or a newer one started. */
  private show(job: ImportJobDto): void {
    const current = this.job();
    if (current === undefined || !this.latest.hasValue()) {
      return;
    }
    if (current === null || current.id === job.id || job.createdAt > current.createdAt) {
      this.latest.set({ ...this.latest.value(), items: [job] });
    }
  }
}
