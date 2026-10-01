import { DatePipe } from '@angular/common';
import {
  Component,
  DestroyRef,
  booleanAttribute,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButton } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatProgressBar } from '@angular/material/progress-bar';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { RouterLink } from '@angular/router';
import { filter, finalize } from 'rxjs';
import { LiveEvents } from '../../core/live/live-events';
import { LIVE_SAFETY_POLL_MS, liveRefresh } from '../../core/live/live-refresh';
import { Notice } from '../../shared/components/notice/notice';
import { type MessageBackupDto, type RequestBackupRequest, toApiError } from '../../shared/models';
import { BytesPipe } from '../../shared/pipes/bytes-pipe';
import {
  BackupAgainDialog,
  type BackupAgainChoice,
  type BackupAgainDialogData,
} from './backup-again-dialog';
import { backupAction, backupStatusIcon, backupStatusText } from './backup-labels';
import { BACKUP_POLLING, BackupsApi } from './backup-api';

/** A copy as the section shows it. */
interface BackupRow {
  backup: MessageBackupDto;
  icon: string;
  text: string;
  /** How far the upload is, 0–100, while it runs; null otherwise. */
  percent: number | null;
}

/**
 * The Telegram backup of one message: where its copy stands in the backup chat (followed live
 * while it waits or uploads), a link to the copy, what Verify found, and "Back up now" or "Back
 * up again", which work whatever the channel's switch says.
 */
@Component({
  selector: 'app-message-backup',
  imports: [
    BytesPipe,
    DatePipe,
    MatButton,
    MatIcon,
    MatProgressBar,
    MatProgressSpinner,
    Notice,
    RouterLink,
  ],
  templateUrl: './message-backup.html',
  styleUrl: './message-backup.scss',
})
export class MessageBackup {
  readonly messageId = input.required<string>();
  readonly channelId = input.required<string>();
  /** The copies as the message page loaded them. */
  readonly backups = input.required<MessageBackupDto[]>();
  /** The message is part of an album, which is backed up as a whole. */
  readonly album = input(false, { transform: booleanAttribute });

  private readonly api = inject(BackupsApi);
  private readonly dialog = inject(MatDialog);
  private readonly polling = inject(BACKUP_POLLING);
  private readonly destroyRef = inject(DestroyRef);

  /** The copies as last seen: from the page, then from the backup as it moves. */
  protected readonly current = linkedSignal(() => this.backups());
  protected readonly rows = computed<BackupRow[]>(() =>
    this.current().map((backup) => ({
      backup,
      icon: backupStatusIcon(backup.status),
      text: backupStatusText(backup),
      percent:
        backup.status === 'ACTIVE' && backup.size
          ? Math.min(100, Math.floor((backup.uploadedBytes * 100) / backup.size))
          : null,
    })),
  );
  /** The copy in the channel's backup chat: the newest one. */
  private readonly latest = computed(() => this.current().at(-1) ?? null);
  protected readonly action = computed(() => backupAction(this.latest()));
  protected readonly actionLabel = computed(() => {
    const status = this.latest()?.status;
    switch (this.action()) {
      case 'now':
        return status === 'FAILED' ? 'Try again' : 'Back up now';
      case 'again':
        return status === 'COMPLETED' ? 'Back up again' : 'Try again';
      default:
        return null;
    }
  });
  /** Waiting or uploading: worth following. */
  private readonly moving = computed(() =>
    this.current().some((backup) => backup.status === 'PENDING' || backup.status === 'ACTIVE'),
  );

  private readonly reading = signal(false);
  protected readonly requesting = signal(false);
  protected readonly actionError = signal<string | null>(null);
  /** The channel has no backup chat: the channel page is where to choose one. */
  protected readonly needsChat = signal(false);
  protected readonly nothingToDo = signal(false);

  constructor() {
    liveRefresh({
      reload: () => this.reload(),
      events: inject(LiveEvents)
        .on('backups.changed')
        .pipe(filter(({ channelId }) => channelId === this.channelId() && this.moving())),
      throttleMs: 2_000,
      loading: () => this.reading(),
      active: () => this.moving(),
      poll: (live) => (live ? LIVE_SAFETY_POLL_MS : this.polling.activeMs),
    });
  }

  /** "Back up now", or "Back up again" once asked whether the earlier copy goes. */
  protected run(): void {
    const action = this.action();
    const latest = this.latest();
    if (action === null || this.requesting()) {
      return;
    }
    if (action === 'now' || latest?.status !== 'COMPLETED') {
      this.send(action === 'again' ? { force: true } : {});
      return;
    }
    this.dialog
      .open<BackupAgainDialog, BackupAgainDialogData, BackupAgainChoice>(BackupAgainDialog, {
        data: { chatName: latest.chat.name },
        width: '480px',
        maxWidth: 'calc(100vw - 32px)',
      })
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((choice) => {
        if (choice) {
          this.send({ force: true, replacePrevious: choice.replacePrevious });
        }
      });
  }

  private send(request: Partial<RequestBackupRequest>): void {
    this.requesting.set(true);
    this.actionError.set(null);
    this.needsChat.set(false);
    this.nothingToDo.set(false);
    this.api
      .request(this.messageId(), request)
      .pipe(
        finalize(() => this.requesting.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (backup) => {
          this.adopt(backup);
          this.nothingToDo.set(!request.force && backup.status === 'COMPLETED');
        },
        error: (error: unknown) => {
          const apiError = toApiError(error);
          this.actionError.set(apiError.message);
          this.needsChat.set(apiError.code === 'BACKUP_CHAT_MISSING');
        },
      });
  }

  /** Reads the copies again while they move. */
  private reload(): void {
    if (this.reading()) {
      return;
    }
    this.reading.set(true);
    this.api
      .messageBackups(this.messageId())
      .pipe(
        finalize(() => this.reading.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (backups) => this.current.set(backups),
        // A failed read changes nothing; the next event or poll tries again.
        error: () => undefined,
      });
  }

  /** The copy the server answered with replaces the one of the same chat. */
  private adopt(backup: MessageBackupDto): void {
    this.current.update((backups) =>
      backups.some((item) => item.chat.id === backup.chat.id)
        ? backups.map((item) => (item.chat.id === backup.chat.id ? backup : item))
        : [...backups, backup],
    );
  }
}
