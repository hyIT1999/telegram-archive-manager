import { DatePipe, DecimalPipe, formatNumber } from '@angular/common';
import { Component, LOCALE_ID, computed, inject, input } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { filter, merge } from 'rxjs';
import { LiveEvents } from '../../core/live/live-events';
import { liveRefresh } from '../../core/live/live-refresh';
import { channelHandle, chatTypeLabel, telegramUrl } from '../../features/channels/channel-labels';
import { ChannelsApi } from '../../features/channels/channels-api';
import { ChannelDownloadsPanel } from '../../features/downloads/channel-downloads-panel';
import { ChannelImportPanel } from '../../features/imports/channel-import-panel';
import { MessageFeed } from '../../features/messages/message-feed';
import { ChannelSyncPanel } from '../../features/sync/channel-sync-panel';
import { ChannelTopics } from '../../features/topics/channel-topics';
import { EmptyState } from '../../shared/components/empty-state/empty-state';
import { ErrorState } from '../../shared/components/error-state/error-state';
import { PageHeader } from '../../shared/components/page-header/page-header';
import { Skeleton } from '../../shared/components/skeleton/skeleton';
import { StatCard } from '../../shared/components/stat-card/stat-card';
import { type ChannelDto, isNotFoundError, toApiError } from '../../shared/models';
import { BytesPipe } from '../../shared/pipes/bytes-pipe';

@Component({
  selector: 'app-channel-detail-page',
  imports: [
    ChannelDownloadsPanel,
    ChannelImportPanel,
    ChannelSyncPanel,
    ChannelTopics,
    DatePipe,
    DecimalPipe,
    EmptyState,
    ErrorState,
    MatButton,
    MatIcon,
    MessageFeed,
    PageHeader,
    RouterLink,
    Skeleton,
    StatCard,
  ],
  templateUrl: './channel-detail-page.html',
  styleUrl: './channel-detail-page.scss',
})
export class ChannelDetailPage {
  /** Route parameter `:id`, bound by the router. */
  readonly id = input.required<string>();

  private readonly api = inject(ChannelsApi);
  private readonly locale = inject(LOCALE_ID);
  private readonly bytes = new BytesPipe();

  protected readonly channel = rxResource({
    params: () => ({ id: this.id() }),
    stream: ({ params }) => this.api.get(params.id),
  });

  constructor() {
    // Imports, syncs and downloads change the channel's range and numbers: read it again, now
    // and then (its statistics count the whole archive of the channel).
    const live = inject(LiveEvents);
    liveRefresh({
      reload: () => this.channel.reload(),
      events: merge(live.on('channel.changed'), live.on('downloads.changed')).pipe(
        filter(({ channelId }) => channelId === this.id()),
      ),
      throttleMs: 10_000,
      loading: () => this.channel.isLoading(),
      poll: () => null,
    });
  }

  protected readonly data = computed<ChannelDto | undefined>(() =>
    this.channel.hasValue() ? this.channel.value() : undefined,
  );
  protected readonly notFound = computed(() => isNotFoundError(this.channel.error()));
  protected readonly errorMessage = computed(() => toApiError(this.channel.error()).message);

  protected readonly handle = computed(() => {
    const channel = this.data();
    return channel ? `${channelHandle(channel)} · ${chatTypeLabel(channel.type)}` : '';
  });
  protected readonly telegramLink = computed(() => {
    const channel = this.data();
    return channel ? telegramUrl(channel) : null;
  });
  protected readonly typeLabel = computed(() => {
    const channel = this.data();
    return channel ? chatTypeLabel(channel.type) : '';
  });

  /** A switch of the downloads or sync panel changed the channel. */
  protected updated(channel: ChannelDto): void {
    this.channel.set(channel);
  }

  protected count(value: number): string {
    return formatNumber(value, this.locale, '1.0-0');
  }

  protected size(value: number): string {
    return this.bytes.transform(value);
  }
}
