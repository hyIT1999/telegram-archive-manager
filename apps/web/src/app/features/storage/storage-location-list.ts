import { DatePipe, NgTemplateOutlet } from '@angular/common';
import {
  Component,
  DestroyRef,
  booleanAttribute,
  computed,
  effect,
  inject,
  input,
  model,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { ConfirmService } from '../../core/services/confirm-service';
import { NotifyService } from '../../core/services/notify-service';
import { ErrorState } from '../../shared/components/error-state/error-state';
import { Notice } from '../../shared/components/notice/notice';
import { Skeleton } from '../../shared/components/skeleton/skeleton';
import { type StorageKind, type StorageLocationDto, toApiError } from '../../shared/models';
import { BytesPipe } from '../../shared/pipes/bytes-pipe';
import { GoogleDriveDialog, type GoogleDriveDialogData } from './google-drive-dialog';
import { LocalFolderDialog, type LocalFolderDialogData } from './local-folder-dialog';
import { StorageApi } from './storage-api';
import { backupChatDescription, storageKindIcon } from './storage-kinds';
import { StorageLocations } from './storage-locations';
import { TelegramChatDialog, type TelegramChatDialogData } from './telegram-chat-dialog';

/** Radio groups of different lists on one page stay apart. */
let listSequence = 0;

/**
 * The storage locations, with their free space and state. With `selectable`, one can be picked
 * (the default is picked when nothing is); each card also offers check, default, reconnect and
 * remove, and new locations are added from here. `kinds` limits the list, e.g. to the places
 * media downloads to, or to the Telegram chats that receive backups.
 */
@Component({
  selector: 'app-storage-location-list',
  providers: [StorageLocations],
  imports: [
    DatePipe,
    ErrorState,
    MatButton,
    MatIcon,
    MatIconButton,
    MatMenu,
    MatMenuItem,
    MatMenuTrigger,
    NgTemplateOutlet,
    Notice,
    Skeleton,
  ],
  templateUrl: './storage-location-list.html',
  styleUrl: './storage-location-list.scss',
})
export class StorageLocationList {
  /** Show the locations as a single choice. */
  readonly selectable = input(false, { transform: booleanAttribute });
  readonly selectedId = model<string | null>(null);
  /** The kinds listed (and offered to add); null lists every kind. */
  readonly kinds = input<readonly StorageKind[] | null>(null);

  protected readonly store = inject(StorageLocations);
  private readonly api = inject(StorageApi);
  private readonly dialog = inject(MatDialog);
  private readonly confirmService = inject(ConfirmService);
  private readonly notify = inject(NotifyService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly bytes = new BytesPipe();

  protected readonly loadErrorMessage = computed(() => toApiError(this.store.error()).message);
  protected readonly capabilities = computed(() => this.store.list()?.capabilities ?? null);
  protected readonly radioName = `storage-location-${++listSequence}`;
  /** Only Telegram chats: the list picks where backups go. */
  protected readonly backupsOnly = computed(() => {
    const kinds = this.kinds();
    return kinds !== null && kinds.length > 0 && kinds.every((kind) => kind === 'TELEGRAM');
  });

  constructor() {
    this.store.showOnly(this.kinds);
    // Nothing chosen yet: start from the default location.
    effect(() => {
      const fallback = this.store.defaultLocation();
      if (this.selectable() && fallback && untracked(this.selectedId) === null) {
        this.selectedId.set(fallback.id);
      }
    });
  }

  /** Whether locations of this kind are listed, and can be added here. */
  protected shows(kind: StorageKind): boolean {
    const kinds = this.kinds();
    return kinds === null || kinds.includes(kind);
  }

  protected icon(location: StorageLocationDto): string {
    return storageKindIcon(location.kind);
  }

  /** The Google account of a Drive, or what kind of Telegram chat receives the backups. */
  protected meta(location: StorageLocationDto): string | null {
    if (location.telegram) {
      return backupChatDescription(location.telegram);
    }
    return location.accountEmail;
  }

  /**
   * When downloads to the location (backups, for a Telegram chat) wait: full, rate limited, access
   * lost; null when they do not.
   */
  protected waitingUntil(location: StorageLocationDto): string | null {
    const until = location.unavailableUntil;
    return until !== null && Date.parse(until) > Date.now() ? until : null;
  }

  /** "Checking…", "120 GiB free of 931 GiB", or what is wrong. */
  protected status(location: StorageLocationDto): { state: 'checking' | 'ok' | 'failed' | 'unknown'; text: string } {
    const check = this.store.checks().get(location.id);
    if (check?.status === 'checking') {
      return { state: 'checking', text: 'Checking…' };
    }
    if (check?.status === 'failed' || (!check && location.lastError)) {
      return { state: 'failed', text: check?.message ?? location.lastError ?? 'This location cannot be used right now.' };
    }
    if (location.kind === 'TELEGRAM') {
      // Checking asks Telegram, so it only runs from the menu; until then the stored state shows.
      return check || location.lastCheckedAt
        ? { state: 'ok', text: 'Ready for backups' }
        : { state: 'unknown', text: '' };
    }
    const space = check?.space ?? null;
    if (space !== null && space.freeBytes !== null && space.totalBytes !== null) {
      return {
        state: 'ok',
        text: `${this.bytes.transform(space.freeBytes)} free of ${this.bytes.transform(space.totalBytes)}`,
      };
    }
    if (space !== null && space.usedBytes !== null) {
      return { state: 'ok', text: `${this.bytes.transform(space.usedBytes)} used` };
    }
    return { state: check ? 'ok' : 'unknown', text: check ? 'Ready' : '' };
  }

  protected choose(location: StorageLocationDto): void {
    this.selectedId.set(location.id);
  }

  protected check(location: StorageLocationDto): void {
    this.store.check(location.id);
  }

  protected makeDefault(location: StorageLocationDto): void {
    this.api
      .update(location.id, { isDefault: true })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.store.reload();
          this.notify.success(`${location.name} is now the default location.`);
        },
        error: (error: unknown) => this.notify.error(toApiError(error).message),
      });
  }

  protected async remove(location: StorageLocationDto): Promise<void> {
    const confirmed = await this.confirmService.ask({
      title: `Remove ${location.name}?`,
      message:
        location.kind === 'TELEGRAM'
          ? 'The archive stops sending backups to this chat. Copies already there stay in Telegram.'
          : 'The archive stops using this location. Files already saved there stay where they are.' +
            (location.kind === 'GOOGLE_DRIVE'
              ? ' The app also gives up its access to the Google account.'
              : ''),
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!confirmed) {
      return;
    }
    this.api
      .remove(location.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          if (this.selectedId() === location.id) {
            this.selectedId.set(null);
          }
          this.store.removed(location.id);
          this.notify.success(`${location.name} was removed.`);
        },
        error: (error: unknown) => this.notify.error(toApiError(error).message),
      });
  }

  protected addLocal(): void {
    const data: LocalFolderDialogData = { roots: this.capabilities()?.localRoots ?? [] };
    this.dialog
      .open<LocalFolderDialog, LocalFolderDialogData, StorageLocationDto>(LocalFolderDialog, {
        data,
        width: '560px',
        maxWidth: 'calc(100vw - 32px)',
      })
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((location) => this.added(location));
  }

  protected connectGoogle(location?: StorageLocationDto): void {
    const google = this.capabilities()?.googleDrive;
    const data: GoogleDriveDialogData = {
      available: google?.available ?? false,
      reason: google?.reason ?? null,
      location: location ?? null,
    };
    this.dialog
      .open<GoogleDriveDialog, GoogleDriveDialogData, StorageLocationDto>(GoogleDriveDialog, {
        data,
        width: '520px',
        maxWidth: 'calc(100vw - 32px)',
      })
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => this.added(result));
  }

  protected addTelegram(): void {
    const telegram = this.capabilities()?.telegram;
    const data: TelegramChatDialogData = {
      available: telegram?.available ?? false,
      reason: telegram?.reason ?? null,
    };
    this.dialog
      .open<TelegramChatDialog, TelegramChatDialogData, StorageLocationDto>(TelegramChatDialog, {
        data,
        width: '600px',
        maxWidth: 'calc(100vw - 32px)',
      })
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((location) => this.added(location));
  }

  private added(location: StorageLocationDto | undefined): void {
    if (!location) {
      return;
    }
    this.store.upsert(location);
    if (this.selectable()) {
      this.selectedId.set(location.id);
    }
  }
}
