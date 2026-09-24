import { Component, DestroyRef, computed, inject, linkedSignal, signal } from '@angular/core';
import { rxResource, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { EmptyState } from '../../shared/components/empty-state/empty-state';
import { ErrorState } from '../../shared/components/error-state/error-state';
import { PageHeader } from '../../shared/components/page-header/page-header';
import { Skeleton } from '../../shared/components/skeleton/skeleton';
import { type ChannelDto, type Page, toApiError } from '../../shared/models';
import { ChannelCard } from './channel-card';
import { ChannelsApi } from './channels-api';

export const CHANNEL_PAGE_SIZE = 24;

@Component({
  selector: 'app-channel-list-page',
  imports: [
    ChannelCard,
    EmptyState,
    ErrorState,
    MatButton,
    MatIcon,
    MatProgressSpinner,
    PageHeader,
    RouterLink,
    Skeleton,
  ],
  templateUrl: './channel-list-page.html',
  styleUrl: './channel-list-page.scss',
})
export class ChannelListPage {
  private readonly api = inject(ChannelsApi);
  private readonly destroyRef = inject(DestroyRef);

  private readonly firstPage = rxResource({
    stream: () => this.api.list({ limit: CHANNEL_PAGE_SIZE }),
  });

  private readonly loadedFirstPage = computed<Page<ChannelDto> | undefined>(() =>
    this.firstPage.hasValue() ? this.firstPage.value() : undefined,
  );

  /** The first page plus everything "Load more" appended; starts over when the first page reloads. */
  protected readonly channels = linkedSignal<Page<ChannelDto> | undefined, readonly ChannelDto[]>({
    source: this.loadedFirstPage,
    computation: (page) => page?.items ?? [],
  });
  protected readonly nextCursor = linkedSignal(() => this.loadedFirstPage()?.nextCursor ?? null);
  protected readonly loadingMore = signal(false);
  protected readonly loadMoreError = signal<string | null>(null);

  protected readonly loaded = computed(() => this.loadedFirstPage() !== undefined);
  protected readonly hasError = computed(() => this.firstPage.error() !== undefined);
  protected readonly errorMessage = computed(() => toApiError(this.firstPage.error()).message);

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
      .list({ limit: CHANNEL_PAGE_SIZE, cursor })
      .pipe(
        finalize(() => this.loadingMore.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (page) => {
          // A reload in the meantime restarted the list from a different first page.
          if (this.nextCursor() !== cursor) {
            return;
          }
          this.channels.update((channels) => [...channels, ...page.items]);
          this.nextCursor.set(page.nextCursor);
        },
        error: (error: unknown) => this.loadMoreError.set(toApiError(error).message),
      });
  }
}
