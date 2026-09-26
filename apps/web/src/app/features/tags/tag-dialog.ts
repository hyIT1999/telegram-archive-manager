import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButton } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { type Observable, finalize } from 'rxjs';
import { Notice } from '../../shared/components/notice/notice';
import { type TagDto, toApiError } from '../../shared/models';
import { TAG_COLORS, TAG_NAME_MAX_LENGTH, nextTagColor } from './tag-palette';
import { TagStore } from './tag-store';
import { TagsApi } from './tags-api';

export interface TagDialogData {
  /** The tag to rename or recolor; a new tag without it. */
  readonly tag?: TagDto;
}

/** Opens the dialog; the observable gives the saved tag, or undefined when cancelled. */
export function openTagDialog(dialog: MatDialog, tag?: TagDto): Observable<TagDto | undefined> {
  return dialog
    .open<TagDialog, TagDialogData, TagDto>(TagDialog, { data: { tag }, width: '440px' })
    .afterClosed();
}

/** Names a new tag, or renames and recolors one; closes with the saved tag. */
@Component({
  selector: 'app-tag-dialog',
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
    Notice,
  ],
  templateUrl: './tag-dialog.html',
  styleUrl: './tag-dialog.scss',
})
export class TagDialog {
  private readonly data = inject<TagDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<TagDialog, TagDto>>(MatDialogRef);
  private readonly api = inject(TagsApi);
  private readonly store = inject(TagStore);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly colors = TAG_COLORS;
  protected readonly maxLength = TAG_NAME_MAX_LENGTH;
  protected readonly editing = this.data.tag !== undefined;
  protected readonly name = signal(this.data.tag?.name ?? '');
  protected readonly color = signal<string | null>(
    this.data.tag ? this.data.tag.color : nextTagColor(this.store.tags()),
  );
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly length = computed(() => this.name().trim().replace(/\s+/g, ' ').length);
  protected readonly valid = computed(() => this.length() > 0 && this.length() <= this.maxLength);

  protected onName(event: Event): void {
    this.name.set((event.target as HTMLInputElement).value);
    this.error.set(null);
  }

  protected save(): void {
    if (!this.valid() || this.saving()) {
      return;
    }
    const request = { name: this.name(), color: this.color() };
    const tag = this.data.tag;
    this.saving.set(true);
    this.error.set(null);
    (tag ? this.api.update(tag.id, request) : this.api.create(request))
      .pipe(
        finalize(() => this.saving.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (saved) => {
          this.store.reload();
          this.dialogRef.close(saved);
        },
        error: (error: unknown) => this.error.set(toApiError(error).message),
      });
  }
}
