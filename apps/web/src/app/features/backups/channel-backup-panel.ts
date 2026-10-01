import { DatePipe } from '@angular/common';
import {
  Component,
  DestroyRef,
  computed,
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
import { filter, finalize } from 'rxjs';
import { LiveEvents } from '../../core/live/live-events';
import { LIVE_SAFETY_POLL_MS, liveRefresh } from '../../core/live/live-refresh';
import { Notice } from '../../shared/components/notice/notice';
import { Skeleton } from '../../shared/components/skeleton/skeleton';
import {
  type ActiveBackupDto,
  type ChannelBackupDto,
  type ChannelDto,
  toApiError,
} from '../../shared/models';
import { BytesPipe } from '../../shared/pipes/bytes-pipe';
import { ChannelsApi } from '../channels/channels-api';
import { durationText, secondsLeft, speedBetween } from '../downloads/download-labels';
import { StorageLocationList } from '../storage/storage-location-list';
import { BACKUP_KINDS } from '../storage/storage-kinds';
import { BACKUP_STAGE_LABELS } from './backup-labels';
import { BACKUP_POLLING, BackupsApi } from './backup-api';

/** A running backup as the panel shows it. */
interface ActiveRow {
  item: ActiveBackupDto;
  stageLabel: string;
  /** How far the upload is, 0–100; null for a message without a file. */
  percent: number | null;
  /** Bytes per second since the previous reading; null before there is one. */
  speed: number | null;
}

/**
 * The Telegram backup of a channel: which chat of the account receives the copies, the switch
 * for automatic backups, how many messages (and bytes) are copied, what uploads right now,
 * failures with a retry, and Verify. Read again when its backups change (live updates), or every
 * few seconds while live updates cannot arrive.
 */
@Component({
  selector: 'app-channel-backup-panel',
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
    StorageLocationList,
  ],
  templateUrl: './channel-backup-panel.html',
  styleUrl: './channel-backup-panel.scss',
})
export class ChannelBackupPanel {
  readonly channel = input.required<ChannelDto>();
  /** The channel after its backup chat or switch changed. */
  readonly channelChange = output<ChannelDto>();

  private readonly api = inject(BackupsApi);
  private readonly channels = inject(ChannelsApi);
  private readonly polling = inject(BACKUP_POLLING);
  private readonly destroyRef = inject(DestroyRef);
  private readonly bytes = new BytesPipe();

  protected readonly backupKinds = BACKUP_KINDS;

  // Computed separately, so a newer copy of the same channel (after the switch) loads nothing.
  private readonly channelId = computed(() => this.channel().id);
  /** Protected chats are never backed up; an upgraded group is backed up with its supergroup. */
  protected readonly backupable = computed(
    () => !this.channel().isProtected && this.channel().migratedToChannelId === null,
  );
  private readonly hasChat = computed(() => this.channel().backupLocation !== null);
  protected readonly summary = rxResource({
    params: () => (this.backupable() && this.hasChat() ? this.channelId() : undefined),
    stream: ({ params }) => this.api.channel(params),
  });
  protected readonly data = computed<ChannelBackupDto | undefined>(() =>
    this.summary.hasValue() ? this.summary.value() : undefined,
  );
  protected readonly loadError = computed(() =>
    this.summary.error() ? toApiError(this.summary.error()).message : null,
  );

  /** Running backups, with their speed since the previous reading of the same stage. */
  protected readonly active = linkedSignal<ChannelBackupDto | undefined, ActiveRow[]>({
    source: this.data,
    computation: (data, previous) => {
      const before = new Map(
        (previous?.source?.active ?? []).map((item) => [item.messageId, item]),
      );
      return (data?.active ?? []).map((item) => {
        const earlier = before.get(item.messageId);
        return {
          item,
          stageLabel: item.stage ? BACKUP_STAGE_LABELS[item.stage] : 'Starting',
          percent:
            item.size === null || item.size === 0
              ? null
              : Math.min(100, Math.floor((item.uploadedBytes * 100) / item.size)),
          speed:
            earlier && earlier.stage === item.stage
              ? speedBetween(
                  { bytes: earlier.uploadedBytes, at: Date.parse(earlier.updatedAt) },
                  { bytes: item.uploadedBytes, at: Date.parse(item.updatedAt) },
                )
              : null,
        };
      });
    },
  });

  /** Messages and bytes still wanted: copied, waiting or running (not failed or skipped). */
  protected readonly wanted = computed(() => {
    const data = this.data();
    if (!data) {
      return null;
    }
    const { completed, pending, active } = data.messages;
    const messages = completed + pending + active;
    const bytes = data.bytes.uploaded + data.bytes.remaining;
    let percent = 0;
    if (bytes > 0) {
      percent = Math.floor((data.bytes.uploaded * 100) / bytes);
    } else if (messages > 0) {
      percent = Math.floor((completed * 100) / messages);
    }
    return { messages, bytes, percent };
  });

  /** How long the remaining files take at the current upload speed. */
  protected readonly timeLeft = computed(() => {
    const data = this.data();
    const uploading = this.active().filter(
      (row) => row.item.stage === 'UPLOADING' && row.speed !== null,
    );
    if (!data || uploading.length === 0) {
      return null;
    }
    const speed = uploading.reduce((sum, row) => sum + (row.speed ?? 0), 0);
    const seconds = secondsLeft(data.bytes.remaining, speed);
    return seconds === null ? null : durationText(seconds);
  });

  /** The chat picker is open (always, until a chat is chosen). */
  protected readonly choosing = signal(false);
  /** The chat picked in the picker; starts from the channel's own. */
  protected readonly choice = linkedSignal<ChannelDto, string | null>({
    source: this.channel,
    computation: (channel, previous) => channel.backupLocation?.id ?? previous?.value ?? null,
  });
  protected readonly savingChat = signal(false);
  protected readonly switching = signal(false);
  protected readonly retrying = signal(false);
  protected readonly verifying = signal(false);
  protected readonly actionError = signal<string | null>(null);
  protected readonly retried = signal<number | null>(null);

  constructor() {
    liveRefresh({
      reload: () => this.summary.reload(),
      events: inject(LiveEvents)
        .on('backups.changed')
        .pipe(filter(({ channelId }) => channelId === this.channelId())),
      // Progress is written about once a second: fresh enough, and light on the api.
      throttleMs: 2_000,
      loading: () => this.summary.isLoading(),
      poll: (live) => {
        const data = this.data();
        if (!data) {
          return null;
        }
        // Verify reports when it ends only through its flag: look again soon.
        if (data.verify.running) {
          return this.polling.activeMs;
        }
        if (live) {
          return LIVE_SAFETY_POLL_MS;
        }
        return data.messages.active > 0 ? this.polling.activeMs : this.polling.idleMs;
      },
    });
  }

  protected reload(): void {
    this.summary.reload();
  }

  protected speedText(row: ActiveRow): string | null {
    return row.speed === null ? null : `${this.bytes.transform(row.speed)}/s`;
  }

  protected openPicker(): void {
    this.actionError.set(null);
    this.choosing.set(true);
  }

  protected closePicker(): void {
    this.choice.set(this.channel().backupLocation?.id ?? null);
    this.choosing.set(false);
  }

  /** Sends the backups of the channel to the chat picked. */
  protected saveChat(): void {
    const backupLocationId = this.choice();
    if (!backupLocationId || this.savingChat()) {
      return;
    }
    this.savingChat.set(true);
    this.actionError.set(null);
    this.channels
      .update(this.channel().id, { backupLocationId })
      .pipe(
        finalize(() => this.savingChat.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (channel) => {
          this.choosing.set(false);
          this.channelChange.emit(channel);
          this.summary.reload();
        },
        error: (error: unknown) => this.actionError.set(toApiError(error).message),
      });
  }

  protected toggle(change: MatSlideToggleChange): void {
    this.switching.set(true);
    this.actionError.set(null);
    this.channels
      .update(this.channel().id, { backupEnabled: change.checked })
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

  protected verify(): void {
    if (this.verifying()) {
      return;
    }
    this.verifying.set(true);
    this.actionError.set(null);
    this.api
      .verify(this.channel().id)
      .pipe(
        finalize(() => this.verifying.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (summary) => this.summary.set(summary),
        error: (error: unknown) => this.actionError.set(toApiError(error).message),
      });
  }
}
