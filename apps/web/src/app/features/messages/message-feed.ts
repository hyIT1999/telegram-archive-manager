import { DecimalPipe } from '@angular/common';
import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';
import { rxResource, takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatTooltip } from '@angular/material/tooltip';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { finalize, map, of } from 'rxjs';
import { EmptyState } from '../../shared/components/empty-state/empty-state';
import { ErrorState } from '../../shared/components/error-state/error-state';
import { Skeleton } from '../../shared/components/skeleton/skeleton';
import { InView } from '../../shared/directives/in-view';
import {
  type MessageCategory,
  type MessageSort,
  type MessageSummaryDto,
  toApiError,
} from '../../shared/models';
import { ImageViewer } from '../media/image-viewer/image-viewer';
import { viewerImages } from '../media/image-viewer/viewer-image';
import { MediaRow } from '../media/media-row';
import { MediaTile } from '../media/media-tile';
import { type FeedSnapshot, FeedStateCache } from './feed-cache';
import { FeedFiltersBar } from './feed-filters';
import { type FeedEntry, groupAlbums } from './feed-groups';
import {
  type FeedFilters,
  type FeedRequest,
  type FeedScope,
  clearedFilters,
  feedRequest,
  filterParams,
  isNarrowed,
  readFilters,
} from './feed-query';
import { MessageCard } from './message-card';
import { MessageChanges } from './message-changes';
import { MessagesApi } from './messages-api';

/** Messages per page; a gallery row holds 3–6 tiles. */
export const FEED_PAGE_SIZE = 30;

const NOUNS: Readonly<Record<MessageCategory | 'all', [string, string]>> = {
  all: ['message', 'messages'],
  text: ['text message', 'text messages'],
  videos: ['video', 'videos'],
  images: ['image', 'images'],
  documents: ['document', 'documents'],
  audio: ['audio file', 'audio files'],
};

/** One page for a feed request: a search, or a plain list. */
function fetchPage(api: MessagesApi, request: FeedRequest, limit: number, cursor?: string) {
  return request.kind === 'search'
    ? api.search({ ...request.params, limit, cursor })
    : api.list({ ...request.params, limit, cursor });
}

/**
 * A list of archived messages with its filters and search: galleries for videos and images, rows
 * for documents and audio, cards (albums grouped, except in search results) for everything else.
 * The filters live in the URL; the next page loads as the reader nears the end, Back shows the list
 * as it was left, and favorites and tags changed elsewhere show at once.
 */
@Component({
  selector: 'app-message-feed',
  imports: [
    DecimalPipe,
    EmptyState,
    ErrorState,
    FeedFiltersBar,
    InView,
    MatButton,
    MatIcon,
    MatIconButton,
    MatProgressSpinner,
    MatTooltip,
    MediaRow,
    MediaTile,
    MessageCard,
    RouterLink,
    Skeleton,
  ],
  templateUrl: './message-feed.html',
  styleUrl: './message-feed.scss',
})
export class MessageFeed {
  /** A channel the page is about (its old basic group comes with it). */
  readonly channelId = input<string | null>(null);
  /** A forum topic the page is about (with its channel). */
  readonly topicId = input<number | null>(null);
  /** A media section the page is about. */
  readonly category = input<MessageCategory | null>(null);
  /** A tag the page is about. */
  readonly tagId = input<string | null>(null);
  /** The page lists favorites only. */
  readonly favorite = input(false);
  /** The order without a search. */
  readonly defaultSort = input<MessageSort>('newest');
  /** Whether the page's channel is a forum, so its topics can be chosen. */
  readonly forum = input(false);
  /** Off where the page has its own search box (the search page). */
  readonly searchField = input(true);
  readonly pageSize = input(FEED_PAGE_SIZE);

  private readonly api = inject(MessagesApi);
  private readonly cache = inject(FeedStateCache);
  private readonly changes = inject(MessageChanges);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly viewer = inject(ImageViewer);
  private readonly destroyRef = inject(DestroyRef);
  /** Arrived with Back or Forward: the list may come back as it was left. */
  private restoring = untracked(() => this.router.currentNavigation()?.trigger === 'popstate');

  private readonly queryParams = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  protected readonly scope = computed<FeedScope>(() => ({
    channelId: this.channelId(),
    topicId: this.topicId(),
    category: this.category(),
    tagId: this.tagId(),
    favorite: this.favorite() || undefined,
    defaultSort: this.defaultSort(),
  }));
  protected readonly filters = computed<FeedFilters>(
    () => readFilters(this.queryParams(), this.scope()),
    { equal: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
  );
  private readonly request = computed(
    () => ({
      key: JSON.stringify(this.filters()),
      filters: this.filters(),
      limit: this.pageSize(),
    }),
    { equal: (a, b) => a.key === b.key && a.limit === b.limit },
  );

  protected readonly firstPage = rxResource({
    params: () => this.request(),
    stream: ({ params }) => {
      const cached = this.restoring ? this.cache.get(params.key) : null;
      this.restoring = false;
      return cached
        ? of(cached)
        : fetchPage(this.api, feedRequest(params.filters), params.limit).pipe(
            map((page): FeedSnapshot => ({
              items: page.items,
              nextCursor: page.nextCursor,
              total: page.total,
            })),
          );
    },
  });

  private readonly loaded = computed<FeedSnapshot | undefined>(() =>
    this.firstPage.hasValue() ? this.firstPage.value() : undefined,
  );
  /** The first page plus everything loaded after it; starts over with the first page. */
  protected readonly items = linkedSignal<FeedSnapshot | undefined, readonly MessageSummaryDto[]>({
    source: this.loaded,
    computation: (page) => page?.items ?? [],
  });
  protected readonly nextCursor = linkedSignal(() => this.loaded()?.nextCursor ?? null);
  protected readonly total = computed(() => this.loaded()?.total ?? null);
  protected readonly loadingMore = signal(false);
  protected readonly loadMoreError = signal<string | null>(null);

  protected readonly isLoaded = computed(() => this.loaded() !== undefined);
  protected readonly errorMessage = computed(() =>
    this.firstPage.error() ? toApiError(this.firstPage.error()).message : null,
  );
  protected readonly layout = computed<'grid' | 'rows' | 'cards'>(() => {
    const category = this.filters().category;
    if (category === 'videos' || category === 'images') {
      return 'grid';
    }
    return category === 'documents' || category === 'audio' ? 'rows' : 'cards';
  });
  protected readonly images = computed(() => this.filters().category === 'images');
  protected readonly searching = computed(() => this.filters().q !== '');
  /**
   * Albums are grouped while browsing. Search results, favorites and tagged messages were picked
   * one by one, so each keeps its own card (with the file name found, its heart and its tags).
   */
  protected readonly entries = computed<FeedEntry[]>(() => {
    const { q, favorite, tagIds } = this.filters();
    return q || favorite || tagIds.length > 0
      ? this.items().map((item) => ({ kind: 'single', key: item.id, item }))
      : groupAlbums(this.items());
  });
  protected readonly showChannel = computed(() => this.filters().channelId === null);
  /** A topic's own page needs no topic on every card. */
  protected readonly showTopic = computed(() => this.topicId() === null);
  protected readonly narrowed = computed(() => isNarrowed(this.filters(), this.scope()));
  protected readonly noun = computed(() => {
    const category = this.filters().category;
    const [one, many] =
      this.searching() && category === null ? ['result', 'results'] : NOUNS[category ?? 'all'];
    return this.total() === 1 ? one : many;
  });
  protected readonly emptyTitle = computed(() => {
    const { q, category } = this.filters();
    if (q) {
      return `No results for “${q}”`;
    }
    if (this.narrowed()) {
      return 'Nothing matches these filters';
    }
    if (this.favorite()) {
      return 'No favorites yet';
    }
    return this.tagId() ? 'No message carries this tag' : `No ${NOUNS[category ?? 'all'][1]} yet`;
  });
  protected readonly emptyMessage = computed(() => {
    if (this.searching()) {
      return 'Words match the start of words in file names, text and captions, with or without accents.';
    }
    if (this.narrowed()) {
      return '';
    }
    if (this.favorite()) {
      return 'Press ♥ on a message to keep it here.';
    }
    return this.tagId() ? 'Add the tag from the Tags panel of a message.' : '';
  });
  /** Only plain lists suggest importing: favorites, tags and searches do not come from imports. */
  protected readonly suggestImport = computed(
    () => !this.channelId() && !this.favorite() && !this.tagId() && !this.searching(),
  );

  constructor() {
    // Favorites and tags changed on this screen or another one.
    this.changes.updates.pipe(takeUntilDestroyed()).subscribe((update) => {
      this.items.update((items) => {
        const next = items.map((item) => update(item));
        return next.some((item, index) => item !== items[index]) ? next : items;
      });
    });
    // Whatever is on screen is what Back brings back.
    effect(() => {
      const page = this.loaded();
      if (!page) {
        return;
      }
      const snapshot: FeedSnapshot = {
        items: this.items(),
        nextCursor: this.nextCursor(),
        total: page.total,
      };
      this.cache.set(
        untracked(() => this.request().key),
        snapshot,
      );
    });
  }

  protected changeFilters(filters: FeedFilters): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: filterParams(filters, this.scope()),
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected clearFilters(): void {
    this.changeFilters(clearedFilters(this.filters(), this.scope()));
  }

  /** Loads the list again from the start (statuses may have changed). */
  protected refresh(): void {
    this.cache.delete(this.request().key);
    this.firstPage.reload();
  }

  protected loadMore(): void {
    const cursor = this.nextCursor();
    if (!cursor || this.loadingMore()) {
      return;
    }
    this.loadingMore.set(true);
    this.loadMoreError.set(null);
    const request = this.request();
    fetchPage(this.api, feedRequest(request.filters), request.limit, cursor)
      .pipe(
        finalize(() => this.loadingMore.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (page) => {
          // The filters changed in the meantime: this page belongs to another list.
          if (this.nextCursor() !== cursor || this.request().key !== request.key) {
            return;
          }
          this.items.update((items) => [...items, ...page.items]);
          this.nextCursor.set(page.nextCursor);
        },
        error: (error: unknown) => this.loadMoreError.set(toApiError(error).message),
      });
  }

  /** Opens an image in the viewer, with the other images of the list around it. */
  protected openImage(item: MessageSummaryDto): void {
    const images = viewerImages(this.items());
    const index = images.findIndex((image) => image.messageId === item.id);
    if (index >= 0) {
      this.viewer.open(images, index);
    }
  }
}
