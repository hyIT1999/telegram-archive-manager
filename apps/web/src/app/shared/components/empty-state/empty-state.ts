import { Component, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';

/** Friendly "nothing here (yet)" block. Projected content becomes the call-to-action row. */
@Component({
  selector: 'app-empty-state',
  imports: [MatIcon],
  template: `
    <div class="icon" aria-hidden="true">
      <mat-icon>{{ icon() }}</mat-icon>
    </div>
    @if (note()) {
      <p class="note">{{ note() }}</p>
    }
    <h2 class="title">{{ title() }}</h2>
    @if (message()) {
      <p class="message">{{ message() }}</p>
    }
    <div class="actions">
      <ng-content />
    </div>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      padding: 48px 24px;
      text-align: center;
    }

    .icon {
      display: grid;
      place-items: center;
      width: 72px;
      height: 72px;
      margin-bottom: 4px;
      border-radius: var(--mat-sys-corner-full);
      background: var(--mat-sys-surface-container-high);
      color: var(--mat-sys-on-surface-variant);

      mat-icon {
        width: 36px;
        height: 36px;
        font-size: 36px;
      }
    }

    .note {
      margin: 0;
      padding: 4px 12px;
      border-radius: var(--mat-sys-corner-full);
      background: var(--mat-sys-tertiary-container);
      color: var(--mat-sys-on-tertiary-container);
      font: var(--mat-sys-label-medium);
    }

    .title {
      font: var(--mat-sys-headline-small);
      color: var(--mat-sys-on-surface);
    }

    .message {
      max-width: 56ch;
      margin: 0;
      font: var(--mat-sys-body-large);
      color: var(--mat-sys-on-surface-variant);
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 12px;
      margin-top: 8px;

      &:empty {
        display: none;
      }
    }
  `,
})
export class EmptyState {
  readonly icon = input('inbox');
  readonly title = input.required<string>();
  readonly message = input<string>();
  /** Small pill above the title, e.g. which phase delivers a feature. */
  readonly note = input<string>();
}
