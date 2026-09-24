import { NgTemplateOutlet } from '@angular/common';
import { Component, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { RouterLink } from '@angular/router';

export type StatTone = 'primary' | 'secondary' | 'tertiary' | 'error';

/** One headline number. With `link` the whole card navigates to the matching section. */
@Component({
  selector: 'app-stat-card',
  imports: [MatIcon, NgTemplateOutlet, RouterLink],
  host: { '[class]': "'tone-' + tone()" },
  template: `
    <ng-template #body>
      <span class="icon" aria-hidden="true">
        <mat-icon>{{ icon() }}</mat-icon>
      </span>
      <span class="label">{{ label() }}</span>
      <span class="value">{{ value() }}</span>
      @if (hint()) {
        <span class="hint">{{ hint() }}</span>
      }
    </ng-template>

    @if (link(); as target) {
      <a class="surface-card card is-link" [routerLink]="target">
        <ng-container [ngTemplateOutlet]="body" />
      </a>
    } @else {
      <div class="surface-card card">
        <ng-container [ngTemplateOutlet]="body" />
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
      --tone-container: var(--mat-sys-primary-container);
      --tone-on-container: var(--mat-sys-on-primary-container);
    }

    :host(.tone-secondary) {
      --tone-container: var(--mat-sys-secondary-container);
      --tone-on-container: var(--mat-sys-on-secondary-container);
    }

    :host(.tone-tertiary) {
      --tone-container: var(--mat-sys-tertiary-container);
      --tone-on-container: var(--mat-sys-on-tertiary-container);
    }

    :host(.tone-error) {
      --tone-container: var(--mat-sys-error-container);
      --tone-on-container: var(--mat-sys-on-error-container);
    }

    .card {
      display: flex;
      flex-direction: column;
      gap: 6px;
      box-sizing: border-box;
      height: 100%;
      padding: 20px;
      color: inherit;
      text-decoration: none;
      transition:
        background-color 150ms ease,
        border-color 150ms ease;
    }

    .is-link:hover {
      background: var(--mat-sys-surface-container-low);
      border-color: var(--mat-sys-outline);
    }

    .is-link:focus-visible {
      outline: 2px solid var(--mat-sys-primary);
      outline-offset: 2px;
    }

    .icon {
      display: grid;
      place-items: center;
      width: 40px;
      height: 40px;
      margin-bottom: 8px;
      border-radius: var(--mat-sys-corner-medium);
      background: var(--tone-container);
      color: var(--tone-on-container);
    }

    .label {
      font: var(--mat-sys-label-large);
      color: var(--mat-sys-on-surface-variant);
    }

    .value {
      font: var(--mat-sys-headline-medium);
      font-variant-numeric: tabular-nums;
      color: var(--mat-sys-on-surface);
    }

    .hint {
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
    }

    @media (prefers-reduced-motion: reduce) {
      .card {
        transition: none;
      }
    }
  `,
})
export class StatCard {
  readonly label = input.required<string>();
  /** Already formatted for display (e.g. "1,204" or "3.2 GiB"). */
  readonly value = input.required<string>();
  readonly icon = input.required<string>();
  readonly tone = input<StatTone>('primary');
  readonly hint = input<string>();
  readonly link = input<string>();
}
