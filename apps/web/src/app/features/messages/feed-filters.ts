import {
  Component,
  InjectionToken,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  output,
} from '@angular/core';
import { rxResource, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatChipAvatar, MatChipListbox, MatChipOption } from '@angular/material/chips';
import {
  MatFormField,
  MatHint,
  MatLabel,
  MatPrefix,
  MatSuffix,
} from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatOption, MatSelect } from '@angular/material/select';
import { Subject, debounceTime, of } from 'rxjs';
import type { MessageCategory } from '../../shared/models';
import { ChannelsApi } from '../channels/channels-api';
import { TagStore } from '../tags/tag-store';
import { TopicsApi } from '../topics/topics-api';
import {
  type FeedFilters,
  type FeedScope,
  type FeedSort,
  MAX_FILTER_TAGS,
  MAX_QUERY_LENGTH,
  clearedFilters,
  defaultSort,
  isNarrowed,
} from './feed-query';
import { CATEGORY_OPTIONS } from './message-labels';

/** Channels offered in the channel filter (one page of the channel list). */
export const FILTER_CHANNEL_LIMIT = 100;

/** How long typing pauses before the list searches. */
export const SEARCH_DEBOUNCE_MS = new InjectionToken<number>('SEARCH_DEBOUNCE_MS', {
  factory: () => 300,
});

const SORT_LABELS: Readonly<Record<FeedSort, string>> = {
  relevance: 'Best match',
  newest: 'Newest first',
  oldest: 'Oldest first',
  favorited: 'Recently favorited',
};

/**
 * The filters above a feed: search, kind of message, favorites, channel and forum topic, tags,
 * dates, downloaded files and order. Only what the page does not fix is shown; every change is
 * emitted as a whole.
 */
@Component({
  selector: 'app-feed-filters',
  imports: [
    MatButton,
    MatChipAvatar,
    MatChipListbox,
    MatChipOption,
    MatFormField,
    MatHint,
    MatIcon,
    MatIconButton,
    MatInput,
    MatLabel,
    MatOption,
    MatPrefix,
    MatSelect,
    MatSuffix,
  ],
  templateUrl: './feed-filters.html',
  styleUrl: './feed-filters.scss',
})
export class FeedFiltersBar {
  readonly filters = input.required<FeedFilters>();
  readonly scope = input<FeedScope>({});
  /** Whether the channel the page fixes is a forum. */
  readonly forumChannel = input(false);
  /** Off where the page has its own search box. */
  readonly searchField = input(true);
  readonly filtersChange = output<FeedFilters>();

  private readonly channelsApi = inject(ChannelsApi);
  private readonly topicsApi = inject(TopicsApi);
  protected readonly tagStore = inject(TagStore);

  protected readonly categories = CATEGORY_OPTIONS;
  protected readonly maxQuery = MAX_QUERY_LENGTH;
  private readonly channelFixed = computed(() => Boolean(this.scope().channelId));

  private readonly channels = rxResource({
    params: () => (this.channelFixed() ? undefined : true),
    stream: () => this.channelsApi.list({ limit: FILTER_CHANNEL_LIMIT }),
  });
  /** Old basic groups are part of their supergroup, so they are not offered on their own. */
  protected readonly channelOptions = computed(() =>
    this.channels.hasValue()
      ? this.channels.value().items.filter((channel) => channel.migratedToChannelId === null)
      : [],
  );

  private readonly channelId = computed(() => this.filters().channelId);
  private readonly isForum = computed(() => {
    const channelId = this.channelId();
    if (channelId === null) {
      return false;
    }
    return this.channelFixed()
      ? this.forumChannel()
      : this.channelOptions().some((channel) => channel.id === channelId && channel.isForum);
  });
  protected readonly topicsVisible = computed(() => this.isForum() && !this.scope().topicId);
  private readonly topics = rxResource({
    params: () => (this.topicsVisible() ? this.channelId() : undefined),
    stream: ({ params }) => (params ? this.topicsApi.list(params) : of(null)),
  });
  protected readonly topicOptions = computed(() =>
    this.topics.hasValue() ? (this.topics.value()?.topics ?? []) : [],
  );

  protected readonly categoryFixed = computed(() => Boolean(this.scope().category));
  protected readonly tagsVisible = computed(() => !this.scope().tagId);
  protected readonly favoriteVisible = computed(() => !this.scope().favorite);
  /** Text messages have no files to filter by. */
  protected readonly showDownloaded = computed(() => this.filters().category !== 'text');
  protected readonly narrowed = computed(() => isNarrowed(this.filters(), this.scope()));
  /** Best matches while searching; favorite dates for favorites (not while searching). */
  protected readonly sortOptions = computed(() => {
    const { q, favorite } = this.filters();
    const sorts: FeedSort[] = [
      ...(q ? (['relevance'] as const) : []),
      'newest',
      'oldest',
      ...(favorite && !q ? (['favorited'] as const) : []),
    ];
    return sorts.map((value) => ({ value, label: SORT_LABELS[value] }));
  });

  /** What is typed in the search field; the list follows once typing pauses. */
  protected readonly query = linkedSignal(() => this.filters().q);
  private readonly typed = new Subject<string>();

  constructor() {
    this.typed
      .pipe(debounceTime(inject(SEARCH_DEBOUNCE_MS)), takeUntilDestroyed())
      .subscribe((text) => this.setQuery(text));
    // Chosen tags need their names.
    effect(() => {
      if (this.filters().tagIds.length > 0) {
        this.tagStore.load();
      }
    });
  }

  protected typing(event: Event): void {
    const text = (event.target as HTMLInputElement).value;
    this.query.set(text);
    this.typed.next(text);
  }

  /** Enter searches at once. */
  protected applyQuery(): void {
    this.setQuery(this.query());
  }

  protected clearQuery(): void {
    this.query.set('');
    this.setQuery('');
  }

  protected setCategory(value: MessageCategory | 'all' | null | undefined): void {
    const category = value === 'all' || !value ? null : value;
    const downloaded = category === 'text' ? 'all' : this.filters().downloaded;
    this.emit({ category, downloaded });
  }

  protected setFavorite(favorite: boolean): void {
    this.emit({ favorite });
  }

  protected setChannel(channelId: string | null): void {
    // A topic belongs to its channel.
    this.emit({ channelId, topicId: null });
  }

  protected setTopic(topicId: number | null): void {
    this.emit({ topicId });
  }

  protected setTags(tagIds: string[]): void {
    this.emit({ tagIds: tagIds.slice(0, MAX_FILTER_TAGS) });
  }

  protected setDay(which: 'from' | 'to', event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.emit({ [which]: /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null });
  }

  protected setSort(sort: FeedSort): void {
    this.emit({ sort });
  }

  protected setDownloaded(downloaded: FeedFilters['downloaded']): void {
    this.emit({ downloaded });
  }

  protected clear(): void {
    this.filtersChange.emit(clearedFilters(this.filters(), this.scope()));
  }

  private setQuery(text: string): void {
    const q = text.trim().slice(0, MAX_QUERY_LENGTH);
    const current = this.filters();
    if (q === current.q) {
      return;
    }
    // Starting or ending a search changes the order (best matches); refining it keeps the order.
    const sort = Boolean(q) === Boolean(current.q) ? current.sort : defaultSort(this.scope(), q);
    this.emit({ q, sort });
  }

  private emit(change: Partial<FeedFilters>): void {
    this.filtersChange.emit({ ...this.filters(), ...change });
  }
}
