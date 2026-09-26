import { DatePipe } from '@angular/common';
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
import { MatSlideToggle, type MatSlideToggleChange } from '@angular/material/slide-toggle';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { Notice } from '../../shared/components/notice/notice';
import { PageHeader } from '../../shared/components/page-header/page-header';
import { type ChannelDto, type ImportJobDto, detailString, toApiError } from '../../shared/models';
import { channelHandle, channelInitials, chatTypeLabel } from '../channels/channel-labels';
import { ChannelsApi, type CreatedChannel } from '../channels/channels-api';
import { StorageLocationList } from '../storage/storage-location-list';
import { ChatPicker } from '../telegram/chat-picker';
import { TelegramChats } from '../telegram/telegram-chats';
import { TelegramConnect } from '../telegram/telegram-connect';
import { TelegramSession } from '../telegram/telegram-session';
import { ImportJobWatch } from './import-job-watch';
import { type ImportChoice, importChoiceProblem, toImportRequest } from './import-labels';
import { DEFAULT_IMPORT_CHOICE, ImportModePicker } from './import-mode-picker';
import { ImportProgress } from './import-progress';
import { ImportsApi, type StartedImport } from './imports-api';

export interface WizardStep {
  readonly label: string;
}

/** The import flow: pick a chat and where its media goes, then what to import, and follow it. */
export const WIZARD_STEPS: readonly WizardStep[] = [
  { label: 'Connect Telegram' },
  { label: 'Channels & groups' },
  { label: 'Select channel' },
  { label: 'Storage location' },
  { label: 'Import mode' },
  { label: 'Start' },
  { label: 'Progress' },
];

const CONNECT = 0;
const CHATS = 1;
const CONFIRM = 2;
const STORAGE = 3;
const MODE = 4;
const START = 5;
const PROGRESS = 6;

@Component({
  selector: 'app-import-wizard-page',
  providers: [TelegramSession, TelegramChats, ImportJobWatch],
  imports: [
    ChatPicker,
    DatePipe,
    ImportModePicker,
    ImportProgress,
    MatButton,
    MatIcon,
    MatProgressSpinner,
    MatSlideToggle,
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
  protected readonly watch = inject(ImportJobWatch);
  private readonly channelsApi = inject(ChannelsApi);
  private readonly importsApi = inject(ImportsApi);
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
    if (!this.added()) {
      return CONFIRM;
    }
    if (!this.channel()?.storageLocation) {
      return STORAGE;
    }
    if (this.started()) {
      return PROGRESS;
    }
    return this.importRequest() ? START : MODE;
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
  protected readonly savingDownloads = signal(false);
  protected readonly downloadsError = signal<string | null>(null);
  protected readonly savingSync = signal(false);
  protected readonly syncError = signal<string | null>(null);
  protected readonly storageError = linkedSignal<string | null, string | null>({
    source: this.storageChoice,
    computation: () => null,
  });

  /** What to import (step 5); starts over for another chat. */
  protected readonly importChoice = linkedSignal<CreatedChannel | null, ImportChoice>({
    source: this.added,
    computation: () => DEFAULT_IMPORT_CHOICE,
  });
  protected readonly importRequest = computed(() => {
    const choice = this.importChoice();
    return importChoiceProblem(choice) ? null : toImportRequest(choice);
  });
  /** The import started in step 6 (or found unfinished); forgotten for another chat. */
  protected readonly started = linkedSignal<CreatedChannel | null, StartedImport | null>({
    source: this.added,
    computation: () => null,
  });
  protected readonly starting = signal(false);
  protected readonly startError = linkedSignal<ImportChoice, string | null>({
    source: this.importChoice,
    computation: () => null,
  });
  /** The channel's unfinished import that blocked a different one (409 IMPORT_ACTIVE). */
  protected readonly blockingJobId = linkedSignal<ImportChoice, string | null>({
    source: this.importChoice,
    computation: () => null,
  });
  /** The started job as last read (the answer of the start request until the first poll). */
  protected readonly job = computed<ImportJobDto | null>(
    () => this.watch.job() ?? this.started()?.job ?? null,
  );

  protected readonly done = computed(() => [
    this.session.ready(),
    this.chats.selected() !== null,
    this.added() !== null,
    this.channel()?.storageLocation ? true : false,
    this.started() !== null,
    this.started() !== null,
    this.job()?.status === 'COMPLETED',
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

  /** Switches the channel's automatic media downloads (saved at once). */
  protected setDownloadMedia(change: MatSlideToggleChange): void {
    const channel = this.channel();
    if (!channel || this.savingDownloads()) {
      return;
    }
    this.savingDownloads.set(true);
    this.downloadsError.set(null);
    this.channelsApi
      .update(channel.id, { downloadMedia: change.checked })
      .pipe(
        finalize(() => this.savingDownloads.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (updated) => this.channel.set(updated),
        error: (error: unknown) => {
          this.downloadsError.set(toApiError(error).message);
          change.source.checked = !change.checked;
        },
      });
  }

  /** Switches the channel's sync after the import (saved at once). */
  protected setSyncEnabled(change: MatSlideToggleChange): void {
    const channel = this.channel();
    if (!channel || this.savingSync()) {
      return;
    }
    this.savingSync.set(true);
    this.syncError.set(null);
    this.channelsApi
      .update(channel.id, { syncEnabled: change.checked })
      .pipe(
        finalize(() => this.savingSync.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (updated) => this.channel.set(updated),
        error: (error: unknown) => {
          this.syncError.set(toApiError(error).message);
          change.source.checked = !change.checked;
        },
      });
  }

  protected startImport(): void {
    const channel = this.channel();
    const request = this.importRequest();
    if (!channel || !request || this.starting()) {
      return;
    }
    this.starting.set(true);
    this.startError.set(null);
    this.blockingJobId.set(null);
    this.importsApi
      .start(channel.id, request)
      .pipe(
        finalize(() => this.starting.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (result) => {
          this.started.set(result);
          this.watch.id.set(result.job.id);
          this.open(PROGRESS);
        },
        error: (error: unknown) => {
          this.startError.set(toApiError(error).message);
          this.blockingJobId.set(detailString(error, 'jobId'));
        },
      });
  }

  /** Moves focus to the heading of the newly shown step (keyboard and screen reader users). */
  private focusStep(): void {
    afterNextRender(() => this.stepTitle()?.nativeElement.focus(), { injector: this.injector });
  }
}
