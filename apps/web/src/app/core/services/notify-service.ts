import { Injectable, inject } from '@angular/core';
import { MatSnackBar, type MatSnackBarConfig } from '@angular/material/snack-bar';

const BASE_CONFIG: MatSnackBarConfig = {
  horizontalPosition: 'center',
  verticalPosition: 'bottom',
};

/** Short, non-blocking feedback ("toasts"). Only one is visible at a time; newer replaces older. */
@Injectable({ providedIn: 'root' })
export class NotifyService {
  private readonly snackBar = inject(MatSnackBar);

  success(message: string): void {
    this.snackBar.open(message, undefined, {
      ...BASE_CONFIG,
      duration: 4000,
      politeness: 'polite',
    });
  }

  info(message: string): void {
    this.snackBar.open(message, undefined, {
      ...BASE_CONFIG,
      duration: 5000,
      politeness: 'polite',
    });
  }

  /** Errors stay longer, are announced assertively and can be dismissed explicitly. */
  error(message: string): void {
    this.snackBar.open(message, 'Dismiss', {
      ...BASE_CONFIG,
      duration: 8000,
      politeness: 'assertive',
      panelClass: 'toast-error',
    });
  }
}
