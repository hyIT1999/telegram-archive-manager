import { Component, inject } from '@angular/core';
import { MatButton } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogTitle,
} from '@angular/material/dialog';

export interface ConfirmDialogData {
  title: string;
  message: string;
  /** Label of the confirming button. Defaults to "Confirm". */
  confirmLabel?: string;
  /** Label of the dismissing button. Defaults to "Cancel". */
  cancelLabel?: string;
  /** Styles the confirm button as a destructive action. */
  destructive?: boolean;
}

/**
 * Generic yes/no dialog; opened through ConfirmService, closes with `true` only on confirm.
 * "Cancel" comes first, so the dialog's first-tabbable autofocus lands on the safe choice.
 */
@Component({
  selector: 'app-confirm-dialog',
  imports: [MatButton, MatDialogActions, MatDialogClose, MatDialogContent, MatDialogTitle],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content>
      <p class="message">{{ data.message }}</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button matButton type="button" [mat-dialog-close]="false">
        {{ data.cancelLabel ?? 'Cancel' }}
      </button>
      <button
        matButton="filled"
        type="button"
        [class.destructive]="data.destructive"
        [mat-dialog-close]="true"
      >
        {{ data.confirmLabel ?? 'Confirm' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .message {
      margin: 0;
      color: var(--mat-sys-on-surface-variant);
    }

    .destructive {
      --mat-button-filled-container-color: var(--mat-sys-error);
      --mat-button-filled-label-text-color: var(--mat-sys-on-error);
    }
  `,
})
export class ConfirmDialog {
  protected readonly data = inject<ConfirmDialogData>(MAT_DIALOG_DATA);
}
