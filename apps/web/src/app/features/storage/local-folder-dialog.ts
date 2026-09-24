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
import { MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { finalize } from 'rxjs';
import { Notice } from '../../shared/components/notice/notice';
import { type LocalFolderListDto, type StorageLocationDto, toApiError } from '../../shared/models';
import { StorageApi } from './storage-api';

export interface LocalFolderDialogData {
  /** Folders the server allows (STORAGE_LOCAL_ROOTS). */
  roots: string[];
}

/** Last part of a folder path, for Windows and POSIX paths alike. */
function lastSegment(folder: string): string {
  return folder.split(/[\\/]/).filter(Boolean).at(-1) ?? folder;
}

/**
 * Picks a folder on the machine running the archive, inside the allowed roots, optionally with
 * a new subfolder. Closes with the created location.
 */
@Component({
  selector: 'app-local-folder-dialog',
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
    MatProgressSpinner,
    Notice,
  ],
  templateUrl: './local-folder-dialog.html',
  styleUrl: './local-folder-dialog.scss',
})
export class LocalFolderDialog {
  protected readonly data = inject<LocalFolderDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<LocalFolderDialog, StorageLocationDto>>(MatDialogRef);
  private readonly api = inject(StorageApi);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly listing = signal<LocalFolderListDto | null>(null);
  protected readonly loading = signal(false);
  protected readonly browseError = signal<string | null>(null);
  protected readonly subfolder = signal('');
  protected readonly name = signal('');
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);

  /** The folder that will be used, as shown to the person. */
  protected readonly target = computed(() => {
    const folder = this.listing()?.path;
    if (!folder) {
      return null;
    }
    const sub = this.subfolder().trim();
    return sub ? `${folder}${folder.includes('\\') ? '\\' : '/'}${sub}` : folder;
  });
  protected readonly suggestedName = computed(() => {
    const target = this.target();
    return target ? lastSegment(target) : '';
  });

  constructor() {
    this.open(null);
  }

  /** Lists `folder`, or the allowed roots for null. */
  protected open(folder: string | null): void {
    this.loading.set(true);
    this.browseError.set(null);
    this.api
      .folders(folder)
      .pipe(
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (listing) => this.listing.set(listing),
        error: (error: unknown) => this.browseError.set(toApiError(error).message),
      });
  }

  protected up(): void {
    this.open(this.listing()?.parent ?? null);
  }

  protected onSubfolder(event: Event): void {
    this.subfolder.set((event.target as HTMLInputElement).value);
  }

  protected onName(event: Event): void {
    this.name.set((event.target as HTMLInputElement).value);
  }

  protected save(): void {
    const folder = this.listing()?.path;
    if (!folder || this.saving()) {
      return;
    }
    const subfolder = this.subfolder().trim();
    this.saving.set(true);
    this.saveError.set(null);
    this.api
      .createLocal({
        name: this.name().trim() || this.suggestedName(),
        path: folder,
        ...(subfolder ? { subfolder } : {}),
      })
      .pipe(
        finalize(() => this.saving.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (location) => this.dialogRef.close(location),
        error: (error: unknown) => this.saveError.set(toApiError(error).message),
      });
  }
}
