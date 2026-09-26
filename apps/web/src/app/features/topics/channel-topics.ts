import { DatePipe } from '@angular/common';
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
import { MatFormField, MatLabel, MatSuffix } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { Notice } from '../../shared/components/notice/notice';
import { Skeleton } from '../../shared/components/skeleton/skeleton';
import { type ForumTopicDto, type ForumTopicListDto, toApiError } from '../../shared/models';
import { searchable } from '../../shared/text/searchable';
import { TOPICS_WAIT_POLL_MS, TopicsApi } from './topics-api';

/** Topics shown before "Show all". */
export const TOPIC_PREVIEW_COUNT = 12;

/** "12 videos · 3 documents · 20 messages": what a topic holds, empty kinds left out. */
export function topicCounts(topic: Pick<ForumTopicDto, 'counts'>): string {
  const { messages, videos, images, documents, audio } = topic.counts;
  const parts = [
    [videos, 'video', 'videos'],
    [images, 'image', 'images'],
    [documents, 'document', 'documents'],
    [audio, 'audio file', 'audio files'],
  ] as const;
  const kinds = parts
    .filter(([count]) => count > 0)
    .map(([count, one, many]) => `${count} ${count === 1 ? one : many}`);
  return [...kinds, `${messages} ${messages === 1 ? 'message' : 'messages'}`].join(' · ');
}

/**
 * The topics of a forum channel, in creation order (the order of the lessons in a course), each
 * with what it holds. Topic names come from Telegram through the worker; until they arrive the list
 * says so and checks again every few seconds.
 */
@Component({
  selector: 'app-channel-topics',
  imports: [
    DatePipe,
    MatButton,
    MatFormField,
    MatIcon,
    MatInput,
    MatLabel,
    MatProgressSpinner,
    MatSuffix,
    Notice,
    RouterLink,
    Skeleton,
  ],
  templateUrl: './channel-topics.html',
  styleUrl: './channel-topics.scss',
})
export class ChannelTopics {
  readonly channelId = input.required<string>();

  private readonly api = inject(TopicsApi);
  private readonly waitPollMs = inject(TOPICS_WAIT_POLL_MS);
  private readonly destroyRef = inject(DestroyRef);

  private readonly id = computed(() => this.channelId());
  protected readonly topics = rxResource({
    params: () => this.id(),
    stream: ({ params }) => this.api.list(params),
  });
  /** The latest list, from loading or from a refresh. */
  protected readonly data = linkedSignal<ForumTopicListDto | undefined>(() =>
    this.topics.hasValue() ? this.topics.value() : undefined,
  );
  protected readonly loadError = computed(() =>
    this.topics.error() ? toApiError(this.topics.error()).message : null,
  );

  protected readonly query = signal('');
  protected readonly showAll = signal(false);
  protected readonly refreshing = signal(false);
  protected readonly refreshError = signal<string | null>(null);
  protected readonly previewCount = TOPIC_PREVIEW_COUNT;

  protected readonly filtered = computed(() => {
    const topics = this.data()?.topics ?? [];
    const query = searchable(this.query().trim());
    return query ? topics.filter((topic) => searchable(topic.title).includes(query)) : topics;
  });
  protected readonly visible = computed(() =>
    this.showAll() || this.query().trim()
      ? this.filtered()
      : this.filtered().slice(0, TOPIC_PREVIEW_COUNT),
  );
  /** The worker has not read the topic names from Telegram yet. */
  protected readonly waitingForNames = computed(() => this.data()?.refreshedAt === null);

  constructor() {
    effect((onCleanup) => {
      if (!this.waitingForNames() || this.topics.isLoading()) {
        return;
      }
      const timer = setTimeout(() => this.topics.reload(), this.waitPollMs);
      onCleanup(() => clearTimeout(timer));
    });
  }

  protected counts(topic: ForumTopicDto): string {
    return topicCounts(topic);
  }

  /** A topic whose messages were all posted on one (local) day shows one date. */
  protected sameDay(topic: ForumTopicDto): boolean {
    return (
      topic.firstPostedAt !== null &&
      topic.lastPostedAt !== null &&
      new Date(topic.firstPostedAt).toDateString() === new Date(topic.lastPostedAt).toDateString()
    );
  }

  protected search(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  /** Reads the topic names from Telegram again, through the worker. */
  protected refresh(): void {
    if (this.refreshing()) {
      return;
    }
    this.refreshing.set(true);
    this.refreshError.set(null);
    this.api
      .refresh(this.channelId())
      .pipe(
        finalize(() => this.refreshing.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (list) => this.data.set(list),
        error: (error: unknown) => this.refreshError.set(toApiError(error).message),
      });
  }
}
