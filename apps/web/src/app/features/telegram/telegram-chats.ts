import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import { rxResource, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { type TelegramDialogDto, type TelegramDialogListDto, toApiError } from '../../shared/models';
import { TelegramApi } from './telegram-api';
import { type ChatFilter, filterChats, telegramActionError } from './telegram-labels';
import { TELEGRAM_POLLING, TelegramSession } from './telegram-session';

/**
 * The channels and groups the Telegram account can access, with search, type filter and the
 * chat picked for archiving. Provided by the page, next to its TelegramSession.
 */
@Injectable()
export class TelegramChats {
  private readonly api = inject(TelegramApi);
  private readonly session = inject(TelegramSession);
  private readonly polling = inject(TELEGRAM_POLLING);
  private readonly destroyRef = inject(DestroyRef);

  /** Loaded once the account is signed in; idle before. */
  private readonly resource = rxResource({
    params: () => (this.session.ready() ? 'signed-in' : undefined),
    stream: () => this.api.chats(),
  });

  readonly list = computed<TelegramDialogListDto | undefined>(() =>
    this.resource.hasValue() ? this.resource.value() : undefined,
  );
  readonly error = computed(() => this.resource.error());

  private readonly requesting = signal(false);
  readonly refreshError = signal<string | null>(null);
  /** A refresh was requested or the worker is re-reading the list from Telegram. */
  readonly refreshing = computed(() => this.requesting() || (this.list()?.refreshing ?? false));

  readonly query = signal('');
  readonly filter = signal<ChatFilter>('all');
  readonly visible = computed(() =>
    filterChats(this.list()?.items ?? [], this.query(), this.filter()),
  );

  readonly selectedId = signal<string | null>(null);
  /** The picked chat, as long as it is still listed and may be archived. */
  readonly selected = computed<TelegramDialogDto | null>(() => {
    const id = this.selectedId();
    return (
      this.list()?.items.find((chat) => chat.telegramChatId === id && !chat.isProtected) ?? null
    );
  });

  constructor() {
    // The worker refreshes in the background: re-read the list until it is done.
    effect((onCleanup) => {
      if (!this.list()?.refreshing || this.resource.isLoading()) {
        return;
      }
      const timer = setTimeout(() => this.resource.reload(), this.polling.chatsMs);
      onCleanup(() => clearTimeout(timer));
    });
  }

  reload(): void {
    this.resource.reload();
  }

  /** Asks the worker to read the chat list from Telegram again. */
  refresh(): void {
    if (this.requesting()) {
      return;
    }
    this.requesting.set(true);
    this.refreshError.set(null);
    this.api
      .refreshChats()
      .pipe(
        finalize(() => this.requesting.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (list) => this.resource.set(list),
        error: (error: unknown) => {
          this.refreshError.set(telegramActionError(error));
          // 409: signed out meanwhile (session revoked, logged out in another tab).
          if (toApiError(error).status === 409) {
            this.session.reload();
          }
        },
      });
  }

  select(chat: TelegramDialogDto): void {
    if (!chat.isProtected) {
      this.selectedId.set(chat.telegramChatId);
    }
  }

  /** Links a chat to the archive channel just created from it, without re-reading the list. */
  markArchived(telegramChatId: string, channelId: string): void {
    const list = this.list();
    if (!list) {
      return;
    }
    this.resource.set({
      ...list,
      items: list.items.map((chat) =>
        chat.telegramChatId === telegramChatId ? { ...chat, archivedChannelId: channelId } : chat,
      ),
    });
  }
}
