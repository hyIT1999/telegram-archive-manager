import { Component, inject, signal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogTitle,
} from '@angular/material/dialog';

export interface BackupAgainDialogData {
  /** The backup chat that receives the new copy. */
  chatName: string;
}

export interface BackupAgainChoice {
  /** Delete the earlier copy from the backup chat once the new one is there. */
  replacePrevious: boolean;
}

/**
 * Confirms "Back up again", which sends a new copy of a message that is already backed up, and
 * asks whether the earlier copy goes. Closes with the choice, or undefined when cancelled.
 */
@Component({
  selector: 'app-backup-again-dialog',
  imports: [
    MatButton,
    MatCheckbox,
    MatDialogActions,
    MatDialogClose,
    MatDialogContent,
    MatDialogTitle,
  ],
  template: `
    <h2 mat-dialog-title>Back up again?</h2>
    <mat-dialog-content>
      <p class="message">
        A new copy is sent to {{ data.chatName }}, first in line, with its file uploaded again (an
        album goes as a whole).
      </p>
      <mat-checkbox [checked]="replace()" (change)="replace.set($event.checked)">
        Delete the earlier copy from the backup chat once the new one is there
      </mat-checkbox>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button matButton type="button" [mat-dialog-close]="undefined">Cancel</button>
      <button matButton="filled" type="button" [mat-dialog-close]="choice()">Back up again</button>
    </mat-dialog-actions>
  `,
  styles: `
    mat-dialog-content {
      display: grid;
      gap: 12px;
    }

    .message {
      margin: 0;
      color: var(--mat-sys-on-surface-variant);
    }
  `,
})
export class BackupAgainDialog {
  protected readonly data = inject<BackupAgainDialogData>(MAT_DIALOG_DATA);
  protected readonly replace = signal(true);

  protected choice(): BackupAgainChoice {
    return { replacePrevious: this.replace() };
  }
}
