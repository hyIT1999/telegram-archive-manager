import { Component, input, output } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';

/** Inline failure message with a retry action, used when a page's data could not be loaded. */
@Component({
  selector: 'app-error-state',
  imports: [MatButton, MatIcon],
  host: { role: 'alert' },
  template: `
    <div class="icon" aria-hidden="true">
      <mat-icon>cloud_off</mat-icon>
    </div>
    <div class="text">
      <h2 class="title">{{ title() }}</h2>
      <p class="message">{{ message() }}</p>
    </div>
    <button matButton="tonal" type="button" (click)="retry.emit()">
      <mat-icon>refresh</mat-icon>
      {{ retryLabel() }}
    </button>
  `,
  styles: `
    :host {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 16px 20px;
      padding: 20px 24px;
      border-radius: var(--mat-sys-corner-large);
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
    }

    .icon {
      display: grid;
      place-items: center;
      width: 44px;
      height: 44px;
      border-radius: var(--mat-sys-corner-full);
      background: var(--mat-sys-surface-container-lowest);
      color: var(--mat-sys-error);
    }

    .text {
      flex: 1 1 240px;
    }

    .title {
      font: var(--mat-sys-title-medium);
    }

    .message {
      margin: 4px 0 0;
      font: var(--mat-sys-body-medium);
    }
  `,
})
export class ErrorState {
  readonly title = input('Something went wrong');
  readonly message = input('The data could not be loaded.');
  readonly retryLabel = input('Try again');
  readonly retry = output();
}
