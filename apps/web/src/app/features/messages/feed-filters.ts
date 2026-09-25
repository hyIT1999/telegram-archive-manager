import { Component, computed, inject, input, output } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatButton } from '@angular/material/button';
import { MatChipListbox, MatChipOption } from '@angular/material/chips';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatOption, MatSelect } from '@angular/material/select';
import { of } from 'rxjs';
import type { MessageCategory } from '../../shared/models';
import { ChannelsApi } from '../channels/channels-api';
import { TopicsApi } from '../topics/topics-api';
import { type FeedFilters, type FeedScope, clearedFilters, isNarrowed } from './feed-query';
import { CATEGORY_OPTIONS } from './message-labels';

/** Channels offered in the channel filter (one page of the channel list). */
export const FILTER_CHANNEL_LIMIT = 100;

/**
 * The filters above a feed: kind of message, channel and forum topic, dates, downloaded files and
 * order. Only what the page does not fix is shown; every change is emitted as a whole.
 */
@Component({
  selector: 'app-feed-filters',
  imports: [
    MatButton,
    MatChipListbox,
    MatChipOption,
    MatFormField,
    MatIcon,
    MatInput,
    MatLabel,
    MatOption,
    MatSelect,
  ],
  templateUrl: './feed-filters.html',
  styleUrl: './feed-filters.scss',
})
export class FeedFiltersBar {
  readonly filters = input.required<FeedFilters>();
  readonly scope = input<FeedScope>({});
  /** Whether the channel the page fixes is a forum. */
  readonly forumChannel = input(false);
  readonly filtersChange = output<FeedFilters>();

  private readonly channelsApi = inject(ChannelsApi);
  private readonly topicsApi = inject(TopicsApi);

  protected readonly categories = CATEGORY_OPTIONS;
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
  /** Text messages have no files to filter by. */
  protected readonly showDownloaded = computed(() => this.filters().category !== 'text');
  protected readonly narrowed = computed(() => isNarrowed(this.filters(), this.scope()));

  protected setCategory(value: MessageCategory | 'all' | null | undefined): void {
    const category = value === 'all' || !value ? null : value;
    const downloaded = category === 'text' ? 'all' : this.filters().downloaded;
    this.emit({ category, downloaded });
  }

  protected setChannel(channelId: string | null): void {
    // A topic belongs to its channel.
    this.emit({ channelId, topicId: null });
  }

  protected setTopic(topicId: number | null): void {
    this.emit({ topicId });
  }

  protected setDay(which: 'from' | 'to', event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.emit({ [which]: /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null });
  }

  protected setSort(sort: FeedFilters['sort']): void {
    this.emit({ sort });
  }

  protected setDownloaded(downloaded: FeedFilters['downloaded']): void {
    this.emit({ downloaded });
  }

  protected clear(): void {
    this.filtersChange.emit(clearedFilters(this.filters(), this.scope()));
  }

  private emit(change: Partial<FeedFilters>): void {
    this.filtersChange.emit({ ...this.filters(), ...change });
  }
}
