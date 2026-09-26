import { DatePipe, formatNumber } from '@angular/common';
import { Component, DestroyRef, LOCALE_ID, computed, inject, signal } from '@angular/core';
import { rxResource, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButton } from '@angular/material/button';
import { MatButtonToggle, MatButtonToggleGroup } from '@angular/material/button-toggle';
import { MatIcon } from '@angular/material/icon';
import { MatProgressBar } from '@angular/material/progress-bar';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { LiveEvents } from '../../core/live/live-events';
import { liveRefresh } from '../../core/live/live-refresh';
import { EmptyState } from '../../shared/components/empty-state/empty-state';
import { ErrorState } from '../../shared/components/error-state/error-state';
import { PageHeader } from '../../shared/components/page-header/page-header';
import { Skeleton } from '../../shared/components/skeleton/skeleton';
import { type ImportJobDto, type ImportJobType, toApiError } from '../../shared/models';
import { IMPORT_POLLING } from './import-job-watch';
import {
  JOB_ORIGIN_LABELS,
  JOB_STATUS_ICONS,
  isMoving,
  isSync,
  progressPercent,
  statusLabel,
} from './import-labels';
import { ImportsApi } from './imports-api';

export const IMPORT_PAGE_SIZE = 20;

/** Which jobs the list shows. */
export type JobKindFilter = ImportJobType | 'ALL';

export const JOB_KIND_FILTERS: readonly { value: JobKindFilter; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'IMPORT', label: 'Imports' },
  { value: 'SYNC', label: 'Syncs' },
];

@Component({
  selector: 'app-import-list-page',
  imports: [
    DatePipe,
    EmptyState,
    ErrorState,
    MatButton,
    MatButtonToggle,
    MatButtonToggleGroup,
    MatIcon,
    MatProgressBar,
    MatProgressSpinner,
    PageHeader,
    RouterLink,
    Skeleton,
  ],
  templateUrl: './import-list-page.html',
  styleUrl: './import-list-page.scss',
})
export class ImportListPage {
  private readonly api = inject(ImportsApi);
  private readonly polling = inject(IMPORT_POLLING);
  private readonly destroyRef = inject(DestroyRef);
  private readonly locale = inject(LOCALE_ID);

  protected readonly kinds = JOB_KIND_FILTERS;
  protected readonly kind = signal<JobKindFilter>('ALL');

  /** The newest jobs; kept current by live updates (re-read while they cannot arrive). */
  private readonly firstPage = rxResource({
    params: () => ({ kind: this.kind() }),
    stream: ({ params }) =>
      this.api.list({
        limit: IMPORT_PAGE_SIZE,
        ...(params.kind === 'ALL' ? {} : { type: params.kind }),
      }),
  });
  private readonly firstItems = computed(() =>
    this.firstPage.hasValue() ? this.firstPage.value().items : undefined,
  );
  /** Older jobs added by "Load more". */
  private readonly moreItems = signal<readonly ImportJobDto[]>([]);
  /** The cursor after the loaded jobs; undefined while only the first page is loaded. */
  private readonly moreCursor = signal<string | null | undefined>(undefined);

  protected readonly jobs = computed<readonly ImportJobDto[]>(() => {
    const first = this.firstItems() ?? [];
    const shown = new Set(first.map((job) => job.id));
    return [...first, ...this.moreItems().filter((job) => !shown.has(job.id))];
  });
  protected readonly nextCursor = computed(() => {
    const more = this.moreCursor();
    return more !== undefined
      ? more
      : this.firstPage.hasValue()
        ? this.firstPage.value().nextCursor
        : null;
  });
  protected readonly loaded = computed(() => this.firstItems() !== undefined);
  protected readonly hasError = computed(
    () => this.firstPage.error() !== undefined && !this.loaded(),
  );
  protected readonly errorMessage = computed(() => toApiError(this.firstPage.error()).message);
  protected readonly loadingMore = signal(false);
  protected readonly loadMoreError = signal<string | null>(null);

  protected readonly statusIcons = JOB_STATUS_ICONS;
  protected readonly originLabels = JOB_ORIGIN_LABELS;

  constructor() {
    inject(LiveEvents)
      .on('import.job')
      .pipe(takeUntilDestroyed())
      .subscribe(({ job }) => this.patch(job));
    liveRefresh({
      reload: () => this.firstPage.reload(),
      loading: () => this.firstPage.isLoading(),
      active: () => this.firstItems()?.some(isMoving) ?? false,
      poll: (live) => (live ? null : this.polling.listMs),
    });
  }

  protected showKind(kind: JobKindFilter): void {
    if (kind === this.kind()) {
      return;
    }
    this.kind.set(kind);
    this.moreItems.set([]);
    this.moreCursor.set(undefined);
    this.loadMoreError.set(null);
  }

  protected retry(): void {
    this.firstPage.reload();
  }

  protected loadMore(): void {
    const cursor = this.nextCursor();
    if (!cursor || this.loadingMore()) {
      return;
    }
    const kind = this.kind();
    this.loadingMore.set(true);
    this.loadMoreError.set(null);
    this.api
      .list({ limit: IMPORT_PAGE_SIZE, cursor, ...(kind === 'ALL' ? {} : { type: kind }) })
      .pipe(
        finalize(() => this.loadingMore.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (page) => {
          this.moreItems.update((items) => [...items, ...page.items]);
          this.moreCursor.set(page.nextCursor);
        },
        error: (error: unknown) => this.loadMoreError.set(toApiError(error).message),
      });
  }

  protected statusLabel(job: ImportJobDto): string {
    return statusLabel(job);
  }

  protected percent(job: ImportJobDto): number | null {
    return progressPercent(job);
  }

  protected isMoving(job: ImportJobDto): boolean {
    return isMoving(job);
  }

  protected isSync(job: ImportJobDto): boolean {
    return isSync(job);
  }

  protected summary(job: ImportJobDto): string {
    const read = formatNumber(job.processedMessages, this.locale, '1.0-0');
    if (job.status === 'COMPLETED') {
      if (isSync(job)) {
        return job.processedMessages === 0
          ? 'No new messages'
          : `${read} new ${job.processedMessages === 1 ? 'message' : 'messages'}`;
      }
      return `${read} ${job.processedMessages === 1 ? 'message' : 'messages'}`;
    }
    if (job.totalMessages !== null) {
      return `${read} of about ${formatNumber(job.totalMessages, this.locale, '1.0-0')} messages`;
    }
    return `${read} messages read`;
  }

  /** A job changed: its row shows it; a new job of the kind shown goes on top. */
  private patch(job: ImportJobDto): void {
    const kind = this.kind();
    if (kind !== 'ALL' && job.type !== kind) {
      return;
    }
    if (this.moreItems().some((item) => item.id === job.id)) {
      this.moreItems.update((items) => items.map((item) => (item.id === job.id ? job : item)));
      return;
    }
    if (!this.firstPage.hasValue()) {
      return;
    }
    const page = this.firstPage.value();
    if (page.items.some((item) => item.id === job.id)) {
      this.firstPage.set({
        ...page,
        items: page.items.map((item) => (item.id === job.id ? job : item)),
      });
      return;
    }
    const newest = page.items[0];
    if (!newest || job.createdAt >= newest.createdAt) {
      this.firstPage.set({ ...page, items: [job, ...page.items] });
    }
  }
}
