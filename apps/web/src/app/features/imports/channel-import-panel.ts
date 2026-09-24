import {
  Component,
  DestroyRef,
  computed,
  effect,
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
import { finalize } from 'rxjs';
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
 * The import section of a channel page: its latest import job, and a way to import (again) —
 * new messages and whatever older history is still missing.
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
  private readonly latest = rxResource({
    params: () => (this.importable() ? { channelId: this.channel().id } : undefined),
    stream: ({ params }) => this.api.list({ channelId: params.channelId, limit: 1 }),
  });
  /** The channel's latest job; null when it was never imported, undefined while loading. */
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
    effect((onCleanup) => {
      const job = this.job();
      if (!job || !isMoving(job) || this.latest.isLoading()) {
        return;
      }
      const timer = setTimeout(() => {
        const current = this.job();
        if (current && isMoving(current)) {
          this.latest.reload();
        }
      }, this.polling.jobMs);
      onCleanup(() => clearTimeout(timer));
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
}
