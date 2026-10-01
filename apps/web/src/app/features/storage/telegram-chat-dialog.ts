import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButton } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatFormField, MatHint, MatLabel, MatPrefix } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { finalize } from 'rxjs';
import { Notice } from '../../shared/components/notice/notice';
import { Skeleton } from '../../shared/components/skeleton/skeleton';
import { type StorageLocationDto, type TelegramDialogDto, toApiError } from '../../shared/models';
import { channelHandle, channelInitials, chatTypeLabel } from '../channels/channel-labels';
import { TelegramChats } from '../telegram/telegram-chats';
import { telegramActionError } from '../telegram/telegram-labels';
import { TelegramSession } from '../telegram/telegram-session';
import { StorageApi } from './storage-api';

export interface TelegramChatDialogData {
  /** Backup chats need the archive's Telegram account to be signed in. */
  available: boolean;
  /** Why they cannot be added right now. */
  reason: string | null;
}

interface ChatRow {
  readonly chat: TelegramDialogDto;
  readonly initials: string;
  readonly description: string;
}

/**
 * Whether a chat of the account can receive backups: a channel or supergroup where it may post
 * (and create topics, in a forum), which is not archived itself. The server checks again.
 */
export function backupCandidate(chat: TelegramDialogDto): boolean {
  return (
    chat.type !== 'GROUP' &&
    chat.canPost &&
    (!chat.isForum || chat.canManageTopics) &&
    chat.archivedChannelId === null &&
    chat.backupLocationId === null
  );
}

/**
 * Picks a Telegram chat of the account to receive backup copies of messages. The worker checks
 * that the account may post there before the location is added; closes with it.
 */
@Component({
  selector: 'app-telegram-chat-dialog',
  providers: [TelegramSession, TelegramChats],
  imports: [
    MatButton,
    MatDialogActions,
    MatDialogClose,
    MatDialogContent,
    MatDialogTitle,
    MatFormField,
    MatHint,
    MatIcon,
    MatInput,
    MatLabel,
    MatPrefix,
    MatProgressSpinner,
    Notice,
    Skeleton,
  ],
  templateUrl: './telegram-chat-dialog.html',
  styleUrl: './telegram-chat-dialog.scss',
})
export class TelegramChatDialog {
  protected readonly data = inject<TelegramChatDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef =
    inject<MatDialogRef<TelegramChatDialog, StorageLocationDto>>(MatDialogRef);
  private readonly api = inject(StorageApi);
  protected readonly chats = inject(TelegramChats);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly loadErrorMessage = computed(() => toApiError(this.chats.error()).message);
  protected readonly rows = computed<ChatRow[]>(() =>
    this.chats
      .visible()
      .filter(backupCandidate)
      .map((chat) => ({
        chat,
        initials: channelInitials(chat.title),
        description: `${channelHandle(chat)} · ${chatTypeLabel(chat.type)}`,
      })),
  );
  /** Chats of the list that could receive backups, whatever the search. */
  protected readonly candidates = computed(
    () => (this.chats.list()?.items ?? []).filter(backupCandidate).length,
  );

  protected readonly selectedId = signal<string | null>(null);
  protected readonly selected = computed(
    () => this.rows().find((row) => row.chat.telegramChatId === this.selectedId())?.chat ?? null,
  );
  protected readonly name = signal('');
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);

  protected onSearch(event: Event): void {
    this.chats.query.set((event.target as HTMLInputElement).value);
  }

  protected onName(event: Event): void {
    this.name.set((event.target as HTMLInputElement).value);
  }

  protected select(chat: TelegramDialogDto): void {
    this.selectedId.set(chat.telegramChatId);
    this.saveError.set(null);
  }

  protected save(): void {
    const chat = this.selected();
    if (!chat || this.saving()) {
      return;
    }
    this.saving.set(true);
    this.saveError.set(null);
    const name = this.name().trim();
    this.api
      .createTelegram({ telegramChatId: chat.telegramChatId, ...(name ? { name } : {}) })
      .pipe(
        finalize(() => this.saving.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (location) => this.dialogRef.close(location),
        error: (error: unknown) => {
          this.saveError.set(telegramActionError(error));
          // The worker read the chat again: its rights may have changed, or it is gone.
          const status = toApiError(error).status;
          if (status === 404 || status === 409 || status === 422) {
            this.chats.reload();
          }
        },
      });
  }
}
