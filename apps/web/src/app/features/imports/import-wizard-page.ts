import {
  Component,
  DestroyRef,
  type ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  linkedSignal,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { Notice } from '../../shared/components/notice/notice';
import { PageHeader } from '../../shared/components/page-header/page-header';
import { type ChannelDto, toApiError } from '../../shared/models';
import { channelHandle, channelInitials, chatTypeLabel } from '../channels/channel-labels';
import { ChannelsApi, type CreatedChannel } from '../channels/channels-api';
import { StorageLocationList } from '../storage/storage-location-list';
import { ChatPicker } from '../telegram/chat-picker';
import { TelegramChats } from '../telegram/telegram-chats';
import { TelegramConnect } from '../telegram/telegram-connect';
import { TelegramSession } from '../telegram/telegram-session';

export interface WizardStep {
  readonly label: string;
  /** The phase that delivers the step, for steps that are not available yet. */
  readonly arrives?: string;
}

/** The import flow: steps 1–4 pick a chat and where to save it; the importer (Phase 3) adds 5–7. */
export const WIZARD_STEPS: readonly WizardStep[] = [
  { label: 'Connect Telegram' },
  { label: 'Channels & groups' },
  { label: 'Select channel' },
  { label: 'Storage location' },
  { label: 'Import mode', arrives: 'Phase 3' },
  { label: 'Start', arrives: 'Phase 3' },
  { label: 'Progress', arrives: 'Phase 3' },
];

const CONNECT = 0;
const CHATS = 1;
const CONFIRM = 2;
const STORAGE = 3;

@Component({
  selector: 'app-import-wizard-page',
  providers: [TelegramSession, TelegramChats],
  imports: [
    ChatPicker,
    MatButton,
    MatIcon,
    MatProgressSpinner,
    Notice,
    PageHeader,
    RouterLink,
    StorageLocationList,
    TelegramConnect,
  ],
  templateUrl: './import-wizard-page.html',
  styleUrl: './import-wizard-page.scss',
})
export class ImportWizardPage {
  protected readonly session = inject(TelegramSession);
  protected readonly chats = inject(TelegramChats);
  private readonly channelsApi = inject(ChannelsApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly stepTitle = viewChild<ElementRef<HTMLElement>>('stepTitle');

  protected readonly steps = WIZARD_STEPS;

  /** The furthest step whose prerequisites are met. */
  protected readonly reachable = computed(() => {
    if (!this.session.ready()) {
      return CONNECT;
    }
    if (!this.chats.selected()) {
      return CHATS;
    }
    return this.added() ? STORAGE : CONFIRM;
  });

  /**
   * The open step. Signing in moves on to the chat list, signing out goes back to the start, and
   * a step whose prerequisites went away (e.g. the chat left the list) falls back.
   */
  protected readonly step = linkedSignal<{ ready: boolean; reachable: number }, number>({
    source: () => ({ ready: this.session.ready(), reachable: this.reachable() }),
    computation: ({ ready, reachable }, previous) => {
      if (!ready) {
        return CONNECT;
      }
      const wanted = previous?.source.ready
        ? previous.value
        : Math.max(previous?.value ?? CONNECT, CHATS);
      return Math.min(wanted, reachable);
    },
  });

  /** The archive channel made from the picked chat; forgotten when another chat is picked. */
  protected readonly added = linkedSignal<string | null, CreatedChannel | null>({
    source: this.chats.selectedId,
    computation: () => null,
  });
  protected readonly addError = linkedSignal<string | null, string | null>({
    source: this.chats.selectedId,
    computation: () => null,
  });
  protected readonly adding = signal(false);

  /** The archive channel, kept up to date after its storage location is saved. */
  protected readonly channel = linkedSignal<CreatedChannel | null, ChannelDto | null>({
    source: this.added,
    computation: (added) => added?.channel ?? null,
  });
  /** The location picked in step 4; starts from the channel's own. */
  protected readonly storageChoice = linkedSignal<ChannelDto | null, string | null>({
    source: this.channel,
    computation: (channel, previous) => channel?.storageLocation?.id ?? previous?.value ?? null,
  });
  protected readonly storageSaved = computed(() => {
    const saved = this.channel()?.storageLocation?.id;
    return saved !== undefined && saved === this.storageChoice();
  });
  protected readonly savingStorage = signal(false);
  protected readonly storageError = linkedSignal<string | null, string | null>({
    source: this.storageChoice,
    computation: () => null,
  });

  protected readonly done = computed(() => [
    this.session.ready(),
    this.chats.selected() !== null,
    this.added() !== null,
    this.channel()?.storageLocation ? true : false,
  ]);
  protected readonly selectedInitials = computed(() =>
    channelInitials(this.chats.selected()?.title ?? ''),
  );
  protected readonly selectedDetails = computed(() => {
    const chat = this.chats.selected();
    return chat ? `${channelHandle(chat)} · ${chatTypeLabel(chat.type)}` : '';
  });

  protected open(index: number): void {
    if (index > this.reachable() || index === this.step()) {
      return;
    }
    this.step.set(index);
    this.focusStep();
  }

  protected pickAnother(): void {
    this.chats.selectedId.set(null);
    this.focusStep();
  }

  protected addToArchive(): void {
    const chat = this.chats.selected();
    if (!chat || this.adding()) {
      return;
    }
    this.adding.set(true);
    this.addError.set(null);
    this.channelsApi
      .create(chat.telegramChatId)
      .pipe(
        finalize(() => this.adding.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (result) => {
          this.added.set(result);
          this.chats.markArchived(chat.telegramChatId, result.channel.id);
        },
        error: (error: unknown) => {
          const apiError = toApiError(error);
          this.addError.set(apiError.message);
          // Gone from the chat list or protected by now: show the list as Telegram has it.
          if (apiError.status === 404 || apiError.status === 422) {
            this.chats.reload();
          }
        },
      });
  }

  protected saveStorage(): void {
    const channel = this.channel();
    const storageLocationId = this.storageChoice();
    if (!channel || !storageLocationId || this.savingStorage()) {
      return;
    }
    this.savingStorage.set(true);
    this.storageError.set(null);
    this.channelsApi
      .update(channel.id, { storageLocationId })
      .pipe(
        finalize(() => this.savingStorage.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (updated) => this.channel.set(updated),
        error: (error: unknown) => this.storageError.set(toApiError(error).message),
      });
  }

  /** Moves focus to the heading of the newly shown step (keyboard and screen reader users). */
  private focusStep(): void {
    afterNextRender(() => this.stepTitle()?.nativeElement.focus(), { injector: this.injector });
  }
}
