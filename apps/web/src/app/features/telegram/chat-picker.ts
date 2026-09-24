import { DatePipe, formatNumber } from '@angular/common';
import { Component, LOCALE_ID, computed, inject } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatButtonToggle, MatButtonToggleGroup } from '@angular/material/button-toggle';
import { MatFormField, MatLabel, MatPrefix } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { EmptyState } from '../../shared/components/empty-state/empty-state';
import { ErrorState } from '../../shared/components/error-state/error-state';
import { Notice } from '../../shared/components/notice/notice';
import { Skeleton } from '../../shared/components/skeleton/skeleton';
import { type TelegramDialogDto, toApiError } from '../../shared/models';
import { channelHandle, channelInitials, chatTypeLabel } from '../channels/channel-labels';
import { TelegramChats } from './telegram-chats';
import type { ChatFilter } from './telegram-labels';

interface ChatRow {
  readonly chat: TelegramDialogDto;
  readonly initials: string;
  readonly description: string;
}

const FILTERS: readonly { readonly value: ChatFilter; readonly label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'channels', label: 'Channels' },
  { value: 'groups', label: 'Groups' },
];

/**
 * The Telegram chats the account can access, as a searchable single-choice list. Chats with
 * content protection are shown but cannot be picked. Needs TelegramChats from the page.
 */
@Component({
  selector: 'app-chat-picker',
  imports: [
    DatePipe,
    EmptyState,
    ErrorState,
    MatButton,
    MatButtonToggle,
    MatButtonToggleGroup,
    MatFormField,
    MatIcon,
    MatInput,
    MatLabel,
    MatPrefix,
    MatProgressSpinner,
    Notice,
    Skeleton,
  ],
  templateUrl: './chat-picker.html',
  styleUrl: './chat-picker.scss',
})
export class ChatPicker {
  protected readonly chats = inject(TelegramChats);
  private readonly locale = inject(LOCALE_ID);

  protected readonly filters = FILTERS;
  protected readonly loadErrorMessage = computed(() => toApiError(this.chats.error()).message);
  protected readonly rows = computed<ChatRow[]>(() =>
    this.chats.visible().map((chat) => ({
      chat,
      initials: channelInitials(chat.title),
      description: this.describe(chat),
    })),
  );

  protected onSearch(event: Event): void {
    this.chats.query.set((event.target as HTMLInputElement).value);
  }

  protected onFilter(value: ChatFilter): void {
    this.chats.filter.set(value);
  }

  private describe(chat: TelegramDialogDto): string {
    const parts = [channelHandle(chat), chatTypeLabel(chat.type)];
    if (chat.memberCount !== null) {
      const count = formatNumber(chat.memberCount, this.locale, '1.0-0');
      parts.push(`${count} ${chat.memberCount === 1 ? 'member' : 'members'}`);
    }
    return parts.join(' · ');
  }
}
