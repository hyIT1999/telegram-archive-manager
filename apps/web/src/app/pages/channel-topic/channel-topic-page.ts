import { DatePipe } from '@angular/common';
import { Component, computed, inject, input } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { ChannelsApi } from '../../features/channels/channels-api';
import { GENERAL_TOPIC_ID } from '../../features/messages/message-labels';
import { MessageFeed } from '../../features/messages/message-feed';
import { TopicsApi } from '../../features/topics/topics-api';
import { topicCounts } from '../../features/topics/channel-topics';
import { EmptyState } from '../../shared/components/empty-state/empty-state';
import { ErrorState } from '../../shared/components/error-state/error-state';
import { PageHeader } from '../../shared/components/page-header/page-header';
import { Skeleton } from '../../shared/components/skeleton/skeleton';
import {
  type ChannelDto,
  type ForumTopicListDto,
  isNotFoundError,
  toApiError,
} from '../../shared/models';

/**
 * One topic of a forum channel, read like a course: its messages oldest first, with the previous
 * and next topic a click away.
 */
@Component({
  selector: 'app-channel-topic-page',
  imports: [
    DatePipe,
    EmptyState,
    ErrorState,
    MatButton,
    MatIcon,
    MessageFeed,
    PageHeader,
    RouterLink,
    Skeleton,
  ],
  templateUrl: './channel-topic-page.html',
  styleUrl: './channel-topic-page.scss',
})
export class ChannelTopicPage {
  /** Route parameter `:id` (the channel), bound by the router. */
  readonly id = input.required<string>();
  /** Route parameter `:topicId`, bound by the router. */
  readonly topicId = input.required<string>();

  private readonly channels = inject(ChannelsApi);
  private readonly topicsApi = inject(TopicsApi);

  private readonly channelId = computed(() => this.id());
  protected readonly channel = rxResource({
    params: () => this.channelId(),
    stream: ({ params }) => this.channels.get(params),
  });
  protected readonly topics = rxResource({
    params: () => this.channelId(),
    stream: ({ params }) => this.topicsApi.list(params),
  });

  protected readonly channelData = computed<ChannelDto | undefined>(() =>
    this.channel.hasValue() ? this.channel.value() : undefined,
  );
  private readonly list = computed<ForumTopicListDto | undefined>(() =>
    this.topics.hasValue() ? this.topics.value() : undefined,
  );
  /** The topic number from the URL; null when it is not one. */
  protected readonly topicNumber = computed(() => {
    const value = Number(this.topicId());
    return Number.isInteger(value) && value >= GENERAL_TOPIC_ID ? value : null;
  });
  protected readonly topic = computed(
    () => this.list()?.topics.find((candidate) => candidate.topicId === this.topicNumber()) ?? null,
  );
  protected readonly title = computed(() => {
    const number = this.topicNumber();
    return this.topic()?.title ?? (number === GENERAL_TOPIC_ID ? 'General' : `Topic #${number}`);
  });
  protected readonly summary = computed(() => {
    const topic = this.topic();
    return topic ? topicCounts(topic) : '';
  });
  /** The topics around this one, in creation order. */
  protected readonly neighbours = computed(() => {
    const topics = this.list()?.topics ?? [];
    const index = topics.findIndex((candidate) => candidate.topicId === this.topicNumber());
    return {
      previous: index > 0 ? (topics[index - 1] ?? null) : null,
      next: index >= 0 ? (topics[index + 1] ?? null) : null,
    };
  });
  protected readonly notFound = computed(
    () => this.topicNumber() === null || isNotFoundError(this.channel.error()),
  );
  protected readonly errorMessage = computed(() => toApiError(this.channel.error()).message);
}
