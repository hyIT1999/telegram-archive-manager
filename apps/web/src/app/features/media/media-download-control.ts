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
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatProgressBar } from '@angular/material/progress-bar';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatTooltip } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { catchError, finalize, forkJoin, of } from 'rxjs';
import { Notice } from '../../shared/components/notice/notice';
import { type MediaDto, type MediaSummaryDto, toApiError } from '../../shared/models';
import { BytesPipe } from '../../shared/pipes/bytes-pipe';
import { DOWNLOAD_STAGE_LABELS, SKIP_REASON_LABELS } from '../downloads/download-labels';
import { DOWNLOAD_POLLING, DownloadsApi } from '../downloads/downloads-api';
import { SettingsApi } from '../settings/settings-api';
import { MEDIA_ENDPOINTS, MediaApi } from './media-api';

function isDetailed(media: MediaSummaryDto | MediaDto): media is MediaDto {
  return 'requested' in media;
}

/**
 * Gets a file into the archive and out to the person: "Download" asks the worker for it (whatever
 * the automatic download settings say), progress shows while it comes, and "Save file" hands the
 * stored file to the browser. Re-reads the file while it downloads and says why it waits, if it does.
 */
@Component({
  selector: 'app-media-download-control',
  imports: [
    BytesPipe,
    MatButton,
    MatIcon,
    MatIconButton,
    MatProgressBar,
    MatProgressSpinner,
    MatTooltip,
    Notice,
    RouterLink,
  ],
  templateUrl: './media-download-control.html',
  styleUrl: './media-download-control.scss',
})
export class MediaDownloadControl {
  readonly media = input.required<MediaSummaryDto | MediaDto>();
  /** The file's channel, to explain a long wait (its storage location may be full). */
  readonly channelId = input<string | null>(null);
  /** Icon buttons for lists instead of labelled buttons. */
  readonly compact = input(false);
  /** The file after this control learned something new about it. */
  readonly mediaChange = output<MediaDto>();

  private readonly downloads = inject(DownloadsApi);
  private readonly mediaApi = inject(MediaApi);
  private readonly settings = inject(SettingsApi);
  private readonly polling = inject(DOWNLOAD_POLLING);
  private readonly destroyRef = inject(DestroyRef);

  /** What is known about the file: the input, until this control reads something newer. */
  protected readonly current = linkedSignal<MediaSummaryDto | MediaDto>(() => this.media());
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  /** Why a requested file still waits (downloads paused, location full…). */
  protected readonly waitReason = signal<string | null>(null);
  /** Set once this control asked for the file: it then follows it until it settles. */
  private readonly following = signal(false);
  private explained = false;

  protected readonly status = computed(() => this.current().downloadStatus);
  private readonly detail = computed(() => {
    const media = this.current();
    return isDetailed(media) ? media : null;
  });
  /** Downloading, or waiting its turn after someone asked for it. */
  protected readonly inFlight = computed(() => {
    const status = this.status();
    return (
      status === 'DOWNLOADING' ||
      (status === 'PENDING' && (this.following() || this.detail()?.requested === true))
    );
  });
  protected readonly stageLabel = computed(() => {
    const stage = this.detail()?.stage;
    return stage ? DOWNLOAD_STAGE_LABELS[stage] : 'Waiting for its turn';
  });
  protected readonly skipReason = computed(() => {
    const reason = this.detail()?.skipReason;
    return reason ? SKIP_REASON_LABELS[reason] : null;
  });
  /** Content protection means the file is never downloaded. */
  protected readonly protectedFile = computed(() => this.detail()?.skipReason === 'PROTECTED');
  protected readonly failure = computed(() =>
    this.status() === 'FAILED' ? (this.detail()?.error ?? 'The download failed.') : null,
  );
  protected readonly saveUrl = computed(() => MEDIA_ENDPOINTS.content(this.current().id, true));

  constructor() {
    // Re-read the file while it is on its way; each answer schedules the next reading.
    effect((onCleanup) => {
      if (!this.inFlight()) {
        return;
      }
      const id = this.current().id;
      const timer = setTimeout(() => this.refresh(id), this.polling.activeMs);
      onCleanup(() => clearTimeout(timer));
    });
  }

  protected download(): void {
    if (this.busy()) {
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    this.downloads
      .download(this.current().id)
      .pipe(
        finalize(() => this.busy.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (media) => {
          this.following.set(media.downloadStatus !== 'DOWNLOADED');
          this.update(media);
        },
        error: (error: unknown) => this.error.set(toApiError(error).message),
      });
  }

  protected cancel(): void {
    if (this.busy()) {
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    this.downloads
      .cancel(this.current().id)
      .pipe(
        finalize(() => this.busy.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (media) => {
          this.following.set(false);
          this.waitReason.set(null);
          this.update(media);
        },
        error: (error: unknown) => this.error.set(toApiError(error).message),
      });
  }

  private refresh(id: string): void {
    this.mediaApi
      .get(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (media) => {
          if (media.downloadStatus !== 'PENDING' && media.downloadStatus !== 'DOWNLOADING') {
            this.following.set(false);
            this.waitReason.set(null);
          } else if (media.downloadStatus === 'PENDING' && media.stage === null) {
            this.explainWait();
          }
          this.update(media);
        },
        // A failed reading is tried again with the next one.
        error: () => this.current.set({ ...this.current() }),
      });
  }

  private update(media: MediaDto): void {
    this.current.set(media);
    this.mediaChange.emit(media);
  }

  /** Once per control: tells whether the whole archive or the file's location is on hold. */
  private explainWait(): void {
    if (this.explained) {
      return;
    }
    this.explained = true;
    const channelId = this.channelId();
    forkJoin({
      settings: this.settings.get().pipe(catchError(() => of(null))),
      downloads: channelId
        ? this.downloads.channel(channelId).pipe(catchError(() => of(null)))
        : of(null),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ settings, downloads }) => {
        if (settings?.downloads.paused) {
          this.waitReason.set('paused');
        } else if (downloads?.location?.unavailableUntil) {
          this.waitReason.set(
            `The storage location takes no files until ${new Date(
              downloads.location.unavailableUntil,
            ).toLocaleTimeString()}. ${downloads.location.lastError ?? ''}`.trim(),
          );
        } else if (downloads && downloads.location === null) {
          this.waitReason.set('No storage location is chosen for this channel.');
        }
      });
  }
}
