import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { type Observable, firstValueFrom, map } from 'rxjs';
import {
  ConfirmDialog,
  type ConfirmDialogData,
} from '../../shared/components/confirm-dialog/confirm-dialog';

export type ConfirmOptions = ConfirmDialogData;

/** Asks the user to confirm an action in a modal dialog. Dismissing the dialog counts as "no". */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  private readonly dialog = inject(MatDialog);

  confirm(options: ConfirmOptions): Observable<boolean> {
    return this.dialog
      .open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, {
        data: options,
        role: 'alertdialog',
        width: '440px',
        maxWidth: 'calc(100vw - 32px)',
        restoreFocus: true,
      })
      .afterClosed()
      .pipe(map((result) => result === true));
  }

  /** Promise flavour of {@link confirm} for async/await call sites. */
  ask(options: ConfirmOptions): Promise<boolean> {
    return firstValueFrom(this.confirm(options));
  }
}
