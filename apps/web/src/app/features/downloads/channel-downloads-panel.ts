import { DatePipe } from '@angular/common';
import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { rxResource, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatProgressBar } from '@angular/material/progress-bar';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatSlideToggle, type MatSlideToggleChange } from '@angular/material/slide-toggle';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { Notice } from '../../shared/components/notice/notice';
import { Skeleton } from '../../shared/components/skeleton/skeleton';
import {
  type ActiveDownloadDto,
  type ChannelDownloadsDto,
  type ChannelDto,
  toApiError,
} from '../../shared/models';
import { BytesPipe } from '../../shared/pipes/bytes-pipe';
import { ChannelsApi } from '../channels/channels-api';
import { DOWNLOAD_STAGE_LABELS, durationText, secondsLeft, speedBetween } from './download-labels';
import { DOWNLOAD_POLLING, DownloadsApi } from './downloads-api';

/** A running file as the panel shows it. */
interface ActiveRow {
  item: ActiveDownloadDto;
  stageLabel: string;
  /** Bytes per second since the previous reading; null before there is one. */
  speed: number | null;
}

/**
 * The media downloads of a channel: the switch for automatic downloads, how many files are in
 * (and how many bytes are left), where they go and whether it has room, what downloads right now,
 * and a retry for failed files. Re-read every few seconds while the page is open.
 */
@Component({
  selector: 'app-channel-downloads-panel',
  imports: [
    BytesPipe,
    DatePipe,
    MatButton,
    MatIcon,
    MatProgressBar,
    MatProgressSpinner,
    MatSlideToggle,
    Notice,
    RouterLink,
    Skeleton,
  ],
  templateUrl: './channel-downloads-panel.html',
  styleUrl: './channel-downloads-panel.scss',
})
export class ChannelDownloadsPanel {
  readonly channel = input.required<ChannelDto>();
  /** The channel after the switch changed it. */
  readonly channelChange = output<ChannelDto>();

  private readonly api = inject(DownloadsApi);
  private readonly channels = inject(ChannelsApi);
  private readonly polling = inject(DOWNLOAD_POLLING);
  private readonly destroyRef = inject(DestroyRef);
  private readonly bytes = new BytesPipe();

  // Computed separately, so a newer copy of the same channel (after the switch) loads nothing.
  private readonly channelId = computed(() => this.channel().id);
  private readonly protectedChat = computed(() => this.channel().isProtected);
  protected readonly summary = rxResource({
    params: () => (this.protectedChat() ? undefined : this.channelId()),
    stream: ({ params }) => this.api.channel(params),
  });
  protected readonly data = computed<ChannelDownloadsDto | undefined>(() =>
    this.summary.hasValue() ? this.summary.value() : undefined,
  );
  protected readonly loadError = computed(() =>
    this.summary.error() ? toApiError(this.summary.error()).message : null,
  );

  /** Running files, with their speed since the previous reading of the same stage. */
  protected readonly active = linkedSignal<ChannelDownloadsDto | undefined, ActiveRow[]>({
    source: this.data,
    computation: (data, previous) => {
      const before = new Map((previous?.source?.active ?? []).map((item) => [item.mediaId, item]));
      return (data?.active ?? []).map((item) => {
        const earlier = before.get(item.mediaId);
        return {
          item,
          stageLabel: item.stage ? DOWNLOAD_STAGE_LABELS[item.stage] : 'Queued',
          speed:
            earlier && earlier.stage === item.stage
              ? speedBetween(
                  { bytes: earlier.downloadedBytes, at: Date.parse(earlier.updatedAt) },
                  { bytes: item.downloadedBytes, at: Date.parse(item.updatedAt) },
                )
              : null,
        };
      });
    },
  });

  /** Files and bytes still wanted: downloaded, waiting or running (not failed, skipped, cancelled). */
  protected readonly wanted = computed(() => {
    const data = this.data();
    if (!data) {
      return null;
    }
    const files = data.files.downloaded + data.files.pending + data.files.active;
    const bytes = data.bytes.downloaded + data.bytes.remaining;
    return {
      files,
      bytes,
      percent: bytes > 0 ? Math.floor((data.bytes.downloaded * 100) / bytes) : 0,
    };
  });

  /** How long the remaining files take at the current speed of the files fetched now. */
  protected readonly timeLeft = computed(() => {
    const data = this.data();
    const fetching = this.active().filter(
      (row) => row.item.stage === 'FETCHING' && row.speed !== null,
    );
    if (!data || fetching.length === 0) {
      return null;
    }
    const speed = fetching.reduce((sum, row) => sum + (row.speed ?? 0), 0);
    const seconds = secondsLeft(data.bytes.remaining, speed);
    return seconds === null ? null : durationText(seconds);
  });

  protected readonly switching = signal(false);
  protected readonly retrying = signal(false);
  protected readonly cancelling = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);
  protected readonly retried = signal<number | null>(null);

  constructor() {
    effect((onCleanup) => {
      const data = this.data();
      if (!data || this.summary.isLoading()) {
        return;
      }
      const delay = data.files.active > 0 ? this.polling.activeMs : this.polling.idleMs;
      const timer = setTimeout(() => this.summary.reload(), delay);
      onCleanup(() => clearTimeout(timer));
    });
  }

  protected reload(): void {
    this.summary.reload();
  }

  protected speedText(row: ActiveRow): string | null {
    return row.speed === null ? null : `${this.bytes.transform(row.speed)}/s`;
  }

  protected toggle(change: MatSlideToggleChange): void {
    this.switching.set(true);
    this.actionError.set(null);
    this.channels
      .update(this.channel().id, { downloadMedia: change.checked })
      .pipe(
        finalize(() => this.switching.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (channel) => {
          this.channelChange.emit(channel);
          this.summary.reload();
        },
        error: (error: unknown) => {
          this.actionError.set(toApiError(error).message);
          // Show the switch where it really is.
          change.source.checked = !change.checked;
        },
      });
  }

  protected retryFailed(): void {
    if (this.retrying()) {
      return;
    }
    this.retrying.set(true);
    this.actionError.set(null);
    this.api
      .retryFailed(this.channel().id)
      .pipe(
        finalize(() => this.retrying.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ queued }) => {
          this.retried.set(queued);
          this.summary.reload();
        },
        error: (error: unknown) => this.actionError.set(toApiError(error).message),
      });
  }

  protected cancel(mediaId: string): void {
    if (this.cancelling()) {
      return;
    }
    this.cancelling.set(mediaId);
    this.actionError.set(null);
    this.api
      .cancel(mediaId)
      .pipe(
        finalize(() => this.cancelling.set(null)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => this.summary.reload(),
        error: (error: unknown) => {
          this.actionError.set(toApiError(error).message);
          this.summary.reload();
        },
      });
  }
}
