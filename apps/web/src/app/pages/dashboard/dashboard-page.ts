import { formatNumber } from '@angular/common';
import { Component, LOCALE_ID, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatProgressBar } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import { type StatDefinition, STAT_GROUPS } from '../../features/dashboard/stat-definitions';
import { StatsApi } from '../../features/dashboard/stats-api';
import { MEDIA_ENDPOINTS } from '../../features/media/media-api';
import { durationLabel } from '../../features/media/media-labels';
import { MediaTile } from '../../features/media/media-tile';
import { PlaybackMemory, type WatchEntry } from '../../features/media/playback-memory';
import { MEDIA_MESSAGE_TYPES } from '../../features/messages/message-labels';
import { MessagesApi } from '../../features/messages/messages-api';
import { ErrorState } from '../../shared/components/error-state/error-state';
import { PageHeader } from '../../shared/components/page-header/page-header';
import { Skeleton } from '../../shared/components/skeleton/skeleton';
import { StatCard } from '../../shared/components/stat-card/stat-card';
import { type StatsDto, toApiError } from '../../shared/models';
import { BytesPipe } from '../../shared/pipes/bytes-pipe';

interface StatCardView extends StatDefinition {
  readonly value: string;
}

interface StatGroupView {
  readonly title: string;
  readonly stats: readonly StatCardView[];
}

/** Files shown under "Latest media". */
export const LATEST_MEDIA_COUNT = 8;

@Component({
  selector: 'app-dashboard-page',
  imports: [
    ErrorState,
    MatButton,
    MatIcon,
    MatProgressBar,
    MediaTile,
    PageHeader,
    RouterLink,
    Skeleton,
    StatCard,
  ],
  templateUrl: './dashboard-page.html',
  styleUrl: './dashboard-page.scss',
})
export class DashboardPage {
  private readonly statsApi = inject(StatsApi);
  private readonly messages = inject(MessagesApi);
  private readonly locale = inject(LOCALE_ID);
  private readonly bytes = new BytesPipe();

  protected readonly stats = rxResource({ stream: () => this.statsApi.getStats() });
  protected readonly latest = rxResource({
    stream: () => this.messages.list({ types: MEDIA_MESSAGE_TYPES, limit: LATEST_MEDIA_COUNT }),
  });
  protected readonly latestItems = computed(() =>
    this.latest.hasValue() ? this.latest.value().items : [],
  );
  /** Videos and audio started in this browser and not finished. */
  protected readonly watching = signal<readonly WatchEntry[]>(
    inject(PlaybackMemory).continueWatching(4),
  );
  protected readonly missingThumbnails = signal<ReadonlySet<string>>(new Set());

  protected readonly groups = computed<readonly StatGroupView[] | null>(() => {
    if (!this.stats.hasValue()) {
      return null;
    }
    const stats = this.stats.value();
    return STAT_GROUPS.map((group) => ({
      title: group.title,
      stats: group.stats.map((definition) => ({
        ...definition,
        value: this.formatValue(definition, stats),
      })),
    }));
  });

  protected readonly isEmptyArchive = computed(
    () => this.stats.hasValue() && this.stats.value().channels === 0,
  );

  protected readonly errorMessage = computed(() => toApiError(this.stats.error()).message);

  protected thumbnail(entry: WatchEntry): string {
    return MEDIA_ENDPOINTS.thumbnail(entry.mediaId);
  }

  protected thumbnailFailed(entry: WatchEntry): void {
    this.missingThumbnails.update((ids) => new Set(ids).add(entry.mediaId));
  }

  protected progress(entry: WatchEntry): number {
    return Math.round((entry.position / entry.duration) * 100);
  }

  protected left(entry: WatchEntry): string {
    return durationLabel(entry.duration - entry.position) ?? '';
  }

  private formatValue(definition: StatDefinition, stats: StatsDto): string {
    const value = stats[definition.key];
    return definition.format === 'bytes'
      ? this.bytes.transform(value)
      : formatNumber(value, this.locale, '1.0-0');
  }
}
