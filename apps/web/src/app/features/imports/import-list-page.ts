import { DatePipe, formatNumber } from '@angular/common';
import { Component, DestroyRef, LOCALE_ID, computed, effect, inject, signal } from '@angular/core';
import { rxResource, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatProgressBar } from '@angular/material/progress-bar';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { EmptyState } from '../../shared/components/empty-state/empty-state';
import { ErrorState } from '../../shared/components/error-state/error-state';
import { PageHeader } from '../../shared/components/page-header/page-header';
import { Skeleton } from '../../shared/components/skeleton/skeleton';
import { type ImportJobDto, toApiError } from '../../shared/models';
import { IMPORT_POLLING } from './import-job-watch';
import { JOB_STATUS_ICONS, JOB_STATUS_LABELS, isMoving, progressPercent } from './import-labels';
import { ImportsApi } from './imports-api';

export const IMPORT_PAGE_SIZE = 20;

@Component({
  selector: 'app-import-list-page',
  imports: [
    DatePipe,
    EmptyState,
    ErrorState,
    MatButton,
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

  /** The newest jobs; re-read while one of them is queued or running. */
  private readonly firstPage = rxResource({
    stream: () => this.api.list({ limit: IMPORT_PAGE_SIZE }),
  });
  private readonly firstItems = computed(() =>
    this.firstPage.hasValue() ? this.firstPage.value().items : undefined,
  );
  /** Older jobs added by "Load more" (not re-read; finished jobs no longer change). */
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

  protected readonly statusLabels = JOB_STATUS_LABELS;
  protected readonly statusIcons = JOB_STATUS_ICONS;

  constructor() {
    effect((onCleanup) => {
      const first = this.firstItems();
      if (!first?.some(isMoving) || this.firstPage.isLoading()) {
        return;
      }
      const timer = setTimeout(() => {
        if (this.firstItems()?.some(isMoving)) {
          this.firstPage.reload();
        }
      }, this.polling.listMs);
      onCleanup(() => clearTimeout(timer));
    });
  }

  protected retry(): void {
    this.firstPage.reload();
  }

  protected loadMore(): void {
    const cursor = this.nextCursor();
    if (!cursor || this.loadingMore()) {
      return;
    }
    this.loadingMore.set(true);
    this.loadMoreError.set(null);
    this.api
      .list({ limit: IMPORT_PAGE_SIZE, cursor })
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

  protected percent(job: ImportJobDto): number | null {
    return progressPercent(job);
  }

  protected isMoving(job: ImportJobDto): boolean {
    return isMoving(job);
  }

  protected summary(job: ImportJobDto): string {
    const read = formatNumber(job.processedMessages, this.locale, '1.0-0');
    if (job.status === 'COMPLETED') {
      return `${read} ${job.processedMessages === 1 ? 'message' : 'messages'}`;
    }
    if (job.totalMessages !== null) {
      return `${read} of about ${formatNumber(job.totalMessages, this.locale, '1.0-0')} messages`;
    }
    return `${read} messages read`;
  }
}
