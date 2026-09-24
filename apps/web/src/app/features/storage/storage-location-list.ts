import { NgTemplateOutlet } from '@angular/common';
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
import { type StorageLocationDto, toApiError } from '../../shared/models';
import { BytesPipe } from '../../shared/pipes/bytes-pipe';
import { GoogleDriveDialog, type GoogleDriveDialogData } from './google-drive-dialog';
import { LocalFolderDialog, type LocalFolderDialogData } from './local-folder-dialog';
import { StorageApi } from './storage-api';
import { StorageLocations } from './storage-locations';

/**
 * The storage locations, with their free space and state. With `selectable`, one can be picked
 * (the default is picked when nothing is); each card also offers check, default, reconnect and
 * remove, and new locations are added from here.
 */
@Component({
  selector: 'app-storage-location-list',
  providers: [StorageLocations],
  imports: [
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

  protected readonly store = inject(StorageLocations);
  private readonly api = inject(StorageApi);
  private readonly dialog = inject(MatDialog);
  private readonly confirmService = inject(ConfirmService);
  private readonly notify = inject(NotifyService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly bytes = new BytesPipe();

  protected readonly loadErrorMessage = computed(() => toApiError(this.store.error()).message);
  protected readonly capabilities = computed(() => this.store.list()?.capabilities ?? null);

  constructor() {
    // Nothing chosen yet: start from the default location.
    effect(() => {
      const fallback = this.store.defaultLocation();
      if (this.selectable() && fallback && untracked(this.selectedId) === null) {
        this.selectedId.set(fallback.id);
      }
    });
  }

  protected icon(location: StorageLocationDto): string {
    return location.kind === 'GOOGLE_DRIVE' ? 'add_to_drive' : 'folder';
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
        'The archive stops using this location. Files already saved there stay where they are.' +
        (location.kind === 'GOOGLE_DRIVE' ? ' The app also gives up its access to the Google account.' : ''),
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
