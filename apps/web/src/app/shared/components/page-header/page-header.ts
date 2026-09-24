import { Component, input } from '@angular/core';

/**
 * Page title block (the page's only <h1>). Elements marked `pageActions` go to the action area;
 * anything else is shown under the subtitle (badges, metadata).
 */
@Component({
  selector: 'app-page-header',
  template: `
    <div class="text">
      @if (eyebrow()) {
        <p class="eyebrow">{{ eyebrow() }}</p>
      }
      <h1 class="title">{{ title() }}</h1>
      @if (subtitle()) {
        <p class="subtitle">{{ subtitle() }}</p>
      }
      <ng-content />
    </div>
    <div class="actions">
      <ng-content select="[pageActions]" />
    </div>
  `,
  styles: `
    :host {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      justify-content: space-between;
      gap: 16px 24px;
      margin-bottom: 32px;
    }

    .text {
      display: grid;
      gap: 8px;
      min-width: 0;
    }

    .eyebrow {
      margin: 0;
      font: var(--mat-sys-label-large);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--mat-sys-tertiary);
    }

    .title {
      font: var(--mat-sys-headline-large);
      color: var(--mat-sys-on-surface);
      overflow-wrap: anywhere;
    }

    .subtitle {
      max-width: 72ch;
      margin: 0;
      font: var(--mat-sys-body-large);
      color: var(--mat-sys-on-surface-variant);
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;

      &:empty {
        display: none;
      }
    }
  `,
})
export class PageHeader {
  readonly title = input.required<string>();
  readonly subtitle = input<string>();
  /** Small label above the title, e.g. the section of the archive. */
  readonly eyebrow = input<string>();
}
